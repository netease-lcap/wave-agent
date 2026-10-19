import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { Container } from "../../src/utils/container.js";
import { HookBlockedToolError } from "../../src/types/hooks.js";
import type { ToolContext, ToolPlugin } from "../../src/tools/types.js";
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

const PRE_BLOCKED = {
  success: false,
  exitCode: 2,
  stdout: "",
  stderr: "Blocked by policy",
  duration: 5,
  timedOut: false,
};

const POST_BLOCKED = {
  success: false,
  exitCode: 2,
  stdout: "",
  stderr: "Needs formatting",
  duration: 5,
  timedOut: false,
};

function build(
  options: {
    execute?: ToolPlugin["execute"];
    /** Register the fake the way `initializeBuiltInTools` does (validation on). */
    builtIn?: boolean;
    /** The JSON Schema the fake declares for the model. */
    parameters?: Record<string, unknown>;
  } = {},
) {
  const container = new Container();
  const execute =
    options.execute ??
    vi.fn().mockResolvedValue({ success: true, content: "done" });

  const mockMessageManager = {
    addUserMessage: vi.fn(),
    addErrorBlock: vi.fn(),
    getSessionId: vi.fn().mockReturnValue("session-1"),
    getTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
  };

  const hookManager = new HookManager(
    container,
    "/test/workdir",
    new HookMatcher(),
  );

  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
  };

  container.register("PermissionManager", {
    isToolDenied: vi.fn().mockReturnValue(false),
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
  });
  container.register("TaskManager", {});
  container.register("ReversionManager", {});
  container.register("BackgroundTaskManager", {});
  container.register("ForegroundTaskManager", {});
  container.register("LspManager", {});
  container.register("McpManager", mockMcpManager as unknown as McpManager);
  container.register("MessageManager", mockMessageManager);
  container.register("HookManager", hookManager);

  const toolManager = new ToolManager({ container });
  toolManager.register(
    {
      name: "FakeTool",
      config: {
        type: "function",
        function: {
          name: "FakeTool",
          description: "",
          parameters: options.parameters ?? {},
        },
      } as ToolPlugin["config"],
      execute: execute as ToolPlugin["execute"],
    },
    { builtIn: options.builtIn === true },
  );

  hookManager.loadConfiguration({
    PreToolUse: [
      {
        matcher: "FakeTool",
        hooks: [{ type: "command", command: "guard.sh" }],
      },
    ],
    PostToolUse: [
      {
        matcher: "FakeTool",
        hooks: [{ type: "command", command: "lint.sh" }],
      },
    ],
  });

  const context = {
    workdir: "/test/workdir",
  } as unknown as ToolContext;

  return {
    toolManager,
    hookManager,
    execute,
    mockMessageManager,
    context,
    mockMcpManager,
  };
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

