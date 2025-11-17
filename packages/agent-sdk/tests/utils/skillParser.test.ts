import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import {
  parseSkillFile,
  validateSkillMetadata,
  isValidSkillName,
  formatSkillError,
} from "../../src/utils/skillParser.js";
import type { SkillMetadata } from "../../src/types/index.js";

// Mock fs module
vi.mock("fs");

const mockReadFileSync = vi.mocked(readFileSync);

describe("skillParser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseSkillFile", () => {
    it("should parse valid SKILL.md file", () => {
      const mockContent = `---
name: test-skill
description: A test skill for validation
---

# Test Skill

This is a test skill content.`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.name).toBe("test-skill");
      expect(result.skillMetadata.description).toBe(
        "A test skill for validation",
      );
      expect(result.skillMetadata.type).toBe("personal");
      expect(result.validationErrors).toHaveLength(0);
    });

    it("should handle missing YAML frontmatter", () => {
      const mockContent = `# Test Skill

This is a test skill without frontmatter.`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(false);
      expect(result.validationErrors).toContain("Missing YAML frontmatter");
    });

    it("should handle missing required fields", () => {
      const mockContent = `---
name: test-skill
---

# Test Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile("/path/to/test-skill/SKILL.md");

      expect(result.isValid).toBe(false);
      expect(result.validationErrors).toContain(
        "Missing required fields: name and description",
      );
    });

    it("should detect project skills from .wave/skills path", () => {
      const mockContent = `---
name: project-skill
description: A project skill
---

# Project Skill`;

      mockReadFileSync.mockReturnValue(mockContent);

      const result = parseSkillFile(
        "/project/.wave/skills/project-skill/SKILL.md",
      );

      expect(result.isValid).toBe(true);
      expect(result.skillMetadata.type).toBe("project");
    });

    it("should handle file read errors", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      const result = parseSkillFile("/nonexistent/SKILL.md");

      expect(result.isValid).toBe(false);
      expect(result.validationErrors).toContain(
        "Failed to read skill file: File not found",
      );
    });
  });

  describe("validateSkillMetadata", () => {
    it("should validate correct metadata", () => {
      const metadata: SkillMetadata = {
        name: "valid-skill-name",
        description: "A valid description",
        type: "personal",
        skillPath: "/path/to/skill",
      };

      const errors = validateSkillMetadata(metadata);
      expect(errors).toHaveLength(0);
    });

    it("should reject invalid skill names", () => {
      const metadata: SkillMetadata = {
        name: "Invalid_Skill_Name",
        description: "A valid description",
        type: "personal",
        skillPath: "/path/to/skill",
      };

      const errors = validateSkillMetadata(metadata);
      expect(errors).toContain(
        "Skill name must contain only lowercase letters, numbers, and hyphens",
      );
    });

    it("should reject names that are too long", () => {
      const metadata: SkillMetadata = {
        name: "a".repeat(65), // 65 characters, exceeds limit of 64
        description: "A valid description",
        type: "personal",
        skillPath: "/path/to/skill",
      };

      const errors = validateSkillMetadata(metadata);
      expect(errors).toContain("Skill name must be 64 characters or less");
    });

    it("should reject empty descriptions", () => {
      const metadata: SkillMetadata = {
        name: "valid-skill",
        description: "",
        type: "personal",
        skillPath: "/path/to/skill",
      };

      const errors = validateSkillMetadata(metadata);
      expect(errors).toContain("Skill description is required");
    });

    it("should reject descriptions that are too long", () => {
      const metadata: SkillMetadata = {
        name: "valid-skill",
        description: "a".repeat(1025), // 1025 characters, exceeds limit of 1024
        type: "personal",
        skillPath: "/path/to/skill",
      };

      const errors = validateSkillMetadata(metadata);
      expect(errors).toContain(
        "Skill description must be 1024 characters or less",
      );
    });
  });

  describe("isValidSkillName", () => {
    it("should accept valid skill names", () => {
      expect(isValidSkillName("valid-skill")).toBe(true);
      expect(isValidSkillName("skill123")).toBe(true);
      expect(isValidSkillName("my-awesome-skill-2")).toBe(true);
    });

    it("should reject invalid skill names", () => {
      expect(isValidSkillName("Invalid_Name")).toBe(false);
      expect(isValidSkillName("Skill With Spaces")).toBe(false);
      expect(isValidSkillName("skill.with.dots")).toBe(false);
      expect(isValidSkillName("")).toBe(false);
      expect(isValidSkillName("a".repeat(65))).toBe(false);
    });
  });

  describe("formatSkillError", () => {
    it("should format error messages with suggestions", () => {
      const skillPath = "/path/to/skill";
      const errors = [
        "Missing required field: name",
        "Invalid description length",
      ];

      const result = formatSkillError(skillPath, errors);

      expect(result).toContain("Skill validation failed for /path/to/skill:");
      expect(result).toContain("• Missing required field: name");
      expect(result).toContain("• Invalid description length");
      expect(result).toContain("To fix this skill:");
      expect(result).toContain("Ensure SKILL.md has valid YAML frontmatter");
    });

    it("should handle single error", () => {
      const skillPath = "/path/to/skill";
      const errors = ["Missing YAML frontmatter"];

      const result = formatSkillError(skillPath, errors);

      expect(result).toContain("• Missing YAML frontmatter");
      expect(result).not.toContain("•\n•"); // Should not have empty bullet points
    });
  });
});
