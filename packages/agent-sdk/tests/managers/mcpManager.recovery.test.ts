import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  McpManager,
  MCP_RECONNECT_BASE_DELAY_MS,
  MCP_RECONNECT_COOLDOWN_MS,
  MCP_RECONNECT_MAX_ATTEMPTS,
  MCP_RECONNECT_MAX_DELAY_MS,
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

function reconnectAttemptsOf(manager: McpManager) {
  return (manager as unknown as { reconnectAttempts: Map<string, number> })
    .reconnectAttempts;
}

function reconnectEligibleAtOf(manager: McpManager) {
  return (manager as unknown as { reconnectEligibleAt: Map<string, number> })
    .reconnectEligibleAt;
}

describe("McpManager recovery of down servers (使用前重拨)", () => {
  let manager: McpManager;
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
  };

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
    vi.mocked(Client).mockImplementation(function () {
      return mockClient as never;
    });
    vi.mocked(StdioClientTransport).mockImplementation(function () {
      return {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
        stderr: null,
      } as never;
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await manager.cleanup();
  });

  it("does not redial inside the backoff window, and dials once it expires", async () => {
    vi.useFakeTimers();
    manager.addServer("s1", { command: "run-s1" });
    mockClient.connect.mockRejectedValueOnce(new Error("down"));

    expect(await manager.connectServer("s1")).toBe(false);
    expect(manager.getServer("s1")?.status).toBe("error");
    expect(reconnectAttemptsOf(manager).get("s1")).toBe(1);

    const dial = vi.spyOn(manager, "connectServer");
    await manager.recoverServers();
    expect(dial).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MCP_RECONNECT_BASE_DELAY_MS - 1);
    await manager.recoverServers();
    expect(dial).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await manager.recoverServers();
    expect(dial).toHaveBeenCalledTimes(1);
    // Back from the dead: no `error` left, and the backoff counter is cleared.
    const server = manager.getServer("s1");
    expect(server?.status).toBe("connected");
    expect(server?.error).toBeUndefined();
    expect(reconnectAttemptsOf(manager).get("s1")).toBeUndefined();
  });

  it("dials in the background: the turn does not wait for the recovery", async () => {
    vi.useFakeTimers();
    manager.addServer("s1", { command: "run-s1" });
    mockClient.connect.mockRejectedValueOnce(new Error("down"));
    await manager.connectServer("s1");
    await vi.advanceTimersByTimeAsync(MCP_RECONNECT_BASE_DELAY_MS);

    let release!: () => void;
    mockClient.connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const recovery = manager.recoverServers();
    expect(manager.getServer("s1")?.status).toBe("connecting");
    // Still dialing is neither "available" nor "gone": the announcement path
    // must be able to tell those apart, and the turn must not wait for it.
    expect(manager.getPendingServerNames()).toEqual(["s1"]);
    expect(manager.getServerInstructions()).toEqual([]);
    expect(manager.waitForTurnDials()).toBeUndefined();

    release();
    await recovery;
    expect(manager.getServer("s1")?.status).toBe("connected");
    expect(manager.getPendingServerNames()).toEqual([]);
    expect(manager.getServerInstructions().map((entry) => entry.name)).toEqual([
      "s1",
    ]);
  });

  it("never resurrects a server the user disconnected", async () => {
    vi.useFakeTimers();
    manager.addServer("s1", { command: "run-s1" });
    expect(await manager.connectServer("s1")).toBe(true);

    expect(await manager.disconnectServer("s1")).toBe(true);
    // Pretend the backoff window has long expired: the user's decision, not the
    // window, is what has to keep this server down.
    reconnectEligibleAtOf(manager).set("s1", 0);

    const dial = vi.spyOn(manager, "connectServer");
    await manager.recoverServers();
    expect(dial).not.toHaveBeenCalled();
    expect(manager.getServer("s1")?.status).toBe("disconnected");
  });

  it("cools down for ten minutes after ten consecutive failures", async () => {
    vi.useFakeTimers();
    manager.addServer("s1", { command: "run-s1" });
    mockClient.connect.mockRejectedValue(new Error("down"));

    for (let i = 0; i < MCP_RECONNECT_MAX_ATTEMPTS; i++) {
      expect(await manager.connectServer("s1")).toBe(false);
    }
    expect(reconnectAttemptsOf(manager).get("s1")).toBe(
      MCP_RECONNECT_MAX_ATTEMPTS,
    );

    const dial = vi.spyOn(manager, "connectServer");
    await manager.recoverServers();
    expect(dial).not.toHaveBeenCalled();

    // The 300 s cap still applied to the attempt that just failed; spending the
    // whole budget is what buys the 600 s cooldown.
    await vi.advanceTimersByTimeAsync(MCP_RECONNECT_MAX_DELAY_MS);
    await manager.recoverServers();
    expect(dial).not.toHaveBeenCalled();

    // The cooldown ends: the next turn may try again.
    await vi.advanceTimersByTimeAsync(
      MCP_RECONNECT_COOLDOWN_MS - MCP_RECONNECT_MAX_DELAY_MS,
    );
    await manager.recoverServers();
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("is a no-op once the manager was destroyed", async () => {
    await manager.cleanup();
    await expect(manager.recoverServers()).resolves.toBeUndefined();
  });
});
