import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { MessageSource, Logger } from "../../src/types/index.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import {
  HookConfigurationError,
  HookEvent,
  HookEventConfig,
} from "../../src/types/hooks.js";
import * as hookService from "../../src/services/hook.js";

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

describe("HookManager Coverage", () => {
  let manager: HookManager;
  let mockMatcher: HookMatcher;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockMatcher = new HookMatcher();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    manager = new HookManager(
      "/test/workdir",
      mockMatcher,
      mockLogger as unknown as Logger,
    );
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

  describe("loadConfiguration", () => {
    it("should merge user and project hooks", () => {
      const userHooks = {
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo user" }] },
        ],
      };
      const projectHooks = {
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo project" }] },
        ],
      };
      manager.loadConfiguration(userHooks, projectHooks);
      const config = manager.getConfiguration();
      expect(config?.UserPromptSubmit?.[0].hooks[0].command).toBe(
        "echo project",
      );
    });

    it("should throw HookConfigurationError on invalid merged config", () => {
      const invalidHooks = {
        UserPromptSubmit: "not-an-array",
      };
      expect(() =>
        manager.loadConfiguration(
          invalidHooks as unknown as Partial<
            Record<HookEvent, HookEventConfig[]>
          >,
          undefined,
        ),
      ).toThrow(HookConfigurationError);
    });
  });

  describe("loadConfigurationFromWaveConfig", () => {
    it("should handle non-HookConfigurationError gracefully", () => {
      // Force an error during validation that isn't HookConfigurationError
      // Actually, validatePartialConfiguration seems to only return errors, not throw.
      // But let's try to trigger the catch block.
      const waveConfig = {
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command" as const, command: "test" }] },
          ],
        },
      };

      // Mock validatePartialConfiguration to throw
      const originalValidate = (
        manager as unknown as { validatePartialConfiguration: unknown }
      ).validatePartialConfiguration;
      (
        manager as unknown as {
          validatePartialConfiguration: ReturnType<typeof vi.fn>;
        }
      ).validatePartialConfiguration = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      manager.loadConfigurationFromWaveConfig(
        waveConfig as unknown as Parameters<
          HookManager["loadConfigurationFromWaveConfig"]
        >[0],
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load configuration"),
      );
      expect(manager.getConfiguration()).toBeUndefined();

      (
        manager as unknown as { validatePartialConfiguration: unknown }
      ).validatePartialConfiguration = originalValidate;
    });
  });

  describe("executeHooks", () => {
    it("should return error result for invalid execution context", async () => {
      const context = {
        event: "PreToolUse",
        // missing projectDir and timestamp
      };
      const results = await manager.executeHooks(
        "PreToolUse",
        context as unknown as Parameters<HookManager["executeHooks"]>[1],
      );
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].stderr).toContain("Invalid execution context");
    });

    it("should skip configuration if matcher does not match", async () => {
      manager.loadConfiguration({
        PreToolUse: [
          {
            matcher: "other-tool",
            hooks: [{ type: "command" as const, command: "echo hook" }],
          },
        ],
      });
      const context = {
        event: "PreToolUse",
        projectDir: "/test",
        timestamp: new Date(),
        toolName: "my-tool",
      };
      const results = await manager.executeHooks(
        "PreToolUse",
        context as unknown as Parameters<HookManager["executeHooks"]>[1],
      );
      expect(results).toHaveLength(0);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "matcher 'other-tool' does not match tool 'my-tool'",
        ),
      );
    });

    it("should handle unexpected error during command execution", async () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo fail" }] },
        ],
      });
      mockExecuteCommand.mockRejectedValue(new Error("Execution failed"));
      const context = {
        event: "UserPromptSubmit",
        projectDir: "/test",
        timestamp: new Date(),
      };
      const results = await manager.executeHooks(
        "UserPromptSubmit",
        context as unknown as Parameters<HookManager["executeHooks"]>[1],
      );
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].stderr).toBe("Execution failed");
    });
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

    it("should handle Notification blocking error (exit code 2)", () => {
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
        "Notification",
        results,
        mockMessageManager as unknown as MessageManager,
      );
      expect(res.shouldBlock).toBe(false);
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

  describe("hasHooks", () => {
    it("should return false if no configuration", () => {
      expect(manager.hasHooks("UserPromptSubmit")).toBe(false);
    });

    it("should return true if event has hooks", () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo hook" }] },
        ],
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
      expect(manager.hasHooks("Stop")).toBe(false);
    });

    it("should check toolName for tool-based events", () => {
      manager.loadConfiguration({
        PreToolUse: [
          {
            matcher: "my-tool",
            hooks: [{ type: "command" as const, command: "echo hook" }],
          },
        ],
      });
      expect(manager.hasHooks("PreToolUse", "my-tool")).toBe(true);
      expect(manager.hasHooks("PreToolUse", "other-tool")).toBe(false);
    });
  });

  describe("validateConfiguration", () => {
    it("should return error if config is not an object", () => {
      expect(
        manager.validateConfiguration(
          null as unknown as Parameters<
            HookManager["validateConfiguration"]
          >[0],
        ).valid,
      ).toBe(false);
    });

    it("should validate env property", () => {
      const config = {
        env: { VALID: "value", INVALID: 123 },
      };
      const res = manager.validateConfiguration(
        config as unknown as Parameters<
          HookManager["validateConfiguration"]
        >[0],
      );
      expect(res.valid).toBe(false);
      expect(res.errors).toContain(
        "Environment variable INVALID must have a string value",
      );
    });

    it("should validate hook event names", () => {
      const config = {
        hooks: { InvalidEvent: [] },
      };
      const res = manager.validateConfiguration(
        config as unknown as Parameters<
          HookManager["validateConfiguration"]
        >[0],
      );
      expect(res.valid).toBe(false);
      expect(res.errors).toContain("Invalid hook event: InvalidEvent");
    });
  });

  describe("getConfigurationStats", () => {
    it("should return empty stats if no configuration", () => {
      const stats = manager.getConfigurationStats();
      expect(stats.totalConfigs).toBe(0);
    });

    it("should return correct stats", () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command" as const, command: "echo h1" },
              { type: "command" as const, command: "echo h2" },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "t1",
            hooks: [{ type: "command" as const, command: "echo h3" }],
          },
        ],
      });
      const stats = manager.getConfigurationStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.totalConfigs).toBe(2);
      expect(stats.totalCommands).toBe(3);
      expect(stats.eventBreakdown.UserPromptSubmit).toBe(1);
      expect(stats.eventBreakdown.PreToolUse).toBe(1);
    });
  });

  describe("registerPluginHooks", () => {
    it("should initialize configuration if it doesn't exist", () => {
      manager.registerPluginHooks({
        UserPromptSubmit: [
          {
            hooks: [{ type: "command" as const, command: "echo plugin-hook" }],
          },
        ],
      });
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);
    });
  });

  describe("validateEventConfig", () => {
    it("should error if non-tool event has a matcher", () => {
      const config = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "some-matcher",
              hooks: [{ type: "command" as const, command: "echo hook" }],
            },
          ],
        },
      };
      const res = manager.validateConfiguration(
        config as unknown as Parameters<
          HookManager["validateConfiguration"]
        >[0],
      );
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain(
        "Event UserPromptSubmit should not have a matcher",
      );
    });
  });
});
