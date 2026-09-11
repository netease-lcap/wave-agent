import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
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

describe("HookManager additional coverage", () => {
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
    it("should load hooks via loadConfiguration", () => {
      const hooks = {
        UserPromptSubmit: [
          { hooks: [{ type: "command" as const, command: "echo user" }] },
        ],
      };
      manager.loadConfiguration(hooks);
      const config = manager.getConfiguration();
      expect(config?.UserPromptSubmit?.[0].hooks[0].command).toBe("echo user");
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
