import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import type { HookMatcher } from "../../src/utils/hookMatcher.js";
import {
  executeCommand,
  executeCommands,
  isCommandSafe,
} from "../../src/services/hook.js";
import type {
  WaveConfiguration,
  PartialHookConfiguration,
  HookExecutionContext,
  HookExecutionResult,
} from "../../src/types/hooks.js";

// Mock the hook services
vi.mock("../../src/services/hook.js");

const mockExecuteCommand = vi.mocked(executeCommand);
const mockExecuteCommands = vi.mocked(executeCommands);
const mockIsCommandSafe = vi.mocked(isCommandSafe);

describe("HookManager", () => {
  let manager: HookManager;
  let mockMatcher: HookMatcher;

  beforeEach(() => {
    // Create mocks
    mockMatcher = {
      matches: vi.fn().mockReturnValue(true),
      isValidPattern: vi.fn().mockReturnValue(true),
      getPatternType: vi.fn().mockReturnValue("exact"),
      getMatches: vi.fn().mockReturnValue([]),
      compile: vi.fn().mockReturnValue(() => true),
    } as unknown as HookMatcher;

    // Setup service mocks
    mockExecuteCommand.mockResolvedValue({
      success: true,
      duration: 100,
      timedOut: false,
      exitCode: 0,
      stdout: "",
      stderr: "",
    } as HookExecutionResult);

    mockExecuteCommands.mockResolvedValue([]);
    mockIsCommandSafe.mockReturnValue(true);

    // Create manager with mocks
    manager = new HookManager("/test/workdir", mockMatcher);
  });

  describe("Wave Configuration Management", () => {
    it("should initialize with no configuration", () => {
      expect(manager.getConfiguration()).toBeUndefined();
    });

    it("should load wave configuration successfully", () => {
      const waveConfig: WaveConfiguration = {
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: "test-hook" }],
            },
          ],
        },
        env: {
          NODE_ENV: "test",
        },
      };

      // Load just the hooks portion for now (until HookManager is updated)
      manager.loadConfiguration(waveConfig.hooks);
      const loadedConfig = manager.getConfiguration();

      expect(loadedConfig?.PostToolUse).toBeDefined();
      expect(loadedConfig?.PostToolUse).toHaveLength(1);
    });

    it("should load partial wave configuration", () => {
      const waveConfig: WaveConfiguration = {
        hooks: {
          PostToolUse: [
            {
              hooks: [{ type: "command", command: "test-hook" }],
            },
          ],
        },
      };

      manager.loadConfiguration(waveConfig.hooks);
      const loadedConfig = manager.getConfiguration();

      expect(loadedConfig?.PostToolUse).toBeDefined();
      expect(loadedConfig?.PostToolUse).toHaveLength(1);
    });

    it("should clear wave configuration", () => {
      const waveConfig: WaveConfiguration = {
        hooks: {
          PostToolUse: [
            {
              hooks: [{ type: "command", command: "test-hook" }],
            },
          ],
        },
      };

      manager.loadConfiguration(waveConfig.hooks);
      expect(manager.getConfiguration()).not.toBeUndefined();

      manager.clearConfiguration();
      expect(manager.getConfiguration()).toBeUndefined();
    });
  });

  describe("Hook Execution", () => {
    it("should execute hooks for event", async () => {
      const waveConfig: WaveConfiguration = {
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: "test-hook" }],
            },
          ],
        },
      };

      manager.loadConfiguration(waveConfig.hooks);

      const context: HookExecutionContext = {
        event: "PostToolUse",
        projectDir: "/test",
        timestamp: new Date(),
        toolName: "Edit",
      };

      const results = await manager.executeHooks("PostToolUse", context);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it("should return empty array when no hooks configured", async () => {
      const context: HookExecutionContext = {
        event: "UserPromptSubmit", // Use event that doesn't require toolName
        projectDir: "/test",
        timestamp: new Date(),
      };

      const results = await manager.executeHooks("UserPromptSubmit", context);
      expect(results).toHaveLength(0);
    });

    it("should handle event with no matching configurations", async () => {
      const waveConfig: WaveConfiguration = {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: "test-hook" }],
            },
          ],
        },
      };

      manager.loadConfiguration(waveConfig.hooks);

      const context: HookExecutionContext = {
        event: "Stop", // Different event
        projectDir: "/test",
        timestamp: new Date(),
      };

      const results = await manager.executeHooks("Stop", context);
      expect(results).toHaveLength(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid wave configuration gracefully", () => {
      // This should not throw
      manager.loadConfiguration({});
      expect(manager.getConfiguration()).toEqual({});
    });

    it("should handle null wave configuration", () => {
      // This should not throw
      manager.loadConfiguration(null as unknown as PartialHookConfiguration);
      expect(manager.getConfiguration()).toEqual({});
    });
  });
});
