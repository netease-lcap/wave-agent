import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { MessageManager } from "../../src/managers/messageManager.js";
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

// Mock the hook services
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

describe("HookManager exit-code semantics", () => {
  let manager: HookManager;
  let mockMatcher: HookMatcher;

  beforeEach(() => {
    mockMatcher = new HookMatcher();

    const container = new Container();

    manager = new HookManager(container, "/test/workdir", mockMatcher);
    mockExecuteCommand.mockResolvedValue({
      success: true,
      duration: 100,
      timedOut: false,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    vi.clearAllMocks();
  });

  describe("processHookResults", () => {
    let mockMessageManager: {
      addUserMessage: ReturnType<typeof vi.fn>;
      addNoticeBlock: ReturnType<typeof vi.fn>;
      removeLastUserMessage: ReturnType<typeof vi.fn>;
      updateToolBlock: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockMessageManager = {
        addUserMessage: vi.fn(),
        addNoticeBlock: vi.fn(),
        removeLastUserMessage: vi.fn(),
        updateToolBlock: vi.fn(),
      };
    });

    it("should return shouldBlock: false if no messageManager or results", () => {
      expect(manager.processHookResults("UserPromptSubmit", [])).toEqual({
        shouldBlock: false,
      });
      expect(
        manager.processHookResults(
          "UserPromptSubmit",
          [{ success: true, duration: 0, timedOut: false }],
          undefined,
        ),
      ).toEqual({ shouldBlock: false });
    });

    it("should handle UserPromptSubmit blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Blocked",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "UserPromptSubmit",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(true);
      expect(res.errorMessage).toBe("Blocked");
      // `"turn"`: the prompt is erased and never reaches the model — the
      // caller releases the loading state it reserved, so the host saw a
      // whole turn end in this error.
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "Blocked",
        "error",
        "turn",
      );
      expect(mockMessageManager.removeLastUserMessage).toHaveBeenCalled();
    });

    it("should handle stop-style events through processHookResults unchanged", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Blocked Tool",
          duration: 0,
          timedOut: false,
        },
      ];
      // Tool events have their own executors (executePreToolUseHooks /
      // executePostToolUseHooks) because their feedback has to reach nested
      // calls inside the REPL sandbox; here it is only asserted that the
      // generic path no longer claims them.
      expect(
        manager.processHookResults(
          "PreToolUse",
          results,
          mockMessageManager as unknown as MessageManager,
        ),
      ).toEqual({ shouldBlock: false });
      expect(mockMessageManager.updateToolBlock).not.toHaveBeenCalled();
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("should handle Stop blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Cannot Stop",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "Stop",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(true);
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Cannot Stop",
        }),
      );
    });

    it("should handle PermissionRequest blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Notify Error",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "PermissionRequest",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(true);
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "Notify Error",
        "error",
      );
    });

    it("should handle SubagentStop blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Subagent Blocked",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "SubagentStop",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(true);
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Subagent Blocked",
        }),
      );
    });

    it("should handle non-blocking error (exit code 1)", () => {
      const results = [
        {
          success: false,
          exitCode: 1,
          stderr: "Warning",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "UserPromptSubmit",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(false);
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "Warning",
        "error",
      );
    });

    it("should handle success with stdout for UserPromptSubmit", () => {
      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: "Injected Context",
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "UserPromptSubmit",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Injected Context",
          isMeta: true,
        }),
      );
    });

    // spec `automation/hooks` / 结构化方式：JSON 输出
    it("injects the additionalContext value, not the raw JSON, for UserPromptSubmit", () => {
      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: "Structured context",
            },
          }),
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "UserPromptSubmit",
        results,
        mockMessageManager as unknown as MessageManager,
      );

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledTimes(1);
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content: "<system-reminder>\nStructured context\n</system-reminder>",
        isMeta: true,
      });
    });

    it("ignores additionalContext on Stop, which the field does not support", () => {
      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "Stop",
              additionalContext: "must not be injected",
            },
          }),
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "Stop",
        results,
        mockMessageManager as unknown as MessageManager,
      );

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
      expect(mockMessageManager.addNoticeBlock).not.toHaveBeenCalled();
    });

    it("shows a blocking Stop hook's systemMessage to the user, whatever the exit code", () => {
      // loop-hook shape: the reason reaches the model through exit 2 + stderr,
      // the same stdout JSON carries the line the user needs to see.
      const results = [
        {
          success: false,
          exitCode: 2,
          stdout: JSON.stringify({
            systemMessage: "🔄 第 2 轮 | 想停：删掉循环状态文件",
          }),
          stderr: "第 2 轮的工作内容",
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "Stop",
        results,
        mockMessageManager as unknown as MessageManager,
      );

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "🔄 第 2 轮 | 想停：删掉循环状态文件",
        "info",
      );
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content: "第 2 轮的工作内容",
        isMeta: true,
      });
    });

    it("shows systemMessage on a non-blocking Stop hook too", () => {
      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            systemMessage: "循环已结束：已到 2 轮上限",
          }),
          stderr: "",
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "Stop",
        results,
        mockMessageManager as unknown as MessageManager,
      );

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "循环已结束：已到 2 轮上限",
        "info",
      );
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("ignores plain-text stdout on Stop (older clients' view of the hook)", () => {
      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: "🔄 第 2 轮",
          stderr: "",
          duration: 0,
          timedOut: false,
        },
      ];
      manager.processHookResults(
        "Stop",
        results,
        mockMessageManager as unknown as MessageManager,
      );

      expect(mockMessageManager.addNoticeBlock).not.toHaveBeenCalled();
    });
  });

  describe("SessionStart in processHookResults", () => {
    it("should handle SessionStart blocking error (exit code 2)", () => {
      const mockMessageManager = {
        addUserMessage: vi.fn(),
        addNoticeBlock: vi.fn(),
        removeLastUserMessage: vi.fn(),
        updateToolBlock: vi.fn(),
      };
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "SessionStart blocked",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "SessionStart",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(false);
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "SessionStart blocked",
        "error",
      );
    });
  });

  describe("SessionEnd in processHookResults", () => {
    it("should handle SessionEnd blocking error (exit code 2)", () => {
      const mockMessageManager = {
        addUserMessage: vi.fn(),
        addNoticeBlock: vi.fn(),
        removeLastUserMessage: vi.fn(),
        updateToolBlock: vi.fn(),
      };
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "SessionEnd cleanup failed",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "SessionEnd",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(false);
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "SessionEnd cleanup failed",
        "error",
      );
    });
  });

  describe("tool-event executors", () => {
    let mockMessageManager: {
      addUserMessage: ReturnType<typeof vi.fn>;
      addNoticeBlock: ReturnType<typeof vi.fn>;
      getSessionId: ReturnType<typeof vi.fn>;
      getTranscriptPath: ReturnType<typeof vi.fn>;
    };

    const toolContext = () =>
      ({
        workdir: "/test/workdir",
        messageManager: mockMessageManager,
      }) as unknown as ToolContext;

    const loadWriteHook = (event: "PreToolUse" | "PostToolUse") => {
      manager.loadConfiguration({
        [event]: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "check.sh" }],
          },
        ],
      });
    };

    beforeEach(() => {
      mockMessageManager = {
        addUserMessage: vi.fn(),
        addNoticeBlock: vi.fn(),
        getSessionId: vi.fn().mockReturnValue("session-1"),
        getTranscriptPath: vi.fn().mockReturnValue("/tmp/transcript.jsonl"),
      };
    });

    it("should report a PreToolUse block to the model with Claude Code's wording", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 2,
        stdout: "",
        stderr: "Blocked by policy\n",
        duration: 5,
        timedOut: false,
      });

      const blocked = await manager.executePreToolUseHooks(
        "Write",
        { file_path: "/a" },
        toolContext(),
      );

      expect(blocked).toBe("PreToolUse:Write hook error: Blocked by policy");
      // The block travels back to the model as the tool result, not as a message
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
      expect(mockMessageManager.addNoticeBlock).not.toHaveBeenCalled();
    });

    it("should let a PreToolUse hook allow the call and drop its stdout", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "noise",
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBeNull();
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("should not run PreToolUse hooks for unmatched tools", async () => {
      loadWriteHook("PreToolUse");

      await expect(
        manager.executePreToolUseHooks("Bash", {}, toolContext()),
      ).resolves.toBeNull();
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it("should show a PreToolUse non-blocking error to the user only", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "deprecated tool usage",
        duration: 5,
        timedOut: false,
      });

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBeNull();
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "deprecated tool usage",
        "error",
      );
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("should inject a PostToolUse block as a user message without rewriting the result", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 2,
        stdout: "",
        stderr: "Needs formatting",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        { file_path: "/a" },
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content:
          'PostToolUse:Write hook blocking error from command: "check.sh": Needs formatting',
        isMeta: true,
      });
    });

    it("should show a PostToolUse non-blocking error to the user only", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "lint warning",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "lint warning",
        "error",
      );
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("should ignore PostToolUse stdout on success", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "context that must not be injected",
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("hands PostToolUse the tool's `data` as tool_response, plus the call's id/cost/server", async () => {
      // CC 的 PostToolUse 输入（`0172:9978-9987`）：`tool_response` 是工具
      // Output 本身 —— 官方示例就是 `jq -r '.tool_response.filePath'`。整个
      // `ToolResult` 包装（`success` / `shortResult` …）是宿主自己的账，不能漏进去。
      loadWriteHook("PostToolUse");

      await manager.executePostToolUseHooks(
        "Write",
        { file_path: "/a" },
        {
          success: true,
          content: "File created successfully at: /a",
          shortResult: "+3",
          data: {
            type: "create",
            filePath: "/a",
            linesAdded: 3,
            linesRemoved: 0,
          },
        },
        toolContext(),
        {
          toolUseId: "toolu_01",
          durationMs: 12,
          mcpServer: { name: "github", source: "user" },
        },
      );

      const context = mockExecuteCommand.mock.calls[0][1] as {
        toolResponse?: unknown;
        toolUseId?: string;
        durationMs?: number;
        mcpServer?: unknown;
      };
      expect(context.toolResponse).toEqual({
        type: "create",
        filePath: "/a",
        linesAdded: 3,
        linesRemoved: 0,
      });
      expect(context.toolUseId).toBe("toolu_01");
      expect(context.durationMs).toBe(12);
      expect(context.mcpServer).toEqual({ name: "github", source: "user" });
    });

    it("falls back to `{ content }` when the tool produced no `data`", async () => {
      // 第三方 ToolPlugin 可以先不填 `data`。给 `undefined` 会让 `tool_response`
      // 这个键静默消失 —— 对钩子作者来说和失败长得一模一样，所以兜成
      // `{ content }`（`content` 是 CC 在 MCP 结果里给同一件东西的键名）。
      loadWriteHook("PostToolUse");

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      const context = mockExecuteCommand.mock.calls[0][1] as {
        toolResponse?: unknown;
      };
      expect(context.toolResponse).toEqual({ content: "file written" });
    });

    it("should fail open when a tool-event hook cannot run", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockRejectedValue(new Error("spawn failed"));

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBeNull();
    });

    // spec `automation/hooks` / 结构化方式：JSON 输出
    const structuredStdout = (
      hookEventName: string,
      additionalContext: string,
    ) =>
      JSON.stringify({
        hookSpecificOutput: { hookEventName, additionalContext },
      });

    it("injects hookSpecificOutput.additionalContext on PreToolUse without blocking", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: structuredStdout("PreToolUse", "touching auth, check callers"),
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBeNull();

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content:
          "<system-reminder>\ntouching auth, check callers\n</system-reminder>",
        isMeta: true,
      });
      expect(mockMessageManager.addNoticeBlock).not.toHaveBeenCalled();
    });

    it("injects hookSpecificOutput.additionalContext on PostToolUse", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: structuredStdout("PostToolUse", "remember to update the tests"),
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content:
          "<system-reminder>\nremember to update the tests\n</system-reminder>",
        isMeta: true,
      });
    });

    it("reads additionalContext even when the hook exits 2 — the channel is orthogonal to the exit code", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 2,
        stdout: structuredStdout("PreToolUse", "context next to the block"),
        stderr: "Blocked by policy",
        duration: 5,
        timedOut: false,
      });

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBe("PreToolUse:Write hook error: Blocked by policy");

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content:
          "<system-reminder>\ncontext next to the block\n</system-reminder>",
        isMeta: true,
      });
    });

    it("reports an event-name mismatch instead of injecting the payload", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: structuredStdout("PreToolUse", "wrong event"),
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "Hook returned incorrect event name: expected 'PostToolUse' but got 'PreToolUse'",
        "error",
      );
    });

    it("needs the event name to be declared at all", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { additionalContext: "no event name" },
        }),
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "Hook returned incorrect event name: expected 'PostToolUse' but got 'undefined'",
        "error",
      );
    });

    it("ignores an empty additionalContext", async () => {
      loadWriteHook("PostToolUse");
      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: structuredStdout("PostToolUse", "   "),
        stderr: "",
        duration: 5,
        timedOut: false,
      });

      await manager.executePostToolUseHooks(
        "Write",
        {},
        { success: true, content: "file written" },
        toolContext(),
      );

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });
  });
});
