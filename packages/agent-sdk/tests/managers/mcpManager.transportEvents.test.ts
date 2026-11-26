import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  McpManager,
  MCP_CALLS_DRAIN_TIMEOUT_MS,
  MCP_TRANSPORT_ERROR_LIMIT,
} from "../../src/managers/mcpManager.js";
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

function transportErrorsOf(manager: McpManager) {
  return (manager as unknown as { transportErrors: Map<string, number> })
    .transportErrors;
}

function messageStreamLostOf(manager: McpManager) {
  return (manager as unknown as { messageStreamLost: Set<string> })
    .messageStreamLost;
}

describe("McpManager transport error/close handlers", () => {
  let manager: McpManager;
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
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
      getInstructions: vi.fn().mockReturnValue("Use lookup before mutate."),
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

  it("keeps a server usable when its downstream notification stream dies", async () => {
    await connect("s1");
    manager.updateServerStatus("s1", {
      tools: [{ name: "t1", inputSchema: {} }],
      toolCount: 1,
    });

    transport.onerror!(
      new Error("SSE stream disconnected: TypeError: terminated"),
    );

    // A dead GET stream is not a dead server: `tools/call` is a separate POST
    // that still goes through. So the status, the tools and the usage notes all
    // stay, and nothing is scheduled.
    const server = manager.getServer("s1");
    expect(server?.status).toBe("connected");
    expect(server?.error).toBeUndefined();
    expect(manager.getAllConnectedTools().map((tool) => tool.name)).toEqual([
      "t1",
    ]);
    expect(manager.getServerInstructions().map((entry) => entry.name)).toEqual([
      "s1",
    ]);
    expect(transportErrorsOf(manager).get("s1")).toBe(1);
    expect(messageStreamLostOf(manager).has("s1")).toBe(true);
    expect(connectionsOf(manager).has("s1")).toBe(true);
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });

  it("counts a body timeout and the SDK giving up without touching state", async () => {
    await connect("s1");

    transport.onerror!(new Error("Body Timeout Error"));
    transport.onerror!(
      new Error("Maximum reconnection attempts (2) exceeded."),
    );

    expect(manager.getServer("s1")?.status).toBe("connected");
    expect(transportErrorsOf(manager).get("s1")).toBe(2);
    expect(connectionsOf(manager).has("s1")).toBe(true);
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });

  it("treats an unclassified transport error the same way: counted, not fatal", async () => {
    await connect("s1");
    const connection = connectionsOf(manager).get("s1");

    transport.onerror!(new Error("boom"));

    const server = manager.getServer("s1");
    expect(server?.status).toBe("connected");
    expect(server?.error).toBeUndefined();
    // One error is not enough to tear the connection down.
    expect(connectionsOf(manager).get("s1")).toBe(connection);
    expect(transportErrorsOf(manager).get("s1")).toBe(1);
    expect(reconnectTimersOf(manager).has("s1")).toBe(false);
  });

  it("recycles the connection on the third consecutive transport error", async () => {
    vi.useFakeTimers();
    await connect("s1");
    manager.updateServerStatus("s1", {
      tools: [{ name: "t1", inputSchema: {} }],
      toolCount: 1,
    });

    for (let i = 0; i < MCP_TRANSPORT_ERROR_LIMIT; i++) {
      transport.onerror!(
        new Error(`SSE stream disconnected: Body Timeout Error ${i}`),
      );
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionsOf(manager).has("s1")).toBe(false);
    expect(mockClient.close).toHaveBeenCalled();
    const server = manager.getServer("s1");
    expect(server?.status).toBe("disconnected");
    expect(server?.tools).toEqual([]);
    // No error state: the server is being redialed, not written off.
    expect(server?.error).toBeUndefined();
    expect(transportErrorsOf(manager).get("s1")).toBeUndefined();
    expect(reconnectTimersOf(manager).has("s1")).toBe(true);
  });

  it("waits for an in-flight tool call before recycling the connection", async () => {
    vi.useFakeTimers();
    await connect("s1");
    manager.updateServerStatus("s1", {
      tools: [{ name: "sendFile", inputSchema: {} }],
      toolCount: 1,
    });

    let finishCall!: (value: unknown) => void;
    mockClient.callTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCall = resolve;
        }),
    );

    const call = manager.executeMcpTool("mcp__s1__sendFile", {});
    for (let i = 0; i < MCP_TRANSPORT_ERROR_LIMIT; i++) {
      transport.onerror!(new Error("terminated"));
    }
    await vi.advanceTimersByTimeAsync(0);

    // A `sendFile` already on the wire is never cut in half.
    expect(connectionsOf(manager).has("s1")).toBe(true);
    expect(mockClient.close).not.toHaveBeenCalled();

    finishCall({ content: [{ type: "text", text: "sent" }] });
    await expect(call).resolves.toMatchObject({ content: "sent" });
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionsOf(manager).has("s1")).toBe(false);
    expect(manager.getServer("s1")?.status).toBe("disconnected");
  });

  it("cuts off a call that never finishes after the drain timeout", async () => {
    vi.useFakeTimers();
    await connect("s1");
    manager.updateServerStatus("s1", {
      tools: [{ name: "hang", inputSchema: {} }],
      toolCount: 1,
    });
    mockClient.callTool.mockImplementation(() => new Promise(() => {}));

    void manager.executeMcpTool("mcp__s1__hang", {});
    for (let i = 0; i < MCP_TRANSPORT_ERROR_LIMIT; i++) {
      transport.onerror!(new Error("terminated"));
    }
    // Still waiting: the call has no timeout of its own.
    await vi.advanceTimersByTimeAsync(MCP_CALLS_DRAIN_TIMEOUT_MS - 1);
    expect(connectionsOf(manager).has("s1")).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(connectionsOf(manager).has("s1")).toBe(false);
    expect(manager.getServer("s1")?.status).toBe("disconnected");
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
    // The server's own usage notes go with it: a server that is gone must stop
    // talking to the model.
    expect(server?.instructions).toBeUndefined();
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
