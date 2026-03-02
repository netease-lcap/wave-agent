import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillTool } from "../../src/tools/skillTool.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import type { SkillMetadata } from "../../src/types/skills.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("skillTool flags", () => {
  let skillManager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
  });

  describe("prompt filtering", () => {
    it("should filter out skills with disableModelInvocation: true", () => {
      const mockSkills: SkillMetadata[] = [
        {
          name: "visible-skill",
          type: "personal",
          description: "Visible skill",
          skillPath: "/path/1",
          disableModelInvocation: false,
        },
        {
          name: "hidden-skill",
          type: "personal",
          description: "Hidden skill",
          skillPath: "/path/2",
          disableModelInvocation: true,
        },
      ];

      const prompt = skillTool.prompt?.({ availableSkills: mockSkills });

      expect(prompt).toContain("visible-skill");
      expect(prompt).not.toContain("hidden-skill");
    });

    it("should show no skills if all are disabled for model invocation", () => {
      const mockSkills: SkillMetadata[] = [
        {
          name: "hidden-skill",
          type: "personal",
          description: "Hidden skill",
          skillPath: "/path/2",
          disableModelInvocation: true,
        },
      ];

      const prompt = skillTool.prompt?.({ availableSkills: mockSkills });

      expect(prompt).toContain("No skills are currently available");
      expect(prompt).not.toContain("hidden-skill");
    });
  });

  describe("execute blocking", () => {
    it("should block execution of skills with disableModelInvocation: true", async () => {
      const mockSkill: SkillMetadata = {
        name: "hidden-skill",
        type: "personal",
        description: "Hidden skill",
        skillPath: "/path/2",
        disableModelInvocation: true,
      };

      vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue(mockSkill);

      const context = {
        workdir: "/test",
        taskManager: new TaskManager(new Container(), "test-session"),
        skillManager,
      };

      const result = await skillTool.execute(
        { skill_name: "hidden-skill" },
        context as unknown as ToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available for model invocation");
    });

    it("should allow execution of skills with disableModelInvocation: false", async () => {
      const mockSkill: SkillMetadata = {
        name: "visible-skill",
        type: "personal",
        description: "Visible skill",
        skillPath: "/path/1",
        disableModelInvocation: false,
      };

      vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue(mockSkill);
      vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
        content: "Success",
        context: { skillName: "visible-skill" },
      });

      const context = {
        workdir: "/test",
        taskManager: new TaskManager(new Container(), "test-session"),
        skillManager,
      };

      const result = await skillTool.execute(
        { skill_name: "visible-skill" },
        context as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Success");
    });
  });
});
