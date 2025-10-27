import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import type {
  Logger,
  SkillManagerOptions,
  SkillMetadata,
  Skill,
} from "../../src/types.js";

describe("SkillManager", () => {
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

  describe("constructor", () => {
    it("should initialize with default options", () => {
      const manager = new SkillManager();
      expect(manager).toBeInstanceOf(SkillManager);
    });

    it("should use provided options", () => {
      const options: SkillManagerOptions = {
        logger: mockLogger,
        maxMetadataCache: 100,
      };

      const manager = new SkillManager(options);
      expect(manager).toBeInstanceOf(SkillManager);
    });
  });

  describe("initialization checks", () => {
    it("should throw error if not initialized when getting skills", () => {
      expect(() => skillManager.getAvailableSkills()).toThrow(
        "SkillManager not initialized. Call initialize() first.",
      );
    });

    it("should throw error if not initialized when loading skill", async () => {
      await expect(skillManager.loadSkill("test")).rejects.toThrow(
        "SkillManager not initialized. Call initialize() first.",
      );
    });
  });

  describe("createTool", () => {
    it("should create a tool plugin with correct structure when not initialized", () => {
      const tool = skillManager.createTool();

      expect(tool.name).toBe("skill");
      expect(tool.description).toContain(
        "Skills will be loaded during initialization",
      );
      expect(tool.config).toBeDefined();
      expect(tool.config.type).toBe("function");
      expect(tool.config.function.name).toBe("skill");
      expect(typeof tool.execute).toBe("function");
      expect(typeof tool.formatCompactParams).toBe("function");

      // When not initialized, enum should be empty
      const params = tool.config.function?.parameters as Record<
        string,
        unknown
      >;
      const properties = params?.properties as Record<string, unknown>;
      const skillName = properties?.skill_name as Record<string, unknown>;
      expect(skillName?.enum).toEqual([]);
    });

    it("should format compact params correctly", () => {
      const tool = skillManager.createTool();
      const context = { workdir: "/test" };

      expect(
        tool.formatCompactParams?.({ skill_name: "test-skill" }, context),
      ).toBe("test-skill");
      expect(tool.formatCompactParams?.({}, context)).toBe("unknown-skill");
    });

    it("should handle tool execution when not initialized", async () => {
      // Mock initialization to succeed
      vi.spyOn(skillManager, "initialize").mockResolvedValue(undefined);
      vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
        content: "Test result",
        context: { skillName: "test-skill" },
      });

      const tool = skillManager.createTool();
      const context = { workdir: "/test" };
      const result = await tool.execute?.(
        { skill_name: "test-skill" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Test result");
      expect(result.shortResult).toBe("Invoked skill: test-skill");
    });

    it("should validate skill_name parameter", async () => {
      const tool = skillManager.createTool();
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

      const tool = skillManager.createTool();
      const context = { workdir: "/test" };
      const result = await tool.execute?.(
        { skill_name: "test-skill" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Init failed");
    });
  });

  describe("executeSkill", () => {
    beforeEach(() => {
      // Mock initialization to make other methods available
      vi.spyOn(skillManager, "initialize").mockResolvedValue(undefined);
      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([]);
      vi.spyOn(skillManager, "loadSkill").mockResolvedValue(null);
      // @ts-expect-error - accessing private property for testing
      skillManager.initialized = true;
    });

    it("should execute valid skill successfully", async () => {
      const mockSkill: Skill = {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Content",
        frontmatter: { name: "test-skill", description: "A test skill" },
        isValid: true,
        errors: [],
      };

      vi.mocked(skillManager.loadSkill).mockResolvedValue(mockSkill);

      const result = await skillManager.executeSkill({
        skill_name: "test-skill",
      });

      expect(result.content).toContain("🧠 **test-skill**");
      expect(result.content).toContain("personal skill");
      expect(result.content).toContain("A test skill");
      expect(result.content).toContain("# Test Content");
      expect(result.context).toEqual({ skillName: "test-skill" });
    });

    it("should handle skill not found", async () => {
      const mockSkills: SkillMetadata[] = [
        {
          name: "available-skill",
          description: "An available skill",
          type: "personal",
          skillPath: "/path/to/skill",
        },
      ];

      vi.mocked(skillManager.loadSkill).mockResolvedValue(null);
      vi.mocked(skillManager.getAvailableSkills).mockReturnValue(mockSkills);

      const result = await skillManager.executeSkill({
        skill_name: "nonexistent-skill",
      });

      expect(result.content).toContain(
        '❌ **Skill not found**: "nonexistent-skill"',
      );
      expect(result.content).toContain("Available skills:");
      expect(result.content).toContain("available-skill");
    });

    it("should handle invalid skill", async () => {
      const mockSkill: Skill = {
        name: "invalid-skill",
        description: "An invalid skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content: "invalid content",
        frontmatter: {
          name: "invalid-skill",
          description: "An invalid skill",
        },
        isValid: false,
        errors: ["Missing required field: name"],
      };

      vi.mocked(skillManager.loadSkill).mockResolvedValue(mockSkill);

      const result = await skillManager.executeSkill({
        skill_name: "invalid-skill",
      });

      expect(result.content).toContain("❌ **Skill validation failed**");
      expect(result.content).toContain("Missing required field: name");
    });

    it("should handle skill loading error", async () => {
      vi.mocked(skillManager.loadSkill).mockRejectedValue(
        new Error("Loading failed"),
      );

      const result = await skillManager.executeSkill({
        skill_name: "error-skill",
      });

      expect(result.content).toContain(
        "❌ **Error executing skill**: Loading failed",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to execute skill 'error-skill':",
        expect.any(Error),
      );
    });

    it("should log skill invocation", async () => {
      const mockSkill: Skill = {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: test-skill\ndescription: A test skill\n---\n\n# Content",
        frontmatter: { name: "test-skill", description: "A test skill" },
        isValid: true,
        errors: [],
      };

      vi.mocked(skillManager.loadSkill).mockResolvedValue(mockSkill);

      await skillManager.executeSkill({ skill_name: "test-skill" });

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Invoking skill: test-skill",
      );
    });
  });

  describe("cache management", () => {
    it("should clear caches", () => {
      expect(() => skillManager.clearCache()).not.toThrow();
    });

    it("should return cache stats", () => {
      const stats = skillManager.getCacheStats();
      expect(stats).toHaveProperty("metadataSize");
      expect(stats).toHaveProperty("contentSize");
      expect(typeof stats.metadataSize).toBe("number");
      expect(typeof stats.contentSize).toBe("number");
    });
  });

  describe("formatAvailableSkills", () => {
    beforeEach(() => {
      // @ts-expect-error - accessing private property for testing
      skillManager.initialized = true;
    });

    it("should format skills list correctly when skills exist", async () => {
      const mockSkills: SkillMetadata[] = [
        {
          name: "skill-1",
          description: "First skill",
          type: "personal",
          skillPath: "/path/1",
        },
        {
          name: "skill-2",
          description: "Second skill",
          type: "project",
          skillPath: "/path/2",
        },
      ];

      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue(mockSkills);
      vi.spyOn(skillManager, "loadSkill").mockResolvedValue(null);

      const result = await skillManager.executeSkill({
        skill_name: "nonexistent",
      });

      expect(result.content).toContain("• **skill-1** (personal): First skill");
      expect(result.content).toContain("• **skill-2** (project): Second skill");
    });

    it("should show no skills message when empty", async () => {
      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([]);
      vi.spyOn(skillManager, "loadSkill").mockResolvedValue(null);

      const result = await skillManager.executeSkill({
        skill_name: "nonexistent",
      });

      expect(result.content).toContain("• No skills available");
      expect(result.content).toContain("Wave Skills documentation");
    });
  });
});
