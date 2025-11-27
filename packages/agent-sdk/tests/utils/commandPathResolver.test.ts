import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// These utilities don't exist yet - this test file is part of TDD Red phase
// Implementation needed: src/utils/commandPathResolver.ts
import {
  generateCommandId,
  parseCommandId,
  validateCommandId,
} from "../../src/utils/commandPathResolver.js";

describe("Command Path Resolver Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("generateCommandId", () => {
    it("should generate command ID for root level commands", () => {
      // Test flat command: .wave/commands/help.md -> 'help'
      const commandId = generateCommandId("help.md", "");
      expect(commandId).toBe("help");
    });

    it("should generate command ID for nested commands with colon syntax", () => {
      // Test nested command: .wave/commands/openspec/apply.md -> 'openspec:apply'
      const commandId = generateCommandId(
        "/root/commands/openspec/apply.md",
        "/root/commands",
      );
      expect(commandId).toBe("openspec:apply");
    });

    it("should reject multiple namespace levels", () => {
      // Test second level: .wave/commands/db/migrations/create.md -> should be rejected
      expect(() =>
        generateCommandId(
          "/root/commands/db/migrations/create.md",
          "/root/commands",
        ),
      ).toThrow(
        "Command nesting too deep: db/migrations/create.md. Maximum depth is 1 level.",
      );
    });

    it("should strip .md extension from command name", () => {
      const commandId = generateCommandId(
        "/root/commands/tools/complex-command.md",
        "/root/commands",
      );
      expect(commandId).toBe("tools:complex-command");
    });

    it("should handle root commands", () => {
      const commandId = generateCommandId(
        "/root/commands/test.md",
        "/root/commands",
      );
      expect(commandId).toBe("test");
    });

    it("should handle null or undefined rootDir", () => {
      expect(() =>
        generateCommandId("test.md", null as unknown as string),
      ).toThrow("File path and root directory must be provided");
      expect(() =>
        generateCommandId("test.md", undefined as unknown as string),
      ).toThrow("File path and root directory must be provided");
    });

    it("should throw error for files without .md extension", () => {
      expect(() => generateCommandId("test.txt", "")).toThrow(
        "Command files must have .md extension",
      );
    });

    it("should throw error for empty filename", () => {
      expect(() =>
        generateCommandId("/root/commands/.md", "/root/commands"),
      ).toThrow("Command filename cannot be empty");
    });
  });

  describe("parseCommandId", () => {
    it("should parse flat command ID", () => {
      const parsed = parseCommandId("help");
      expect(parsed).toEqual({
        commandName: "help",
        namespace: undefined,
        segments: ["help"],
        isNested: false,
        depth: 0,
      });
    });

    it("should parse nested command ID with single level", () => {
      const parsed = parseCommandId("openspec:apply");
      expect(parsed).toEqual({
        commandName: "apply",
        namespace: "openspec",
        segments: ["openspec", "apply"],
        isNested: true,
        depth: 1,
      });
    });

    it("should reject deeply nested command ID", () => {
      expect(() => parseCommandId("db:migrations:create")).toThrow(
        'Invalid command ID format: "db:migrations:create". Too many colon separators.',
      );
    });

    it("should handle command with dashes and underscores", () => {
      const parsed = parseCommandId("api:create-user_profile");
      expect(parsed).toEqual({
        commandName: "create-user_profile",
        namespace: "api",
        segments: ["api", "create-user_profile"],
        isNested: true,
        depth: 1,
      });
    });

    it("should throw error for empty command ID", () => {
      expect(() => parseCommandId("")).toThrow("Command ID cannot be empty");
    });

    it("should throw error for command ID starting with colon", () => {
      expect(() => parseCommandId(":invalid")).toThrow(
        "Invalid command ID format",
      );
    });

    it("should throw error for command ID ending with colon", () => {
      expect(() => parseCommandId("invalid:")).toThrow(
        "Invalid command ID format",
      );
    });

    it("should throw error for consecutive colons", () => {
      expect(() => parseCommandId("invalid::command")).toThrow(
        "Invalid command ID format",
      );
    });
  });

  describe("validateCommandId", () => {
    it("should validate correct flat command ID", () => {
      expect(validateCommandId("help")).toBe(true);
      expect(validateCommandId("create-user")).toBe(true);
      expect(validateCommandId("test_command")).toBe(true);
    });

    it("should validate correct nested command ID", () => {
      expect(validateCommandId("openspec:apply")).toBe(true);
      expect(validateCommandId("api:create-user")).toBe(true);
      expect(validateCommandId("tools:db:migrate")).toBe(true);
    });

    it("should reject empty command ID", () => {
      expect(validateCommandId("")).toBe(false);
    });

    it("should reject command ID with invalid characters", () => {
      expect(validateCommandId("invalid@command")).toBe(false);
      expect(validateCommandId("invalid command")).toBe(false);
      expect(validateCommandId("invalid#command")).toBe(false);
      expect(validateCommandId("invalid/command")).toBe(false);
      expect(validateCommandId("invalid\\command")).toBe(false);
    });

    it("should reject command ID starting with colon", () => {
      expect(validateCommandId(":invalid")).toBe(false);
    });

    it("should reject command ID ending with colon", () => {
      expect(validateCommandId("invalid:")).toBe(false);
    });

    it("should reject command ID with consecutive colons", () => {
      expect(validateCommandId("invalid::command")).toBe(false);
    });

    it("should reject command ID with numbers at start", () => {
      expect(validateCommandId("123invalid")).toBe(false);
      expect(validateCommandId("api:123invalid")).toBe(false);
    });

    it("should accept numbers in middle or end", () => {
      expect(validateCommandId("command123")).toBe(true);
      expect(validateCommandId("api:command123")).toBe(true);
      expect(validateCommandId("api:create2user")).toBe(true);
    });

    it("should accept valid depth 1 commands", () => {
      // Should accept depth 1 (namespace:command)
      expect(validateCommandId("api:create")).toBe(true);
      expect(validateCommandId("tools:generate")).toBe(true);
    });

    it("should validate reasonable length command IDs", () => {
      const reasonableId = "api:createUser";
      expect(validateCommandId(reasonableId)).toBe(true);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle null and undefined inputs gracefully", () => {
      expect(() => generateCommandId(null as unknown as string, "")).toThrow();
      expect(() =>
        generateCommandId(undefined as unknown as string, ""),
      ).toThrow();
      expect(() => parseCommandId(null as unknown as string)).toThrow();
      expect(() => parseCommandId(undefined as unknown as string)).toThrow();
      expect(validateCommandId(null as unknown as string)).toBe(false);
      expect(validateCommandId(undefined as unknown as string)).toBe(false);
    });

    it("should handle invalid characters in path segments", () => {
      // Should reject invalid path segment characters
      expect(() =>
        generateCommandId(
          "/root/commands/invalid@namespace/test.md",
          "/root/commands",
        ),
      ).toThrow('Invalid command path segment: "invalid@namespace"');
    });

    it("should handle unicode characters", () => {
      expect(validateCommandId("命令")).toBe(false); // Should reject non-ASCII
      expect(validateCommandId("tëst")).toBe(false); // Should reject accented characters
    });

    it("should handle very short command names", () => {
      expect(validateCommandId("a")).toBe(true);
      expect(validateCommandId("x:y")).toBe(true);
    });
  });
});
