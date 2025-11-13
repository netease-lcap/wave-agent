import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stats } from "fs";
import { SkillManager } from "../../src/managers/skillManager.js";
import { createSkillTool } from "../../src/tools/skillTool.js";
import type { Logger } from "../../src/types/index.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock os module
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock path module
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}));

// Mock skill parser
vi.mock("../../src/utils/skillParser.js", () => ({
  parseSkillFile: vi.fn(),
  formatSkillError: vi.fn(),
}));

import { readdir, stat } from "fs/promises";

const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

describe("createSkillTool", () => {
  let skillManager: SkillManager;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    // Mock empty directory by default (no skills found)
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as Stats);

    skillManager = new SkillManager({ logger: mockLogger });
  });

  it("should throw error when created with uninitialized SkillManager", () => {
    // This should throw because SkillManager is not initialized
    expect(() => createSkillTool(skillManager)).toThrow(
      "SkillManager not initialized. Call initialize() first.",
    );
  });

  it("should create a tool plugin with correct structure when initialized with no skills", async () => {
    // Initialize the skill manager first
    await skillManager.initialize();

    const tool = createSkillTool(skillManager);

    expect(tool.name).toBe("skill");
    expect(tool.config).toBeDefined();
    expect(tool.config.type).toBe("function");
    expect(tool.config.function.name).toBe("skill");
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.formatCompactParams).toBe("function");

    // When initialized with no skills, enum should be empty
    const params = tool.config.function?.parameters as Record<string, unknown>;
    const properties = params?.properties as Record<string, unknown>;
    const skillName = properties?.skill_name as Record<string, unknown>;
    expect(skillName?.enum).toEqual([]);
  });

  it("should format compact params correctly", async () => {
    await skillManager.initialize();
    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    const params = { skill_name: "test-skill" };
    const formatted = tool.formatCompactParams?.(params, context);

    expect(formatted).toBe("test-skill");
  });

  it("should handle missing skill_name parameter in formatCompactParams", async () => {
    await skillManager.initialize();
    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    const params = {};
    const formatted = tool.formatCompactParams?.(params, context);

    expect(formatted).toBe("unknown-skill");
  });

  it("should validate skill_name parameter", async () => {
    await skillManager.initialize();
    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    const result = await tool.execute({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "skill_name parameter is required and must be a string",
    );
  });

  it("should handle skill execution successfully", async () => {
    await skillManager.initialize();

    // Mock executeSkill to return success
    vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
      content: "Test result",
      context: { skillName: "test-skill" },
    });

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    const result = await tool.execute({ skill_name: "test-skill" }, context);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Test result");
    expect(result.shortResult).toBe("Invoked skill: test-skill");
  });

  it("should handle skill execution errors", async () => {
    await skillManager.initialize();

    // Mock executeSkill to throw an error
    vi.spyOn(skillManager, "executeSkill").mockRejectedValue(
      new Error("Test error"),
    );

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    const result = await tool.execute({ skill_name: "test" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Test error");
  });

  it("should create tool with initialized skill manager", async () => {
    // Initialize with mock skills
    await skillManager.initialize();

    // Mock some skills for the enum
    const mockSkills = [
      {
        name: "test-skill",
        type: "personal" as const,
        description: "Test skill",
        skillPath: "/path/to/test",
      },
      {
        name: "another-skill",
        type: "project" as const,
        description: "Another skill",
        skillPath: "/path/to/another",
      },
    ];
    vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue(mockSkills);

    const tool = createSkillTool(skillManager);

    expect(tool.name).toBe("skill");
    expect(tool.config.function.description).toContain("Available skills:");
    expect(tool.config.function.description).toContain("test-skill");
    expect(tool.config.function.description).toContain("another-skill");

    // Check enum contains skill names
    const params = tool.config.function?.parameters as Record<string, unknown>;
    const properties = params?.properties as Record<string, unknown>;
    const skillName = properties?.skill_name as Record<string, unknown>;
    expect(skillName?.enum).toEqual(["test-skill", "another-skill"]);
  });

  it("should handle empty skills list when initialized", async () => {
    await skillManager.initialize();
    const tool = createSkillTool(skillManager);

    expect(tool.config.function.description).toContain(
      "No skills are currently available",
    );
  });
});
