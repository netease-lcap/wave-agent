/**
 * Hook Types Unit Tests
 *
 * Validates type guards, error classes, and validation logic
 * for the hooks system type definitions.
 */

import { describe, it, expect } from "vitest";
import {
  type HookEvent,
  type HookCommand,
  type HookEventConfig,
  isValidHookEvent,
  isValidHookCommand,
  isValidHookEventConfig,
  HookExecutionError,
  HookConfigurationError,
} from "../../src/types/hooks.js";

describe("Hook Types", () => {
  describe("isValidHookEvent", () => {
    it("should validate correct hook events", () => {
      expect(isValidHookEvent("PreToolUse")).toBe(true);
      expect(isValidHookEvent("PostToolUse")).toBe(true);
      expect(isValidHookEvent("UserPromptSubmit")).toBe(true);
      expect(isValidHookEvent("Stop")).toBe(true);
    });

    it("should reject invalid hook events", () => {
      expect(isValidHookEvent("InvalidEvent")).toBe(false);
      expect(isValidHookEvent("")).toBe(false);
      expect(isValidHookEvent("preToolUse")).toBe(false); // Case sensitive
      // Test with non-string values by using type assertion only where necessary
      expect(isValidHookEvent("not-a-valid-event")).toBe(false);
    });
  });

  describe("isValidHookCommand", () => {
    it("should validate correct hook commands", () => {
      const validCommand: HookCommand = {
        type: "command",
        command: 'echo "hello"',
      };
      expect(isValidHookCommand(validCommand)).toBe(true);
    });

    it("should reject invalid hook commands", () => {
      // Missing type
      expect(isValidHookCommand({ command: 'echo "hello"' })).toBe(false);

      // Wrong type
      expect(
        isValidHookCommand({ type: "script", command: 'echo "hello"' }),
      ).toBe(false);

      // Missing command
      expect(isValidHookCommand({ type: "command" })).toBe(false);

      // Empty command
      expect(isValidHookCommand({ type: "command", command: "" })).toBe(false);

      // Wrong command type
      expect(isValidHookCommand({ type: "command", command: 123 })).toBe(false);

      // Null/undefined
      expect(isValidHookCommand(null)).toBe(false);
      expect(isValidHookCommand(undefined)).toBe(false);

      // Not an object
      expect(isValidHookCommand("string")).toBe(false);
    });
  });

  describe("isValidHookEventConfig", () => {
    it("should validate correct hook event configs", () => {
      const validConfig: HookEventConfig = {
        matcher: "Edit|Write",
        hooks: [{ type: "command", command: 'echo "test"' }],
      };
      expect(isValidHookEventConfig(validConfig)).toBe(true);

      // Config without matcher (valid for some events)
      const configWithoutMatcher: HookEventConfig = {
        hooks: [{ type: "command", command: 'echo "test"' }],
      };
      expect(isValidHookEventConfig(configWithoutMatcher)).toBe(true);
    });

    it("should reject invalid hook event configs", () => {
      // No hooks array
      expect(isValidHookEventConfig({ matcher: "Edit" })).toBe(false);

      // Empty hooks array
      expect(isValidHookEventConfig({ hooks: [] })).toBe(false);

      // Invalid hook command in array
      expect(
        isValidHookEventConfig({
          hooks: [{ type: "invalid", command: "echo" }],
        }),
      ).toBe(false);

      // Wrong matcher type
      expect(
        isValidHookEventConfig({
          matcher: 123,
          hooks: [{ type: "command", command: 'echo "test"' }],
        }),
      ).toBe(false);

      // Not an object
      expect(isValidHookEventConfig(null)).toBe(false);
      expect(isValidHookEventConfig("string")).toBe(false);

      // Wrong hooks type
      expect(isValidHookEventConfig({ hooks: "not-array" })).toBe(false);
    });
  });

  describe("HookExecutionError", () => {
    it("should create error with proper properties", () => {
      const originalError = new Error("Original error");
      const context = {
        event: "PostToolUse" as HookEvent,
        toolName: "Edit",
        projectDir: "/test/project",
        timestamp: new Date(),
      };

      const hookError = new HookExecutionError(
        'echo "test"',
        originalError,
        context,
      );

      expect(hookError.name).toBe("HookExecutionError");
      expect(hookError.hookCommand).toBe('echo "test"');
      expect(hookError.originalError).toBe(originalError);
      expect(hookError.context).toBe(context);
      expect(hookError.message).toContain("Hook execution failed");
      expect(hookError.message).toContain('echo "test"');
      expect(hookError.message).toContain("Original error");
    });
  });

  describe("HookConfigurationError", () => {
    it("should create error with proper properties", () => {
      const validationErrors = ["Invalid command", "Missing type"];
      const configError = new HookConfigurationError(
        "/path/to/config",
        validationErrors,
      );

      expect(configError.name).toBe("HookConfigurationError");
      expect(configError.configPath).toBe("/path/to/config");
      expect(configError.validationErrors).toEqual(validationErrors);
      expect(configError.message).toContain("Hook configuration error");
      expect(configError.message).toContain("/path/to/config");
      expect(configError.message).toContain("Invalid command");
      expect(configError.message).toContain("Missing type");
    });
  });
});

describe("Type Integration", () => {
  it("should work together for complete validation", () => {
    const completeWaveConfig = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [
              { type: "command" as const, command: "eslint --fix ." },
              { type: "command" as const, command: "prettier --write ." },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command" as const, command: "validate-prompt.sh" },
            ],
          },
        ],
      },
      env: {
        NODE_ENV: "test",
        DEBUG: "true",
      },
    };

    // Validate the complete structure using individual validators
    if (completeWaveConfig.hooks) {
      Object.entries(completeWaveConfig.hooks).forEach(([event, configs]) => {
        expect(isValidHookEvent(event)).toBe(true);
        if (configs) {
          configs.forEach((config) => {
            expect(isValidHookEventConfig(config)).toBe(true);
            config.hooks.forEach((hookCommand) => {
              expect(isValidHookCommand(hookCommand)).toBe(true);
            });
          });
        }
      });
    }
  });
});
