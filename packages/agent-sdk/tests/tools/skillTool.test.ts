import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { createSkillTool } from "../../src/tools/skillTool.js";
import type { Logger } from "../../src/types.js";

describe("createSkillTool", () => {
  let skillManager: SkillManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    skillManager = new SkillManager({ logger: mockLogger });
  });

  it("should create a tool plugin with correct structure when not initialized", () => {
    // Mock isInitialized to return false
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(false);

    const tool = createSkillTool(skillManager);

    expect(tool.name).toBe("skill");
    expect(tool.config).toBeDefined();
    expect(tool.config.type).toBe("function");
    expect(tool.config.function.name).toBe("skill");
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.formatCompactParams).toBe("function");

    // When not initialized, enum should be empty
    const params = tool.config.function?.parameters as Record<string, unknown>;
    const properties = params?.properties as Record<string, unknown>;
    const skillName = properties?.skill_name as Record<string, unknown>;
    expect(skillName?.enum).toEqual([]);
  });

  it("should format compact params correctly", () => {
    // Mock isInitialized to return false
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(false);

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    expect(
      tool.formatCompactParams?.({ skill_name: "test-skill" }, context),
    ).toBe("test-skill");
    expect(tool.formatCompactParams?.({}, context)).toBe("unknown-skill");
  });

  it("should handle tool execution when not initialized", async () => {
    // Mock initialization to succeed
    vi.spyOn(skillManager, "initialize").mockResolvedValue(undefined);
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(false);
    vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
      content: "Test result",
      context: { skillName: "test-skill" },
    });

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };
    const result = await tool.execute?.({ skill_name: "test-skill" }, context);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Test result");
    expect(result.shortResult).toBe("Invoked skill: test-skill");
  });

  it("should validate skill_name parameter", async () => {
    // Mock isInitialized to return false initially
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(false);

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };

    // Mock initialization
    vi.spyOn(skillManager, "initialize").mockResolvedValue(undefined);

    const result = await tool.execute?.({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "skill_name parameter is required and must be a string",
    );
  });

  it("should handle initialization errors", async () => {
    vi.spyOn(skillManager, "initialize").mockRejectedValue(
      new Error("Init failed"),
    );
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(false);

    const tool = createSkillTool(skillManager);
    const context = { workdir: "/test" };
    const result = await tool.execute?.({ skill_name: "test-skill" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Init failed");
  });

  it("should create tool with initialized skill manager", () => {
    // Mock isInitialized to return true
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(true);
    vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([
      {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
      },
    ]);

    const tool = createSkillTool(skillManager);

    // When initialized, enum should contain available skill names
    const params = tool.config.function?.parameters as Record<string, unknown>;
    const properties = params?.properties as Record<string, unknown>;
    const skillName = properties?.skill_name as Record<string, unknown>;
    expect(skillName?.enum).toEqual(["test-skill"]);

    // Description should include available skills
    expect(tool.config.function.description).toContain("test-skill");
    expect(tool.config.function.description).toContain("A test skill");
  });

  it("should handle empty skills list when initialized", () => {
    // Mock isInitialized to return true but no skills available
    vi.spyOn(skillManager, "isInitialized").mockReturnValue(true);
    vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([]);

    const tool = createSkillTool(skillManager);

    // Description should indicate no skills available
    expect(tool.config.function.description).toContain(
      "No skills are currently available",
    );
  });
});
