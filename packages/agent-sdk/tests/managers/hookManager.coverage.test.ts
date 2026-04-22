import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import { MessageSource } from "../../src/types/index.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import {
  HookConfigurationError,
  HookEvent,
  HookEventConfig,
} from "../../src/types/hooks.js";
import * as hookService from "../../src/services/hook.js";
import { logger } from "../../src/utils/globalLogger.js";

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

describe("HookManager Coverage", () => {
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
      expect(logger.warn).toHaveBeenCalledWith(
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
      manager.registerPluginHooks("/test/plugin", {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command" as const, command: "echo plugin-hook" }],
          },
        ],
      });
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);
    });

    it("should stamp pluginRoot on hook commands", () => {
      manager.registerPluginHooks("/my/plugin/root", {
        PreToolUse: [
          {
            hooks: [{ type: "command" as const, command: "echo test" }],
          },
        ],
      });
      const config = manager.getConfiguration();
      const hook = config?.PreToolUse?.[0]?.hooks?.[0];
      expect(hook?.pluginRoot).toBe("/my/plugin/root");
    });

    it("should pass WAVE_PLUGIN_ROOT in env to executeCommand for plugin hooks", async () => {
      manager.registerPluginHooks("/my/plugin/root", {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command" as const, command: "echo plugin" }],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo plugin",
        expect.objectContaining({
          env: expect.objectContaining({
            WAVE_PLUGIN_ROOT: "/my/plugin/root",
          }),
        }),
        undefined,
      );
    });

    it("should substitute ${WAVE_PLUGIN_ROOT} in plugin hook command string", async () => {
      manager.registerPluginHooks("/my/plugin/root", {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command" as const,
                command: "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
              },
            ],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "/my/plugin/root/scripts/hook.sh",
        expect.objectContaining({
          env: expect.objectContaining({
            WAVE_PLUGIN_ROOT: "/my/plugin/root",
          }),
        }),
        undefined,
      );
    });

    it("should not substitute ${WAVE_PLUGIN_ROOT} for non-plugin hooks", async () => {
      manager.loadConfiguration({
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command" as const,
                command: "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
              },
            ],
          },
        ],
      });

      const context = {
        event: "UserPromptSubmit" as const,
        projectDir: "/test/workdir",
        timestamp: new Date(),
      };

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "${WAVE_PLUGIN_ROOT}/scripts/hook.sh",
        expect.any(Object),
        undefined,
      );
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
        stdout: '{"additionalContext": "Extra context here"}',
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
        "resume",
        "session-123",
        "/path/to/transcript.json",
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

    it("should return empty array when no hooks configured", async () => {
      const results = await manager.executeSessionEndHooks(
        "exit",
        "session-789",
        "/path/to/transcript.json",
      );
      expect(results).toHaveLength(0);
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
