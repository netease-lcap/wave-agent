import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { promises as fs } from "fs";

const { mockReportMcpConnectionFailure } = vi.hoisted(() => ({
  mockReportMcpConnectionFailure: vi.fn(),
}));

vi.mock("../../src/telemetry/failureEvents.js", () => ({
  reportMcpConnectionFailure: mockReportMcpConnectionFailure,
}));

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

const SESSION_ID = "session-1";
const WORKDIR = resolve("/test/workdir");

interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getInstructions: ReturnType<typeof vi.fn>;
}

/**
 * A dialect of the SDK mocks the rest of the manager tests use, wired through
 * every transport constructor: the cases below only care about how a dial can
 * end, so the client is whatever a case says it is.
 */
function wireSdk(client: Partial<MockClient>): MockClient {
  const full: MockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    getInstructions: vi.fn().mockReturnValue(undefined),
    ...client,
  };
  const transport = {
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
    stderr: null,
  };
  vi.mocked(Client).mockImplementation(function () {
    return full as never;
  });
  for (const Ctor of [
    StdioClientTransport,
    SSEClientTransport,
    StreamableHTTPClientTransport,
  ]) {
    vi.mocked(Ctor).mockImplementation(function () {
      return transport as never;
    });
  }
  return full;
}

function createContainer(sessionId: string | null = SESSION_ID): Container {
  const container = new Container();
  container.register("SessionWorkdir", "/test/workdir");
  container.register("MessageManager", {
    getSessionId: () => sessionId ?? undefined,
  });
  return container;
}

