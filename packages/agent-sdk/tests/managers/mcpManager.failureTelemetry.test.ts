import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
vi.mock("fs");

const SESSION_ID = "session-1";

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
});
