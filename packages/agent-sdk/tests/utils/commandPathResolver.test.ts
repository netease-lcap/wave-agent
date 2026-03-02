import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  generateCommandId,
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

    it("should reject nested commands", () => {
      // Test nested command: .wave/commands/openspec/apply.md -> should be rejected
      expect(() =>
        generateCommandId("/root/commands/openspec/apply.md", "/root/commands"),
      ).toThrow(
        "Command nesting not supported: openspec/apply.md. Commands must be in the root directory.",
      );
    });

    it("should strip .md extension from command name", () => {
      const commandId = generateCommandId(
        "/root/commands/complex-command.md",
        "/root/commands",
      );
      expect(commandId).toBe("complex-command");
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

  describe("validateCommandId", () => {
    it("should validate correct flat command ID", () => {
      expect(validateCommandId("help")).toBe(true);
      expect(validateCommandId("create-user")).toBe(true);
      expect(validateCommandId("test_command")).toBe(true);
    });

    it("should reject nested command ID", () => {
      expect(validateCommandId("openspec:apply")).toBe(false);
      expect(validateCommandId("api:create-user")).toBe(false);
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

    it("should reject command ID with numbers at start", () => {
      expect(validateCommandId("123invalid")).toBe(false);
    });

    it("should accept numbers in middle or end", () => {
      expect(validateCommandId("command123")).toBe(true);
    });

    it("should validate reasonable length command IDs", () => {
      const reasonableId = "createUser";
      expect(validateCommandId(reasonableId)).toBe(true);
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle null and undefined inputs gracefully", () => {
      expect(() => generateCommandId(null as unknown as string, "")).toThrow();
      expect(() =>
        generateCommandId(undefined as unknown as string, ""),
      ).toThrow();
      expect(validateCommandId(null as unknown as string)).toBe(false);
      expect(validateCommandId(undefined as unknown as string)).toBe(false);
    });

    it("should handle unicode characters", () => {
      expect(validateCommandId("命令")).toBe(false); // Should reject non-ASCII
      expect(validateCommandId("tëst")).toBe(false); // Should reject accented characters
    });

    it("should handle very short command names", () => {
      expect(validateCommandId("a")).toBe(true);
    });
  });
});
