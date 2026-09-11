import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { MessageSource } from "../../src/types/index.js";
import { MessageManager } from "../../src/managers/messageManager.js";
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

    it("should handle PreToolUse blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Blocked Tool",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "PreToolUse",
        results,
        mockMessageManager as unknown as MessageManager,
        "tool-1",
        "{}",
      );
      expect(res.shouldBlock).toBe(true);
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tool-1",
          error: "Hook blocked tool execution",
        }),
      );
    });

    it("should handle PostToolUse blocking error (exit code 2)", () => {
      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Post Error",
          duration: 0,
          timedOut: false,
        },
      ];
      const res = manager.processHookResults(
        "PostToolUse",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(false);
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Post Error",
          source: MessageSource.HOOK,
        }),
      );
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
          source: MessageSource.HOOK,
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
});