describe("ToolManager built-in funnel runs tool-event hooks", () => {
  it("blocks a built-in in PreToolUse without executing it", async () => {
    const { toolManager, execute, context } = build();
    mockExecuteCommand.mockResolvedValue(PRE_BLOCKED);

    const result = await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(result).toEqual({
      success: false,
      content: "PreToolUse:FakeTool hook error: Blocked by policy",
      error: "PreToolUse:FakeTool hook error: Blocked by policy",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("runs the tool and keeps its result when PreToolUse allows the call", async () => {
    const { toolManager, execute, context } = build();

    const result = await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(result).toEqual({ success: true, content: "done" });
    expect(execute).toHaveBeenCalledOnce();
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      "guard.sh",
      expect.objectContaining({ event: "PreToolUse", toolName: "FakeTool" }),
      undefined,
    );
  });

  it("injects a PostToolUse block without rewriting the tool result", async () => {
    const { toolManager, mockMessageManager, context } = build();
    mockExecuteCommand.mockImplementation(
      async (_command: unknown, ctx: unknown) =>
        (ctx as { event: string }).event === "PostToolUse"
          ? POST_BLOCKED
          : { ...PRE_BLOCKED, exitCode: 0, success: true, stderr: "" },
    );

    const result = await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(result).toEqual({ success: true, content: "done" });
    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
      content:
        'PostToolUse:FakeTool hook blocking error from command: "lint.sh": Needs formatting',
      isMeta: true,
    });
  });

  it("runs PostToolUse hooks even when the tool itself failed", async () => {
    const { toolManager, mockMessageManager, context } = build({
      execute: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    mockExecuteCommand.mockImplementation(
      async (_command: unknown, ctx: unknown) =>
        (ctx as { event: string }).event === "PostToolUse"
          ? POST_BLOCKED
          : { ...PRE_BLOCKED, exitCode: 0, success: true, stderr: "" },
    );

    const result = await toolManager.execute("FakeTool", {}, context);

    expect(result).toEqual({ success: false, content: "", error: "disk full" });
    expect(mockMessageManager.addUserMessage).toHaveBeenCalledOnce();
  });
});

describe("ToolManager MCP funnel keeps a hook block's wording", () => {
  it("returns the hook's message verbatim when the MCP call was blocked", async () => {
    const { toolManager, context, mockMcpManager } = build();
    mockMcpManager.isMcpTool.mockReturnValue(true);
    mockMcpManager.executeMcpToolByRegistry.mockRejectedValue(
      new HookBlockedToolError("PreToolUse:mcp__srv__t hook error: nope"),
    );

    const result = await toolManager.execute("mcp__srv__t", {}, context);

    expect(result).toEqual({
      success: false,
      content: "PreToolUse:mcp__srv__t hook error: nope",
      error: "PreToolUse:mcp__srv__t hook error: nope",
    });
  });

  it("keeps the content empty for an ordinary MCP failure", async () => {
    const { toolManager, context, mockMcpManager } = build();
    mockMcpManager.isMcpTool.mockReturnValue(true);
    mockMcpManager.executeMcpToolByRegistry.mockRejectedValue(
      new Error("server gone"),
    );

    const result = await toolManager.execute("mcp__srv__t", {}, context);

    expect(result).toEqual({
      success: false,
      content: "",
      error: "server gone",
    });
  });
});

describe("ToolManager checks built-in arguments before running the tool", () => {
  const SCHEMA = {
    type: "object",
    properties: { taskId: { type: "string" } },
    required: ["taskId"],
  };

  it("refuses a call whose arguments do not match the declared schema", async () => {
    const { toolManager, execute, context } = build({
      builtIn: true,
      parameters: SCHEMA,
    });

    const result = await toolManager.execute("FakeTool", { id: "2" }, context);

    expect(result).toEqual({
      success: false,
      content: [
        "FakeTool failed due to the following issues:",
        "The required parameter `taskId` is missing",
        "An unexpected parameter `id` was provided",
      ].join("\n"),
      error: [
        "FakeTool failed due to the following issues:",
        "The required parameter `taskId` is missing",
        "An unexpected parameter `id` was provided",
      ].join("\n"),
    });
    // The tool never ran, and no hook saw the call: a malformed argument list is
    // neither an execution nor a permission question.
    expect(execute).not.toHaveBeenCalled();
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it("runs a built-in whose arguments match the declaration", async () => {
    const { toolManager, execute, context } = build({
      builtIn: true,
      parameters: SCHEMA,
    });

    const result = await toolManager.execute(
      "FakeTool",
      { taskId: "2" },
      context,
    );

    expect(result).toEqual({ success: true, content: "done" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not validate a custom tool, whose schema is not wave's contract", async () => {
    const { toolManager, execute, context } = build({ parameters: SCHEMA });

    const result = await toolManager.execute("FakeTool", { id: "2" }, context);

    expect(result).toEqual({ success: true, content: "done" });
    expect(execute).toHaveBeenCalledOnce();
  });
});
