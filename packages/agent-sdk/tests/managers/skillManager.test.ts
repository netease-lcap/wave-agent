import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import type {
  SkillManagerOptions,
  SkillMetadata,
  Skill,
} from "../../src/types/index.js";
import { readdir, stat } from "fs/promises";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  parseSkillFile,
  formatSkillError,
} from "../../src/utils/skillParser.js";

vi.mock("fs/promises");
vi.mock("../../src/utils/skillParser.js", async () => {
  const actual = await vi.importActual("../../src/utils/skillParser.js");
  return {
    ...actual,
    parseSkillFile: vi.fn(),
    formatSkillError: vi.fn(),
  };
});

describe("SkillManager", () => {
  let skillManager: SkillManager;
  let container: Container;

  beforeEach(() => {
    vi.clearAllMocks();

    container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      const manager = new SkillManager(container, { workdir: "/test/workdir" });
      expect(manager).toBeInstanceOf(SkillManager);
    });

    it("should use provided options", () => {
      const options: SkillManagerOptions = {
        scanTimeout: 1000,
      };

      const manager = new SkillManager(container, options);
      expect(manager).toBeInstanceOf(SkillManager);
    });
  });

  describe("initialize", () => {
    it("should discover personal and project skills successfully", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes(".wave/skills")) {
          return [
            { name: "skill1", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });

      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: true,
        skillMetadata: {
          name: "skill1",
          description: "desc1",
          type: "personal",
          skillPath: "/path/to/skill1",
        },
        content: "---\nname: skill1\n---\ncontent1",
        frontmatter: { name: "skill1" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      await skillManager.initialize();

      expect(skillManager.isInitialized()).toBe(true);
      const skills = skillManager.getAvailableSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("skill1");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("SkillManager initialized with 1 skills"),
      );
    });

    it("should return skill metadata by name", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes(".wave/skills")) {
          return [
            { name: "skill1", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });

      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: true,
        skillMetadata: {
          name: "skill1",
          description: "desc1",
          type: "personal",
          skillPath: "/path/to/skill1",
          context: "fork",
          agent: "typescript-expert",
        },
        content: "---\nname: skill1\n---\ncontent1",
        frontmatter: { name: "skill1" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      await skillManager.initialize();

      const metadata = skillManager.getSkillMetadata("skill1");
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe("skill1");
      expect(metadata?.context).toBe("fork");
      expect(metadata?.agent).toBe("typescript-expert");
    });

    it("should handle discovery errors and log warnings", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes(".wave/skills")) {
          return [
            { name: "invalid-skill", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });

      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: false,
        validationErrors: ["Invalid format"],
      } as unknown as ReturnType<typeof parseSkillFile>);

      await skillManager.initialize();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Found 2 skill discovery errors"),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Skill error in"),
      );
    });

    it("should handle initialization failure and throw error", async () => {
      vi.mocked(readdir).mockRejectedValue(new Error("Read error"));

      // readdir is called for personal and project skills.
      // In discoverSkillCollection, readdir error is caught and logged as debug,
      // but if something else throws in initialize, it should be caught.
      // Let's mock discoverSkills to throw.
      vi.spyOn(
        skillManager as unknown as { discoverSkills: () => Promise<void> },
        "discoverSkills",
      ).mockRejectedValue(new Error("Discovery failed"));

      await expect(skillManager.initialize()).rejects.toThrow(
        "Discovery failed",
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to initialize SkillManager:",
        expect.any(Error),
      );
    });
  });

  describe("discoverSkillCollection and findSkillDirectories", () => {
    it("should skip directories without SKILL.md", async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: "no-skill-md", isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof readdir>>);
      vi.mocked(stat).mockRejectedValue(new Error("Not found"));

      await skillManager.initialize();

      expect(skillManager.getAvailableSkills()).toHaveLength(0);
    });

    it("should handle directory read errors gracefully", async () => {
      // findSkillDirectories catches readdir errors and returns empty array.
      // discoverSkillCollection catches findSkillDirectories errors (if any) or other errors and logs debug "Could not scan".
      // To trigger "Could not scan", we need findSkillDirectories to throw or something else in discoverSkillCollection to throw.
      // Since findSkillDirectories already has a try-catch around readdir, we need to mock findSkillDirectories itself.

      const spy = vi
        .spyOn(
          skillManager as unknown as {
            findSkillDirectories: () => Promise<string[]>;
          },
          "findSkillDirectories",
        )
        .mockRejectedValue(new Error("Scan failed"));

      await skillManager.initialize();

      expect(skillManager.getAvailableSkills()).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Could not scan"),
      );
      spy.mockRestore();
    });

    it("should handle readdir error in findSkillDirectories", async () => {
      vi.mocked(readdir).mockRejectedValue(new Error("readdir failed"));
      await skillManager.initialize();
      expect(skillManager.getAvailableSkills()).toHaveLength(0);
    });

    it("should handle invalid skill files", async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: "bad-skill", isDirectory: () => true },
      ] as unknown as Awaited<ReturnType<typeof readdir>>);
      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockImplementation(() => {
        throw new Error("Parse error");
      });

      await skillManager.initialize();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Found 2 skill discovery errors"),
      );
    });
  });

  describe("registerPluginSkills", () => {
    it("should register skills from plugins", async () => {
      // Initialize first
      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();

      const pluginSkill: Skill = {
        name: "plugin-skill",
        description: "from plugin",
        type: "personal",
        skillPath: "/plugin/path",
        content: "content",
        frontmatter: { name: "plugin-skill", description: "from plugin" },
        isValid: true,
        errors: [],
      };

      skillManager.registerPluginSkills([pluginSkill]);

      const skills = skillManager.getAvailableSkills();
      expect(skills.find((s) => s.name === "plugin-skill")).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered 1 plugin skills"),
      );
    });
  });

  describe("loadSkill", () => {
    it("should load skill from skillContent map", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes(".wave/skills")) {
          return [
            { name: "skill1", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });
      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockReturnValue({
        isValid: true,
        skillMetadata: { name: "skill1", skillPath: "/path1" },
        content: "---\nname: skill1\n---\ncontent1",
        frontmatter: { name: "skill1" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      await skillManager.initialize();
      const skill = await skillManager.loadSkill("skill1");

      expect(skill).toBeDefined();
      expect(skill?.name).toBe("skill1");
      expect(logger.debug).toHaveBeenCalledWith(
        "Skill 'skill1' retrieved from loaded content",
      );
    });

    it("should return null if skill not found", async () => {
      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();

      const skill = await skillManager.loadSkill("nonexistent");
      expect(skill).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        "Skill 'nonexistent' not found",
      );
    });
  });

  describe("formatSkillContent", () => {
    it("should format skill content correctly with frontmatter", async () => {
      const mockSkill: Skill = {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: test-skill\ndescription: A test skill\n---\n\n# Actual Content",
        frontmatter: { name: "test-skill", description: "A test skill" },
        isValid: true,
        errors: [],
      };

      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();
      skillManager.registerPluginSkills([mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-skill",
      });

      expect(result.content).toContain("🧠 **test-skill** (personal skill)");
      expect(result.content).toContain("*A test skill*");
      expect(result.content).toContain("📁 Skill location: `/path/to/skill`");
      expect(result.content).toContain("# Actual Content");
      expect(result.content).not.toContain("---");
    });

    it("should not include fork info in formatted skill content", async () => {
      const mockSkill: Skill = {
        name: "fork-skill",
        description: "A forked skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: fork-skill\ndescription: A forked skill\ncontext: fork\n---\n\n# Actual Content",
        frontmatter: {
          name: "fork-skill",
          description: "A forked skill",
          context: "fork",
        },
        isValid: true,
        errors: [],
        context: "fork",
      };

      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();
      skillManager.registerPluginSkills([mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "fork-skill",
      });

      expect(result.content).toContain("🧠 **fork-skill** (personal skill)");
      expect(result.content).not.toContain("🔄 Context: `fork`");
      expect(result.content).toContain("# Actual Content");
    });

    it("should format skill content correctly without frontmatter markers in content", async () => {
      const mockSkill: Skill = {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content: "# Just Content",
        frontmatter: { name: "test-skill", description: "A test skill" },
        isValid: true,
        errors: [],
      };

      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();
      skillManager.registerPluginSkills([mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-skill",
      });

      expect(result.content).toContain("# Just Content");
    });
  });

  describe("executeSkill", () => {
    beforeEach(async () => {
      // Mock initialization to make other methods available
      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([]);
      vi.spyOn(skillManager, "loadSkill").mockResolvedValue(null);
      await skillManager.initialize();
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

    it("should return allowedTools when executing skill", async () => {
      const mockSkill: Skill = {
        name: "test-skill",
        description: "A test skill",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: test-skill\ndescription: A test skill\nallowed-tools: tool1, tool2\n---\n\n# Test Content",
        frontmatter: {
          name: "test-skill",
          description: "A test skill",
          "allowed-tools": ["tool1", "tool2"],
        },
        isValid: true,
        errors: [],
        allowedTools: ["tool1", "tool2"],
      };

      vi.mocked(skillManager.loadSkill).mockResolvedValue(mockSkill);

      const result = await skillManager.executeSkill({
        skill_name: "test-skill",
      });

      expect(result.allowedTools).toEqual(["tool1", "tool2"]);
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

      vi.mocked(formatSkillError).mockReturnValue("Formatted Error");

      const result = await skillManager.executeSkill({
        skill_name: "invalid-skill",
      });

      expect(result.content).toContain("❌ **Skill validation failed**");
      expect(result.content).toContain("Formatted Error");
    });

    it("should handle skill loading error", async () => {
      vi.mocked(skillManager.loadSkill).mockRejectedValue(
        new Error("Loading failed") as never,
      );

      const result = await skillManager.executeSkill({
        skill_name: "error-skill",
      });

      expect(result.content).toContain(
        "❌ **Error executing skill**: Loading failed",
      );
      expect(logger.error).toHaveBeenCalledWith(
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

      expect(logger.debug).toHaveBeenCalledWith(
        "Invoking skill: test-skill with args: undefined",
      );
    });
  });

  describe("formatAvailableSkills", () => {
    beforeEach(async () => {
      await skillManager.initialize();
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