describe("MCP connection failure telemetry", () => {
  let manager: McpManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReportMcpConnectionFailure.mockResolvedValue(undefined);
    // `initialize()` reads the config (and the tools cache) on its own. Let it
    // see a valid, empty config so a case only observes the failure it sets up
    // itself.
    vi.mocked(fs.readFile).mockResolvedValue('{"mcpServers":{}}');
    manager = new McpManager(createContainer());
  });

  afterEach(async () => {
    await manager.cleanup();
  });

  it("reports an unreadable MCP config as a config-phase failure", async () => {
    await manager.initialize("/test/workdir");
    mockReportMcpConnectionFailure.mockClear();
    vi.mocked(fs.readFile).mockRejectedValue(
      new Error("EACCES: permission denied"),
    );

    await manager.loadConfig();

    // Both config sources are unreadable: the user-level file and the
    // project's `.mcp.json` each get one report.
    expect(mockReportMcpConnectionFailure).toHaveBeenCalledTimes(2);
    const reports = mockReportMcpConnectionFailure.mock.calls.map((c) => c[0]);
    expect(reports.map((r) => r.serverName)).toEqual(
      expect.arrayContaining([".mcp.json", "mcp.json"]),
    );
    for (const report of reports) {
      expect(report).toMatchObject({
        sessionId: SESSION_ID,
        phase: "config",
        reason: "config",
      });
    }
  });

  it("does not report a config file that simply does not exist", async () => {
    await manager.initialize("/test/workdir");
    mockReportMcpConnectionFailure.mockClear();
    const missing = new Error("no such file") as Error & { code: string };
    missing.code = "ENOENT";
    vi.mocked(fs.readFile).mockRejectedValue(missing);

    await manager.loadConfig();

    // A machine with no MCP config is the normal case, not a failure.
    expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
  });

  it("stays quiet when the session cannot be identified", async () => {
    manager = new McpManager(createContainer(null));
    await manager.initialize("/test/workdir");
    mockReportMcpConnectionFailure.mockClear();
    vi.mocked(fs.readFile).mockRejectedValue(new Error("EACCES"));

    await manager.loadConfig();

    expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
  });

  /**
   * Four ways a dial never attempts a connection and one way it succeeds,
   * collected so the boundary stays visible: only a real failure reports.
   * Spec `ecosystem/mcp.md` 边界情况「没有真正尝试的连接不算失败」/「拨号与销毁竞态」.
   */
  describe("dials that are not connection failures", () => {
    /** Register one stdio server and hand back a manager ready to dial it. */
    async function ready(config: Record<string, unknown> = {}) {
      await manager.initialize(WORKDIR);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            weather: { command: "npx", args: ["weather-mcp"], ...config },
          },
        }),
      );
      await manager.loadConfig();
      // Config loading is a different surface; this block only watches dials.
      mockReportMcpConnectionFailure.mockClear();
    }

    it("does not report a server that is not registered", async () => {
      await ready();
      const client = wireSdk({});

      expect((await manager.connectServer("ghost")).ok).toBe(false);

      expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
      // Nothing was attempted — no client, no process.
      expect(client.connect).not.toHaveBeenCalled();
    });

    it("does not report a dial skipped by a destroyed manager", async () => {
      await ready();
      await manager.cleanup();

      expect((await manager.connectServer("weather")).ok).toBe(false);

      expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
    });

    it("does not report a dial skipped while a user teardown is in flight", async () => {
      await ready();
      // Exactly what `disconnectServer` marks before it starts closing: an
      // auto-reconnect timer that fires in that window must not spawn a second
      // process — and must not be counted as a failed connection either.
      (manager as unknown as { disconnecting: Set<string> }).disconnecting.add(
        "weather",
      );
      const client = wireSdk({});

      expect((await manager.connectServer("weather")).ok).toBe(false);

      expect(client.connect).not.toHaveBeenCalled();
      expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
    });

    it("does not report an automatic dial of a server the user disconnected", async () => {
      await ready();
      // The user's explicit disconnect, as `disconnectServer` records it.
      (
        manager as unknown as { userDisconnected: Set<string> }
      ).userDisconnected.add("weather");
      const client = wireSdk({});

      expect((await manager.connectServer("weather")).ok).toBe(false);

      expect(client.connect).not.toHaveBeenCalled();
      expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
    });

    it("does not report a connection that outlived its owner", async () => {
      await ready();
      let releaseConnect!: () => void;
      const client = wireSdk({
        connect: vi.fn(
          () =>
            new Promise<void>((resolveConnect) => {
              releaseConnect = resolveConnect;
            }),
        ),
      });

      // The dial is in flight when the session is torn down — the race spec
      // `ecosystem/mcp.md` 边界情况「拨号与销毁竞态」 describes.
      const dials = manager.connectPendingServers();
      await vi.waitFor(() => expect(releaseConnect).toBeTypeOf("function"));
      await manager.cleanup();
      releaseConnect();
      await dials;

      // The connection succeeded, so "failed to connect" would be the opposite
      // of what happened: no error event, status back to disconnected.
      expect(client.connect).toHaveBeenCalled();
      expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
      expect(manager.getServer("weather")?.status).toBe("disconnected");
    });

    it("only reports the failed outcome, whatever the dial answered", async () => {
      // The scheduler's own boundary: it sees the outcome and must report on
      // exactly one of the four shapes.
      for (const outcome of [
        {
          ok: false as const,
          kind: "skipped" as const,
          skip: "destroyed" as const,
        },
        { ok: false as const, kind: "abandoned" as const },
      ]) {
        await ready();
        vi.spyOn(manager, "connectServer").mockResolvedValue(outcome);
        await manager.connectPendingServers();
        expect(mockReportMcpConnectionFailure).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      }
    });

    it("reports a real failure with its reason and a sanitized summary", async () => {
      await ready();
      const failure = new Error(
        `spawn npx ENOENT (cwd ${WORKDIR}, see https://bot:s3cret@example.com/t?token=abc)`,
      ) as Error & { code: string };
      failure.code = "ENOENT";
      wireSdk({ connect: vi.fn().mockRejectedValue(failure) });

      await manager.connectPendingServers();

      expect(mockReportMcpConnectionFailure).toHaveBeenCalledTimes(1);
      const report = mockReportMcpConnectionFailure.mock.calls[0][0];
      expect(report).toMatchObject({
        sessionId: SESSION_ID,
        serverName: "weather",
        phase: "lazy",
        reason: "spawn",
        error: failure,
      });
      // The summary carries the reason but no customer path and no token.
      expect(report.message).toContain("spawn npx ENOENT");
      expect(report.message).not.toContain(WORKDIR);
      expect(report.message).not.toContain("s3cret");
      expect(report.message).not.toContain("token=abc");
    });

    it("marks a failed listTools() as its own reason", async () => {
      await ready();
      wireSdk({
        listTools: vi.fn().mockRejectedValue(new Error("tools/list blew up")),
      });

      await manager.connectPendingServers();

      const report = mockReportMcpConnectionFailure.mock.calls[0][0];
      expect(report).toMatchObject({ reason: "list_tools" });
    });
  });
});
