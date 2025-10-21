import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/hooks/manager.js";
import type { IHookMatcher } from "../../src/hooks/matcher.js";
import type { IHookExecutor } from "../../src/hooks/executor.js";
import type {
  PartialHookConfiguration,
  HookExecutionContext,
} from "../../src/hooks/types.js";

describe("HookManager", () => {
  let manager: HookManager;
  let mockMatcher: IHookMatcher;
  let mockExecutor: IHookExecutor;

  beforeEach(() => {
    // Create mocks
    mockMatcher = {
      matches: vi.fn().mockReturnValue(true),
      isValidPattern: vi.fn().mockReturnValue(true),
      getPatternType: vi.fn().mockReturnValue("tool"),
    };

    mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue({
        success: true,
        duration: 100,
        timedOut: false,
        exitCode: 0,
      }),
      executeCommands: vi.fn().mockResolvedValue([]),
      isCommandSafe: vi.fn().mockReturnValue(true),
    };

    // Create manager with mocks
    manager = new HookManager(mockMatcher, mockExecutor);
  });

  describe("Configuration Management", () => {
    it("should initialize with no configuration", () => {
      expect(manager.getConfiguration()).toBeUndefined();
    });

    it("should load configuration successfully", () => {
      const config: PartialHookConfiguration = {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "test-hook" }],
          },
        ],
      };

      manager.loadConfiguration(config);
      const loadedConfig = manager.getConfiguration();

      expect(loadedConfig?.PostToolUse).toBeDefined();
      expect(loadedConfig?.PostToolUse).toHaveLength(1);
    });

    it("should load partial configuration", () => {
      const config: PartialHookConfiguration = {
        PostToolUse: [
          {
            hooks: [{ type: "command", command: "test-hook" }],
          },
        ],
      };

      manager.loadConfiguration(config);
      const loadedConfig = manager.getConfiguration();

      expect(loadedConfig?.PostToolUse).toBeDefined();
      expect(loadedConfig?.PostToolUse).toHaveLength(1);
    });

    it("should clear configuration", () => {
      const config: PartialHookConfiguration = {
        PostToolUse: [
          {
            hooks: [{ type: "command", command: "test-hook" }],
          },
        ],
      };

      manager.loadConfiguration(config);
      expect(manager.getConfiguration()).not.toBeUndefined();

      manager.clearConfiguration();
      expect(manager.getConfiguration()).toBeUndefined();
    });
  });

  describe("Hook Execution", () => {
    it("should execute hooks for event", async () => {
      const config: PartialHookConfiguration = {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "test-hook" }],
          },
        ],
      };

      manager.loadConfiguration(config);

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
      const config: PartialHookConfiguration = {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "test-hook" }],
          },
        ],
      };

      manager.loadConfiguration(config);

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
    it("should handle invalid configuration gracefully", () => {
      // This should not throw
      manager.loadConfiguration({});
      expect(manager.getConfiguration()).toEqual({});
    });

    it("should handle null configuration", () => {
      // This should not throw
      manager.loadConfiguration(null as unknown as PartialHookConfiguration);
      expect(manager.getConfiguration()).toEqual({});
    });
  });
});
