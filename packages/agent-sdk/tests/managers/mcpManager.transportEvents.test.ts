import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("@modelcontextprotocol/sdk/client/sse.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
vi.mock("fs");

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  onerror: ((error: Error) => void) | null;
  onclose: (() => void) | null;
  stderr: null;
}

function makeTransport(): MockTransport {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
    stderr: null,
  };
}

// The onerror/onclose handlers live on the transport instance; the manager
// installs them synchronously inside connectServer. Capturing them from the
// mock and invoking them directly keeps these tests deterministic (no polling,
// no waiting for a real transport callback).
function connectionsOf(manager: McpManager) {
  return (
    manager as unknown as {
      connections: Map<
        string,
        { transport: unknown; client?: unknown; process?: unknown }
      >;
    }
  ).connections;
}

function reconnectTimersOf(manager: McpManager) {
  return (manager as unknown as { reconnectTimers: Map<string, unknown> })
    .reconnectTimers;
}

function disconnectingOf(manager: McpManager) {
  return (manager as unknown as { disconnecting: Set<string> }).disconnecting;
}

describe("McpManager transport error/close handlers", () => {
  let manager: McpManager;
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let transport: MockTransport;

  async function connect(name: string): Promise<void> {
    manager.addServer(name, { command: `run-${name}` });
    const ok = await manager.connectServer(name);
    expect(ok).toBe(true);
    expect(transport.onerror).toBeTypeOf("function");
    expect(transport.onclose).toBeTypeOf("function");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpManager(new Container());
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    transport = makeTransport();
    vi.mocked(Client).mockImplementation(function () {
      return mockClient as never;
    });
    vi.mocked(StdioClientTransport).mockImplementation(function () {
      return transport as never;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.cleanup();
  });

  it("treats a transient SSE disconnect as reconnecting and starts recovery polling", async () => {
    vi.useFakeTimers();
    await connect("s1");
    mockClient.listTools.mockClear();

    transport.onerror!(new Error("SSE stream disconnected: eof"));

    const server = manager.getServer("s1");
    expect(server?.status).toBe("reconnecting");
    expect(server?.error).toBe("SSE stream disconnected: eof");
    // The SDK owns reconnection for transient errors, so no backoff timer.
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
    // The recovery poll re-lists tools after the SDK's delay and converges
    // the status back to connected.
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockClient.listTools).toHaveBeenCalledTimes(1);
    expect(manager.getServer("s1")?.status).toBe("connected");
  });

  it("marks the server as errored on a non-transient transport error", async () => {
    await connect("s1");
    const connection = connectionsOf(manager).get("s1");

    transport.onerror!(new Error("boom"));

    const server = manager.getServer("s1");
    expect(server?.status).toBe("error");
    expect(server?.error).toBe("boom");
    // A non-transient error does not tear the connection down nor reconnect.
    expect(connectionsOf(manager).get("s1")).toBe(connection);
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });

  it("ignores onclose from a stale transport generation", async () => {
    await connect("s1");
    const staleOnClose = transport.onclose!;

    // Simulate the SDK having auto-reconnected with a fresh transport: the
    // manager's connection now points at the new generation.
    const liveTransport = makeTransport();
    connectionsOf(manager).set("s1", { transport: liveTransport });
    manager.updateServerStatus("s1", {
      status: "connected",
      tools: [{ name: "t1", inputSchema: {} }],
      toolCount: 1,
    });

    staleOnClose();

    // The stale close must not tear down the live connection, change status,
    // or schedule a reconnect.
    expect(connectionsOf(manager).get("s1")?.transport).toBe(liveTransport);
    const server = manager.getServer("s1");
    expect(server?.status).toBe("connected");
    expect(server?.toolCount).toBe(1);
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });

  it("tears down the connection and schedules a reconnect when the live transport closes", async () => {
    vi.useFakeTimers();
    await connect("s1");
    manager.updateServerStatus("s1", {
      tools: [{ name: "t1", inputSchema: {} }],
      toolCount: 1,
    });

    transport.onclose!();

    expect(connectionsOf(manager).has("s1")).toBe(false);
    const server = manager.getServer("s1");
    expect(server?.status).toBe("disconnected");
    expect(server?.tools).toEqual([]);
    expect(server?.toolCount).toBe(0);
    expect(reconnectTimersOf(manager).has("s1")).toBe(true);
  });

  it("does not schedule a reconnect when onclose fires during an explicit disconnect", async () => {
    vi.useFakeTimers();
    await connect("s1");
    disconnectingOf(manager).add("s1");

    transport.onclose!();

    expect(connectionsOf(manager).has("s1")).toBe(false);
    expect(manager.getServer("s1")?.status).toBe("disconnected");
    // A user-initiated teardown must not be silently undone by a reconnect.
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });
});
