import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { Container } from "../../src/utils/container.js";
import type {
  SkillManagerOptions,
  SkillMetadata,
  Skill,
} from "../../src/types/index.js";
import { readdir, stat } from "fs/promises";
import { logger } from "../../src/utils/globalLogger.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";

vi.mock("../../src/utils/configPaths.js", async () => {
  const actual = await vi.importActual("../../src/utils/configPaths.js");
  return {
    ...actual,
    getBuiltinSkillsDir: vi.fn().mockReturnValue("/test/builtin-skills"),
  };
});

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
vi.mock("../../src/services/fileWatcher.js");
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
  let mockFileWatcher: {
    watchFile: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockFileWatcher = {
      watchFile: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return mockFileWatcher;
    } as unknown as typeof FileWatcherService);

    container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
  });

  afterEach(async () => {
    if (skillManager) {
      await skillManager.destroy();
    }
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
    it("should discover builtin, personal and project skills successfully", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.includes("builtin-skills")) {
          return [
            { name: "builtin1", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        if (p.includes(".wave/skills")) {
          return [
            { name: "skill1", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });

      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockImplementation((filePath) => {
        const path = filePath as string;
        const name = path.includes("builtin1") ? "builtin1" : "skill1";
        const type = path.includes("builtin1") ? "builtin" : "personal";
        return {
          isValid: true,
          skillMetadata: {
            name,
            description: "desc",
            type,
            skillPath: path,
          },
          content: `---\nname: ${name}\n---\ncontent`,
          frontmatter: { name },
          validationErrors: [],
        } as unknown as ReturnType<typeof parseSkillFile>;
      });

      await skillManager.initialize();

      expect(skillManager.isInitialized()).toBe(true);
      const skills = skillManager.getAvailableSkills();
      expect(skills).toHaveLength(2);
      expect(skills.find((s) => s.name === "builtin1")).toBeDefined();
      expect(skills.find((s) => s.name === "skill1")).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("SkillManager initialized with 2 skills"),
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
          agent: "general-purpose",
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
      expect(metadata?.agent).toBe("general-purpose");
    });

    it("should handle discovery errors and log warnings", async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.includes(".wave/skills") || p.includes("builtin-skills")) {
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
        expect.stringContaining("Found 3 skill discovery errors"),
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
      vi.mocked(readdir).mockImplementation(async (path) => {
        const p = path.toString();
        if (p.includes(".wave/skills") || p.includes("builtin-skills")) {
          return [
            { name: "bad-skill", isDirectory: () => true },
          ] as unknown as Awaited<ReturnType<typeof readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      });
      vi.mocked(stat).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof stat>>,
      );
      vi.mocked(parseSkillFile).mockImplementation(() => {
        throw new Error("Parse error");
      });

      await skillManager.initialize();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Found 3 skill discovery errors"),
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

      skillManager.registerPluginSkills("test-plugin", [pluginSkill]);

      const skills = skillManager.getAvailableSkills();
      expect(
        skills.find((s) => s.name === "test-plugin:plugin-skill"),
      ).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered 1 plugin skills from test-plugin"),
      );
    });

    it("should register all metadata fields from plugin skills", async () => {
      // Initialize first
      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();

      const pluginSkill: Skill = {
        name: "plugin-skill",
        description: "from plugin",
        type: "personal",
        skillPath: "/plugin/path",
        content: "content",
        frontmatter: {
          name: "plugin-skill",
          description: "from plugin",
          context: "fork",
          agent: "general-purpose",
          model: "gpt-4",
        },
        isValid: true,
        errors: [],
        context: "fork",
        agent: "general-purpose",
        model: "gpt-4",
        disableModelInvocation: true,
        userInvocable: false,
      };

      skillManager.registerPluginSkills("test-plugin", [pluginSkill]);

      const metadata = skillManager.getSkillMetadata(
        "test-plugin:plugin-skill",
      );
      expect(metadata).toBeDefined();
      expect(metadata?.context).toBe("fork");
      expect(metadata?.agent).toBe("general-purpose");
      expect(metadata?.model).toBe("gpt-4");
      expect(metadata?.disableModelInvocation).toBe(true);
      expect(metadata?.userInvocable).toBe(false);
      expect(metadata?.pluginName).toBe("test-plugin");
    });

    it("should namespace skill names from plugins", async () => {
      // Initialize first
      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();

      const pluginSkill: Skill = {
        name: "my-skill",
        description: "from plugin",
        type: "personal",
        skillPath: "/plugin/path",
        content: "content",
        frontmatter: { name: "my-skill", description: "from plugin" },
        isValid: true,
        errors: [],
      };

      skillManager.registerPluginSkills("my-plugin", [pluginSkill]);

      const skills = skillManager.getAvailableSkills();
      const namespacedSkill = skills.find(
        (s) => s.name === "my-plugin:my-skill",
      );
      expect(namespacedSkill).toBeDefined();
      expect(namespacedSkill?.pluginName).toBe("my-plugin");
      expect(pluginSkill.name).toBe("my-plugin:my-skill");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Registered 1 plugin skills from my-plugin"),
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
      skillManager.registerPluginSkills("test-plugin", [mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-plugin:test-skill",
      });

      expect(result.content).toContain(
        "🧠 **test-plugin:test-skill** (personal skill)",
      );
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
      skillManager.registerPluginSkills("test-plugin", [mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-plugin:fork-skill",
      });

      expect(result.content).toContain(
        "🧠 **test-plugin:fork-skill** (personal skill)",
      );
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
      skillManager.registerPluginSkills("test-plugin", [mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-plugin:test-skill",
      });

      expect(result.content).toContain("# Just Content");
    });

    it("should substitute ${WAVE_SKILL_DIR} with the skill's directory path", async () => {
      const mockSkill: Skill = {
        name: "path-skill",
        description: "A skill with path",
        type: "personal",
        skillPath: "/path/to/skill",
        content:
          "---\nname: path-skill\ndescription: A skill with path\n---\n\nSkill is at ${WAVE_SKILL_DIR}",
        frontmatter: { name: "path-skill", description: "A skill with path" },
        isValid: true,
        errors: [],
      };

      vi.mocked(readdir).mockResolvedValue([]);
      await skillManager.initialize();
      skillManager.registerPluginSkills("test-plugin", [mockSkill]);

      const result = await skillManager.executeSkill({
        skill_name: "test-plugin:path-skill",
      });

      expect(result.content).toContain("Skill is at /path/to/skill");
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
        "❌ **Error preparing skill**: Loading failed",
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to prepare skill 'error-skill':",
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

      expect(logger.debug).toHaveBeenCalledWith("Invoking skill: test-skill");
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

  describe("Watcher", () => {
    it("should initialize watcher when watch option is true", async () => {
      const manager = new SkillManager(container, {
        workdir: "/test/workdir",
        watch: true,
      });
      vi.mocked(readdir).mockResolvedValue([]);

      await manager.initialize();

      expect(FileWatcherService).toHaveBeenCalled();
      expect(mockFileWatcher.watchFile).toHaveBeenCalledWith(
        expect.stringContaining(".wave/skills"),
        expect.any(Function),
      );
      expect(mockFileWatcher.watchFile).toHaveBeenCalledWith(
        expect.stringContaining("/test/workdir/.wave/skills"),
        expect.any(Function),
      );
    });

    it("should not initialize watcher when watch option is false", async () => {
      const manager = new SkillManager(container, {
        workdir: "/test/workdir",
        watch: false,
      });
      vi.mocked(readdir).mockResolvedValue([]);

      await manager.initialize();

      expect(FileWatcherService).not.toHaveBeenCalled();
    });

    it("should refresh skills and update slash commands when a change is detected", async () => {
      const manager = new SkillManager(container, {
        workdir: "/test/workdir",
        watch: true,
      });
      container.register("SkillManager", manager);

      const slashCommandManager = new SlashCommandManager(container, {
        workdir: "/test/workdir",
      });
      slashCommandManager.initialize();

      vi.mocked(readdir).mockResolvedValue([]);
      await manager.initialize();

      // Get the callback passed to watchFile
      const onEventCallback = mockFileWatcher.watchFile.mock.calls[0][1];

      // Mock readdir to return a new skill after refresh
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes(".wave/skills")) {
          return [
            { name: "new-skill", isDirectory: () => true },
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
          name: "new-skill",
          description: "new desc",
          type: "personal",
          skillPath: "/path/to/new-skill",
        },
        content: "content",
        frontmatter: { name: "new-skill" },
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>);

      // Trigger the callback
      await onEventCallback({
        type: "change",
        path: "/test/workdir/.wave/skills/new-skill/SKILL.md",
        timestamp: Date.now(),
      });

      // Check if skills were refreshed
      const skills = manager.getAvailableSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("new-skill");

      // Check if slash commands were updated
      const commands = slashCommandManager.getCommands();
      expect(commands.find((c) => c.id === "new-skill")).toBeDefined();
    });

    it("should cleanup watcher when destroyed", async () => {
      const manager = new SkillManager(container, {
        workdir: "/test/workdir",
        watch: true,
      });
      vi.mocked(readdir).mockResolvedValue([]);
      await manager.initialize();

      await manager.destroy();

      expect(mockFileWatcher.cleanup).toHaveBeenCalled();
    });
  });
});
