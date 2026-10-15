import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { ToolContext } from "../../src/tools/types.js";

const { recordToolActivity } = vi.hoisted(() => ({
  recordToolActivity: vi.fn(),
}));

vi.mock("../../src/telemetry/metrics.js", () => ({ recordToolActivity }));

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

const context = {
  sessionId: "session-1",
  workdir: "/test/workdir",
} as ToolContext;

/** The standard-attribute context every record carries for this context. */
const recordContext = { sessionId: "session-1", workdir: "/test/workdir" };

/** A connected server exposing one tool, with the call result the test wants. */
function build(toolName: string, callTool: ReturnType<typeof vi.fn>) {
  const mcpManager = new McpManager(new Container());
  mcpManager.initialize("/test/workdir");
  mcpManager.addServer("gh", { command: "c1" });
  mcpManager.updateServerStatus("gh", {
    status: "connected",
    tools: [{ name: toolName, inputSchema: {} }],
  });
  (
    mcpManager as unknown as { connections: Map<string, { client: unknown }> }
  ).connections.set("gh", { client: { callTool } });
  return mcpManager;
}

describe("McpManager creation counters", () => {
  let mcpManager: McpManager | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await mcpManager?.cleanup();
    mcpManager = undefined;
  });

  it("records the pull request an MCP create tool made", async () => {
    mcpManager = build(
      "create_pull_request",
      vi.fn().mockResolvedValue({ content: "created #12" }),
    );

    await mcpManager.executeMcpTool(
      "mcp__gh__create_pull_request",
      { title: "x" },
      context,
    );

    expect(recordToolActivity).toHaveBeenCalledWith(
      { commits: false, pullRequests: true },
      recordContext,
    );
  });

  it("stays silent when the server call failed", async () => {
    mcpManager = build(
      "create_pull_request",
      vi.fn().mockRejectedValue(new Error("server exploded")),
    );

    await expect(
      mcpManager.executeMcpTool("mcp__gh__create_pull_request", {}, context),
    ).rejects.toThrow("server exploded");

    expect(recordToolActivity).not.toHaveBeenCalled();
  });

  it("records nothing for a tool that creates no PR", async () => {
    mcpManager = build(
      "get_pull_request",
      vi.fn().mockResolvedValue({ content: "#12" }),
    );

    await mcpManager.executeMcpTool(
      "mcp__gh__get_pull_request",
      { number: 12 },
      context,
    );

    expect(recordToolActivity).toHaveBeenCalledWith(
      { commits: false, pullRequests: false },
      recordContext,
    );
  });
});
