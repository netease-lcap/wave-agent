import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
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

describe("HookManager session hooks", () => {
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

  describe("executeSessionStartHooks", () => {
    it("should execute SessionStart hooks and return results", async () => {
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo init" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.results).toBeDefined();
      expect(mockExecuteCommand).toHaveBeenCalled();
    });

    it("should parse JSON stdout for additionalContext", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout:
          '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Extra context here"}}',
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe("Extra context here");
      expect(result.initialUserMessage).toBeUndefined();
    });

    it("should treat top-level additionalContext as plain text (no parsing)", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: '{"additionalContext": "SDK format context"}',
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      // Top-level additionalContext is now ignored (Claude Code format only)
      // Since it parses as JSON but has no hookSpecificOutput, result is undefined
      expect(result.additionalContext).toBeUndefined();
    });

    it("should parse JSON stdout for initialUserMessage", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: '{"initialUserMessage": "Hello from hook"}',
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
        undefined,
        "planner",
      );
      expect(result.initialUserMessage).toBe("Hello from hook");
      expect(result.additionalContext).toBeUndefined();
    });

    it("should treat non-JSON stdout as additionalContext", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: "Plain text context",
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo text" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "compact",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe("Plain text context");
    });

    it("should concatenate additionalContext from multiple hooks", async () => {
      let callCount = 0;
      mockExecuteCommand.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            success: true,
            duration: 100,
            timedOut: false,
            exitCode: 0,
            stdout:
              '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Context from hook 1"}}',
            stderr: "",
          };
        }
        return {
          success: true,
          duration: 100,
          timedOut: false,
          exitCode: 0,
          stdout:
            '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Context from hook 2"}}',
          stderr: "",
        };
      });
      manager.loadConfiguration({
        SessionStart: [
          {
            hooks: [
              { type: "command" as const, command: "echo hook1" },
              { type: "command" as const, command: "echo hook2" },
            ],
          },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe(
        "Context from hook 1\nContext from hook 2",
      );
    });

    it("should parse both additionalContext and initialUserMessage from same hook", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "Project rules context",
          },
          initialUserMessage: "Start with a plan",
        }),
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo both" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe("Project rules context");
      expect(result.initialUserMessage).toBe("Start with a plan");
    });

    it("should read initialUserMessage from inside hookSpecificOutput", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        // Claude Code's documented position: inside `hookSpecificOutput`
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            initialUserMessage: "Start with a plan",
          },
        }),
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.initialUserMessage).toBe("Start with a plan");
    });

    it("should prefer the inner initialUserMessage when both positions are present", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { initialUserMessage: "inner" },
          initialUserMessage: "top level",
        }),
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.initialUserMessage).toBe("inner");
    });

    it("should still accept the tolerated top-level initialUserMessage", async () => {
      // Not a Claude Code contract — the position our own docs used to teach.
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: JSON.stringify({ initialUserMessage: "legacy" }),
        stderr: "",
      });
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo json" }] },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.initialUserMessage).toBe("legacy");
    });

    it("should skip failed hooks when collecting additionalContext", async () => {
      let callCount = 0;
      mockExecuteCommand.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            success: false,
            duration: 100,
            timedOut: false,
            exitCode: 1,
            stdout:
              '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Should be ignored"}}',
            stderr: "Hook failed",
          };
        }
        return {
          success: true,
          duration: 100,
          timedOut: false,
          exitCode: 0,
          stdout:
            '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Valid context"}}',
          stderr: "",
        };
      });
      manager.loadConfiguration({
        SessionStart: [
          {
            hooks: [
              { type: "command" as const, command: "echo fail" },
              { type: "command" as const, command: "echo ok" },
            ],
          },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe("Valid context");
    });

    it("should mix JSON and plain text additionalContext from multiple hooks", async () => {
      let callCount = 0;
      mockExecuteCommand.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            success: true,
            duration: 100,
            timedOut: false,
            exitCode: 0,
            stdout:
              '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "JSON context"}}',
            stderr: "",
          };
        }
        if (callCount === 2) {
          return {
            success: true,
            duration: 100,
            timedOut: false,
            exitCode: 0,
            stdout: "Plain text context",
            stderr: "",
          };
        }
        return {
          success: true,
          duration: 100,
          timedOut: false,
          exitCode: 0,
          stdout:
            '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "More JSON"}}',
          stderr: "",
        };
      });
      manager.loadConfiguration({
        SessionStart: [
          {
            hooks: [
              { type: "command" as const, command: "echo json1" },
              { type: "command" as const, command: "echo text" },
              { type: "command" as const, command: "echo json2" },
            ],
          },
        ],
      });
      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(result.additionalContext).toBe(
        "JSON context\nPlain text context\nMore JSON",
      );
    });
  });

  describe("SessionStart matcher (matched against source)", () => {
    it("should load a SessionStart config that carries a matcher", () => {
      const validation = manager.validateConfiguration({
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "echo hi" }],
            },
          ],
        },
      });
      expect(validation.errors).toHaveLength(0);
      expect(validation.valid).toBe(true);

      expect(() =>
        manager.loadConfiguration({
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command" as const, command: "echo hi" }],
            },
          ],
        }),
      ).not.toThrow();
    });

    it("should only run the config whose matcher matches the firing source", async () => {
      manager.loadConfiguration({
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command" as const, command: "echo startup" }],
          },
          {
            matcher: "resume",
            hooks: [{ type: "command" as const, command: "echo resume" }],
          },
        ],
      });

      await manager.executeSessionStartHooks(
        "resume",
        "session-123",
        "/path/to/transcript.json",
      );

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo resume",
        expect.objectContaining({ event: "SessionStart", source: "resume" }),
        undefined,
      );
    });

    it("should run an unmatched-only config for no source", async () => {
      manager.loadConfiguration({
        SessionStart: [
          {
            matcher: "compact",
            hooks: [{ type: "command" as const, command: "echo compact" }],
          },
        ],
      });

      await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );

      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it("should keep running a config without a matcher for every source", async () => {
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo always" }] },
          {
            matcher: "resume",
            hooks: [{ type: "command" as const, command: "echo resume" }],
          },
        ],
      });

      await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo always",
        expect.objectContaining({ source: "startup" }),
        undefined,
      );
    });
  });

  describe("SessionStart failure visibility", () => {
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
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo hook" }] },
        ],
      });
    });

    const run = () =>
      manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
        mockMessageManager as unknown as MessageManager,
      );

    it("should show stderr of an exit-2 hook and not block startup", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 10,
        timedOut: false,
        exitCode: 2,
        stdout: "",
        stderr: "node is too old for this project",
      });

      const result = await run();

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "node is too old for this project",
        "error",
      );
      expect(result.results).toHaveLength(1);
    });

    it("should show stderr of a hook that exits with any other non-zero code", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 10,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "command not found: preflight",
      });

      await run();

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "command not found: preflight",
        "error",
      );
    });

    it("should show a timed-out hook, which reports exit code 0", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 5000,
        timedOut: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      await run();

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        "SessionStart hook timed out",
        "error",
      );
    });

    it("should report JSON-shaped stdout that does not parse, instead of injecting it", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 10,
        timedOut: false,
        exitCode: 0,
        stdout: '{"hookSpecificOutput": ',
        stderr: "",
      });

      const result = await run();

      expect(mockMessageManager.addNoticeBlock).toHaveBeenCalledWith(
        expect.stringContaining("malformed JSON"),
        "error",
      );
      expect(result.additionalContext).toBeUndefined();
    });

    it("should stay silent when the hook succeeds", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 10,
        timedOut: false,
        exitCode: 0,
        stdout: "Plain text context",
        stderr: "",
      });

      const result = await run();

      expect(mockMessageManager.addNoticeBlock).not.toHaveBeenCalled();
      expect(result.additionalContext).toBe("Plain text context");
    });

    it("should keep running without a messageManager", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 10,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "boom",
      });

      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-123",
        "/path/to/transcript.json",
      );

      expect(result.results).toHaveLength(1);
    });
  });

  describe("executeSessionEndHooks", () => {
    it("should execute SessionEnd hooks and return results", async () => {
      manager.loadConfiguration({
        SessionEnd: [
          { hooks: [{ type: "command" as const, command: "echo cleanup" }] },
        ],
      });
      const results = await manager.executeSessionEndHooks(
        "stop",
        "session-123",
        "/path/to/transcript.json",
      );
      expect(results).toBeDefined();
      expect(mockExecuteCommand).toHaveBeenCalled();
    });

    it("should pass endSource in context to hooks", async () => {
      manager.loadConfiguration({
        SessionEnd: [
          { hooks: [{ type: "command" as const, command: "echo cleanup" }] },
        ],
      });
      await manager.executeSessionEndHooks(
        "compact",
        "session-456",
        "/path/to/transcript.json",
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo cleanup",
        expect.objectContaining({
          event: "SessionEnd",
          endSource: "compact",
        }),
        undefined,
      );
    });

    it("should pass 'resume' endSource in context when switching sessions", async () => {
      manager.loadConfiguration({
        SessionEnd: [
          { hooks: [{ type: "command" as const, command: "echo cleanup" }] },
        ],
      });
      await manager.executeSessionEndHooks(
        "resume",
        "current-session-id",
        "/path/to/transcript.json",
      );
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo cleanup",
        expect.objectContaining({
          event: "SessionEnd",
          endSource: "resume",
        }),
        undefined,
      );
    });

    it("should return empty array when no hooks configured", async () => {
      const results = await manager.executeSessionEndHooks(
        "exit",
        "session-789",
        "/path/to/transcript.json",
      );
      expect(results).toHaveLength(0);
    });
  });
});
