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
      addErrorBlock: ReturnType<typeof vi.fn>;
      removeLastUserMessage: ReturnType<typeof vi.fn>;
      updateToolBlock: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockMessageManager = {
        addUserMessage: vi.fn(),
        addErrorBlock: vi.fn(),
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith("Blocked");
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
      // calls inside the Exec sandbox; here it is only asserted that the
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "Notify Error",
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith("Warning");
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
  });

  describe("SessionStart in processHookResults", () => {
    it("should handle SessionStart blocking error (exit code 2)", () => {
      const mockMessageManager = {
        addUserMessage: vi.fn(),
        addErrorBlock: vi.fn(),
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "SessionStart blocked",
      );
    });
  });

  describe("SessionEnd in processHookResults", () => {
    it("should handle SessionEnd blocking error (exit code 2)", () => {
      const mockMessageManager = {
        addUserMessage: vi.fn(),
        addErrorBlock: vi.fn(),
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "SessionEnd cleanup failed",
      );
    });
  });

  describe("tool-event executors", () => {
    let mockMessageManager: {
      addUserMessage: ReturnType<typeof vi.fn>;
      addErrorBlock: ReturnType<typeof vi.fn>;
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
        addErrorBlock: vi.fn(),
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
      expect(mockMessageManager.addErrorBlock).not.toHaveBeenCalled();
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
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "deprecated tool usage",
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

      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "lint warning",
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

    it("should fail open when a tool-event hook cannot run", async () => {
      loadWriteHook("PreToolUse");
      mockExecuteCommand.mockRejectedValue(new Error("spawn failed"));

      await expect(
        manager.executePreToolUseHooks("Write", {}, toolContext()),
      ).resolves.toBeNull();
    });
  });
});
