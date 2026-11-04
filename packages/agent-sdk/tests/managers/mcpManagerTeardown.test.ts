import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Teardown guarantees of the lazy dial (spec ecosystem/mcp.md 场景 7 与边界情况
// 「拨号与销毁竞态」): a dial that lands after its owner was destroyed, or that
// fails after the process was spawned, must not leave a process tree behind. The
// handshake is held open by a deferred promise so both races are deterministic.

vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("@modelcontextprotocol/sdk/client/sse.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Mocks {
  client: {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
  };
  transport: {
    close: ReturnType<typeof vi.fn>;
    onerror: unknown;
    onclose: unknown;
    stderr: unknown;
  };
}

function installMocks(gate?: Deferred): Mocks {
  const client: Mocks["client"] = {
    connect: gate
      ? vi.fn(() => gate.promise)
      : vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    getInstructions: vi.fn().mockReturnValue(undefined),
  };
  const transport: Mocks["transport"] = {
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
    stderr: null,
  };
  vi.mocked(Client).mockImplementation(function () {
    return client as never;
  });
  vi.mocked(StdioClientTransport).mockImplementation(function () {
    return transport as never;
  });
  return { client, transport };
}

function makeManager(): McpManager {
  // Servers via the constructor option: registered without touching the fs.
  return new McpManager(new Container(), {
    mcpServers: { weather: { type: "stdio", command: "stub-server" } },
  });
}

function connectionCount(manager: McpManager): number {
  return (manager as unknown as { connections: Map<string, unknown> })
    .connections.size;
}

describe("McpManager lazy dial teardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes a dial that lands after the owner was destroyed", async () => {
    const gate = deferred();
    const { client, transport } = installMocks(gate);
    const manager = makeManager();
    await manager.initialize("/test/workdir");

    // A turn starts the dial, then the Agent is destroyed before the handshake
    // completes (delete session / app quit / daemon stop).
    const dial = manager.connectPendingServers();
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(1));
    await manager.cleanup();
    gate.resolve();
    await dial;

    // Nothing may survive: no connection entry, and the transport it produced
    // is closed rather than left running with no owner.
    expect(connectionCount(manager)).toBe(0);
    expect(transport.close).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
    expect(manager.getServer("weather")?.status).toBe("disconnected");
  });

  it("closes the transport when a dial fails after spawning the process", async () => {
    // `connect()` succeeds but the handshake's follow-up (`listTools`) throws —
    // the process is already running and nothing else references it.
    const { client, transport } = installMocks();
    client.listTools.mockRejectedValue(new Error("handshake exploded"));
    const manager = makeManager();
    await manager.initialize("/test/workdir");

    await manager.connectPendingServers();

    expect(manager.getServer("weather")?.status).toBe("error");
    expect(connectionCount(manager)).toBe(0);
    expect(transport.close).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });

  it("cleanup() is idempotent", async () => {
    installMocks();
    const manager = makeManager();
    await manager.initialize("/test/workdir");
    await manager.connectPendingServers();

    await manager.cleanup();
    await expect(manager.cleanup()).resolves.toBeUndefined();

    expect(manager.getServer("weather")?.status).toBe("disconnected");
    expect(connectionCount(manager)).toBe(0);
  });
});
