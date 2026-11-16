import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { Container } from "../../src/utils/container.js";
import { HookBlockedToolError } from "../../src/types/hooks.js";
import { MOD_LIMITS } from "../../src/types/mods.js";
import type { ModManager } from "../../src/managers/modManager.js";
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
    /** 容器里接一个 ModManager 替身（`tool.call` 的派发点）。 */
    dispatchToolCall?: (event: unknown) => Promise<string | undefined>;
    /** `tool.run` 的派发点：不给就照常把工具跑掉（与真实现一致）。 */
    dispatchToolRun?: (
      event: unknown,
      run: () => Promise<unknown>,
    ) => Promise<{ deny?: string }>;
    /** 影子事件的观察点（`classic.PostToolUse` 族）。 */
    notifyMods?: (event: string, payload: unknown) => void;
  } = {},
) {
  const container = new Container();
  const execute =
    options.execute ??
    vi.fn().mockResolvedValue({ success: true, content: "done" });

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
  if (
    options.dispatchToolCall ||
    options.dispatchToolRun ||
    options.notifyMods
  ) {
    container.register("ModManager", {
      dispatchToolCall: options.dispatchToolCall ?? (async () => undefined),
      dispatchToolRun:
        options.dispatchToolRun ??
        (async (_event, run) => {
          await run();
          return {};
        }),
      notifyMods: options.notifyMods ?? vi.fn(),
      currentPermissionMode: () => "default",
    } as unknown as ModManager);
  }

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
    // 模型消息里那次调用的 id：影子事件按 CC 的形状转成 `tool_use_id`。
    toolCallId: "call_1",
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

  // spec「拦下一次工具调用」/「在工具真正跑之前插一脚」：`tool.call` 在执行之
  // 前就问，`tool.run` 的 `next(e)` 才是执行本身。
  it("tool.call 与 tool.run 都拿到工具名、调用 id 与顶层铺开的参数", async () => {
    const dispatchToolCall = vi.fn(async () => undefined);
    const dispatchToolRun = vi.fn(
      async (_event: unknown, run: () => Promise<unknown>) => {
        await run();
        return {};
      },
    );
    const { toolManager, context } = build({
      dispatchToolCall,
      dispatchToolRun,
    });

    await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(dispatchToolCall).toHaveBeenCalledWith({
      a: 1,
      tool: "FakeTool",
      tool_use_id: expect.any(String),
      input: { a: 1 },
    });
    expect(dispatchToolRun).toHaveBeenCalledOnce();
    expect(dispatchToolRun.mock.calls[0]?.[0]).toMatchObject({
      a: 1,
      tool: "FakeTool",
      input: { a: 1 },
    });
  });

  it("插件在 tool.call 里拦下时不执行工具，模型收到那段文本", async () => {
    const { toolManager, execute, context } = build({
      dispatchToolCall: vi.fn(async () => "rm -rf 太危险，改用删除单文件"),
    });

    const result = await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(result).toEqual({
      success: false,
      content: "rm -rf 太危险，改用删除单文件",
      error: "rm -rf 太危险，改用删除单文件",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("插件在 tool.run 里不放行时不执行工具", async () => {
    const { toolManager, execute, context } = build({
      dispatchToolRun: vi.fn(async () => ({ deny: "先 pull 一下" })),
    });

    const result = await toolManager.execute("FakeTool", {}, context);

    expect(result).toEqual({
      success: false,
      content: "先 pull 一下",
      error: "先 pull 一下",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("工具抛错也照样经过 tool.run 的 next（结果与以前一致）", async () => {
    const dispatchToolRun = vi.fn(
      async (_event: unknown, run: () => Promise<unknown>) => {
        await run();
        return {};
      },
    );
    const { toolManager, context } = build({
      dispatchToolCall: vi.fn(async () => undefined),
      dispatchToolRun,
      execute: vi.fn().mockRejectedValue(new Error("disk full")),
    });

    const result = await toolManager.execute("FakeTool", {}, context);

    expect(result).toEqual({ success: false, content: "", error: "disk full" });
    expect(dispatchToolRun).toHaveBeenCalledOnce();
  });

  it("PreToolUse 拦下时不进入 tool.run（工具根本没跑）", async () => {
    const dispatchToolRun = vi.fn(async () => ({}));
    const { toolManager, context } = build({
      dispatchToolCall: vi.fn(async () => undefined),
      dispatchToolRun,
    });
    mockExecuteCommand.mockResolvedValue(PRE_BLOCKED);

    await toolManager.execute("FakeTool", {}, context);

    expect(dispatchToolRun).not.toHaveBeenCalled();
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

describe("ToolManager 派发影子事件 classic.PostToolUse 族", () => {
  it("成功的调用发 PostToolUse，带上工具名、参数、调用 id 与结果", async () => {
    const notifyMods = vi.fn();
    const { toolManager, context } = build({ notifyMods });

    await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(notifyMods).toHaveBeenCalledWith("classic.PostToolUse", {
      tool_name: "FakeTool",
      tool_input: { a: 1 },
      tool_use_id: "call_1",
      duration_ms: expect.any(Number),
      tool_response: "done",
    });
    expect(notifyMods).not.toHaveBeenCalledWith(
      "classic.PostToolUseFailure",
      expect.anything(),
    );
  });

  it("工具自己报失败时发 PostToolUseFailure，带上错误正文", async () => {
    const notifyMods = vi.fn();
    const { toolManager, context } = build({
      notifyMods,
      execute: vi.fn().mockResolvedValue({
        success: false,
        content: "boom",
        error: "boom",
      }) as unknown as ToolPlugin["execute"],
    });

    await toolManager.execute("FakeTool", { a: 1 }, context);

    expect(notifyMods).toHaveBeenCalledWith("classic.PostToolUseFailure", {
      tool_name: "FakeTool",
      tool_input: { a: 1 },
      tool_use_id: "call_1",
      duration_ms: expect.any(Number),
      error: "boom",
    });
    expect(notifyMods).not.toHaveBeenCalledWith(
      "classic.PostToolUse",
      expect.anything(),
    );
  });

  it("结果按 $.ui.log 的字符限额截断，不把整份输出塞进钩子", async () => {
    const notifyMods = vi.fn();
    const long = "x".repeat(MOD_LIMITS.statusChars + 10);
    const { toolManager, context } = build({
      notifyMods,
      execute: vi.fn().mockResolvedValue({
        success: true,
        content: long,
      }) as unknown as ToolPlugin["execute"],
    });

    await toolManager.execute("FakeTool", {}, context);

    const payload = notifyMods.mock.calls.find(
      (call) => call[0] === "classic.PostToolUse",
    )?.[1] as { tool_response: string };
    expect(payload.tool_response).toBe(
      `${"x".repeat(MOD_LIMITS.statusChars)}…`,
    );
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
