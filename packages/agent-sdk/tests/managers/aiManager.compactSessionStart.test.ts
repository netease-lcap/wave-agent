import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
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

describe("HookManager - SessionStart hooks", () => {
  let manager: HookManager;

  beforeEach(() => {
    const container = new Container();
    manager = new HookManager(container, "/test/workdir");
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
    it("should execute hooks with 'compact' source", async () => {
      manager.loadConfiguration({
        SessionStart: [
          {
            hooks: [{ type: "command" as const, command: "echo compact-hook" }],
          },
        ],
      });

      const result = await manager.executeSessionStartHooks(
        "compact",
        "test-session-id",
        "/test/transcript.md",
        "general-purpose",
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        expect.stringContaining("echo compact-hook"),
        expect.objectContaining({
          event: "SessionStart",
          source: "compact",
          agentType: "general-purpose",
        }),
        undefined,
      );
      expect(result.results).toHaveLength(1);
    });

    it("should execute hooks with 'clear' source", async () => {
      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo clear-hook" }] },
        ],
      });

      const result = await manager.executeSessionStartHooks(
        "clear",
        "new-session-id",
        "/test/transcript.md",
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        expect.stringContaining("echo clear-hook"),
        expect.objectContaining({
          event: "SessionStart",
          source: "clear",
        }),
        undefined,
      );
      expect(result.results).toHaveLength(1);
    });

    it("should parse additionalContext from JSON stdout", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { additionalContext: "Project context" },
        }),
        stderr: "",
      });

      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo context" }] },
        ],
      });

      const result = await manager.executeSessionStartHooks(
        "compact",
        "session-id",
        "/test/transcript.md",
      );

      expect(result.additionalContext).toBe("Project context");
    });

    it("should parse initialUserMessage from JSON stdout", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
        stdout: JSON.stringify({ initialUserMessage: "Hello from hook" }),
        stderr: "",
      });

      manager.loadConfiguration({
        SessionStart: [
          { hooks: [{ type: "command" as const, command: "echo greeting" }] },
        ],
      });

      const result = await manager.executeSessionStartHooks(
        "clear",
        "session-id",
        "/test/transcript.md",
      );

      expect(result.initialUserMessage).toBe("Hello from hook");
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
          { hooks: [{ type: "command" as const, command: "echo context" }] },
        ],
      });

      const result = await manager.executeSessionStartHooks(
        "startup",
        "session-id",
        "/test/transcript.md",
      );

      expect(result.additionalContext).toBe("Plain text context");
    });
  });
});
