import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { Container } from "../../src/utils/container.js";
import { HookBlockedToolError } from "../../src/types/hooks.js";
import type { ToolContext } from "../../src/tools/types.js";
import * as hookService from "../../src/services/hook.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/hook.js", async () => {
  const actual = (await vi.importActual(
    "../../src/services/hook.js",
  )) as Record<string, unknown>;
  return {
    ...actual,
    executeCommand: vi.fn(),
    isCommandSafe: vi.fn().mockReturnValue(true),
  };
});
const mockExecuteCommand = vi.mocked(hookService.executeCommand);

vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("fs");

const TOOL_NAME = "mcp__s1__t1";

function build() {
  const container = new Container();
  const mockMessageManager = {
    addUserMessage: vi.fn(),
    addNoticeBlock: vi.fn(),
    getSessionId: vi.fn().mockReturnValue("session-1"),
    getTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
  };
  const hookManager = new HookManager(
    container,
    "/test/workdir",
    new HookMatcher(),
  );

  const mcpManager = new McpManager(container);
  mcpManager.initialize("/test/workdir");
  mcpManager.addServer("s1", { command: "c1" });
  mcpManager.updateServerStatus("s1", {
    status: "connected",
    tools: [{ name: "t1", inputSchema: {} }],
  });

  const callTool = vi.fn().mockResolvedValue({ content: "tool output" });
  (
    mcpManager as unknown as { connections: Map<string, { client: unknown }> }
  ).connections.set("s1", { client: { callTool } });

  hookManager.loadConfiguration({
    PreToolUse: [
      { matcher: TOOL_NAME, hooks: [{ type: "command", command: "guard.sh" }] },
    ],
    PostToolUse: [
      { matcher: TOOL_NAME, hooks: [{ type: "command", command: "lint.sh" }] },
    ],
  });

  const context = {
    workdir: "/test/workdir",
    hookManager,
    messageManager: mockMessageManager,
  } as unknown as ToolContext;

  return { mcpManager, hookManager, callTool, mockMessageManager, context };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteCommand.mockResolvedValue({
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    duration: 5,
    timedOut: false,
  });
});

describe("McpManager.executeMcpTool runs tool-event hooks", () => {
  it("refuses a call blocked by PreToolUse before the server is contacted", async () => {
    const { mcpManager, callTool, context } = build();
    mockExecuteCommand.mockResolvedValue({
      success: false,
      exitCode: 2,
      stdout: "",
      stderr: "Blocked by policy",
      duration: 5,
      timedOut: false,
    });

    await expect(
      mcpManager.executeMcpTool(TOOL_NAME, { q: "hi" }, context),
    ).rejects.toBeInstanceOf(HookBlockedToolError);
    await expect(
      mcpManager.executeMcpTool(TOOL_NAME, { q: "hi" }, context),
    ).rejects.toThrow(`PreToolUse:${TOOL_NAME} hook error: Blocked by policy`);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("returns the tool result and injects a PostToolUse block as a user message", async () => {
    const { mcpManager, mockMessageManager, context } = build();
    mockExecuteCommand.mockImplementation(
      async (_command: unknown, ctx: unknown) =>
        (ctx as { event: string }).event === "PostToolUse"
          ? {
              success: false,
              exitCode: 2,
              stdout: "",
              stderr: "Needs formatting",
              duration: 5,
              timedOut: false,
            }
          : {
              success: true,
              exitCode: 0,
              stdout: "",
              stderr: "",
              duration: 5,
              timedOut: false,
            },
    );

    const result = await mcpManager.executeMcpTool(
      TOOL_NAME,
      { q: "hi" },
      context,
    );

    expect(result.content).toBe("tool output");
    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
      content: `PostToolUse:${TOOL_NAME} hook blocking error from command: "lint.sh": Needs formatting`,
      isMeta: true,
    });
  });

  it("runs PostToolUse hooks when the server call failed", async () => {
    const { mcpManager, callTool, mockMessageManager, context } = build();
    callTool.mockRejectedValue(new Error("server exploded"));
    mockExecuteCommand.mockImplementation(
      async (_command: unknown, ctx: unknown) =>
        (ctx as { event: string }).event === "PostToolUse"
          ? {
              success: false,
              exitCode: 1,
              stdout: "",
              stderr: "lint warning",
              duration: 5,
              timedOut: false,
            }
          : {
              success: true,
              exitCode: 0,
              stdout: "",
              stderr: "",
              duration: 5,
              timedOut: false,
            },
    );

    await expect(
      mcpManager.executeMcpTool(TOOL_NAME, {}, context),
    ).rejects.toThrow("server exploded");
    expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
      "lint warning",
      "error",
    );
  });

  it("leaves a call with no hook manager untouched", async () => {
    const { mcpManager, context } = build();

    const result = await mcpManager.executeMcpTool(
      TOOL_NAME,
      {},
      {
        ...context,
        hookManager: undefined,
      },
    );

    expect(result.content).toBe("tool output");
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it("hands PostToolUse the server's content blocks as tool_response, plus mcp_server", async () => {
    // MCP 工具在 CC 里同样是标准 ToolResult：`tool_response` 是它自己的 Output
    // （服务端回来的 content 块数组），另带 `mcp_server` 说是谁答的
    // （`0172:9985`）。不给 `data` 的话改完之后 `tool_response` 会是空的。
    const { mcpManager, callTool, context } = build();
    callTool.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
    });

    await mcpManager.executeMcpTool(TOOL_NAME, { q: "hi" }, {
      ...context,
      toolCallId: "toolu_01",
    } as ToolContext);

    const hookContext = mockExecuteCommand.mock.calls
      .map((call) => call[1])
      .find((ctx) => (ctx as { event: string }).event === "PostToolUse") as {
      toolResponse?: unknown;
      toolUseId?: string;
      durationMs?: number;
      mcpServer?: unknown;
    };
    expect(hookContext.toolResponse).toEqual([{ type: "text", text: "hi" }]);
    expect(hookContext.toolUseId).toBe("toolu_01");
    expect(hookContext.durationMs).toBeGreaterThanOrEqual(0);
    // 这台服务器是测试里手工 addServer 进去的，没有配置 scope ⇒ CC 的默认档。
    expect(hookContext.mcpServer).toEqual({ name: "s1", source: "dynamic" });
  });
});
