import type { ToolPlugin, ToolResult } from "./types.js";
import type { SkillManager } from "../managers/skillManager.js";

/**
 * Create a skill tool plugin that uses the provided SkillManager
 * Note: SkillManager should be initialized before calling this function
 */
export function createSkillTool(skillManager: SkillManager): ToolPlugin {
  // Ensure SkillManager is initialized
  skillManager.getAvailableSkills();

  return {
    name: "Skill",
    get config() {
      const availableSkills = skillManager.getAvailableSkills();

      const getToolDescription = (): string => {
        if (availableSkills.length === 0) {
          return "Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific. No skills are currently available.";
        }

        const skillList = availableSkills
          .map(
            (skill) =>
              `• **${skill.name}** (${skill.type}): ${skill.description}`,
          )
          .join("\n");

        return `Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific.\n\nAvailable skills:\n${skillList}`;
      };

      return {
        type: "function" as const,
        function: {
          name: "Skill",
          description: getToolDescription(),
          parameters: {
            type: "object",
            properties: {
              skill_name: {
                type: "string",
                description: "Name of the skill to invoke",
                enum: availableSkills.map((skill) => skill.name),
              },
            },
            required: ["skill_name"],
          },
        },
      };
    },
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        // Validate arguments
        const skillName = args.skill_name as string;
        if (!skillName || typeof skillName !== "string") {
          return {
            success: false,
            content: "",
            error: "skill_name parameter is required and must be a string",
          };
        }

        // Execute the skill
        const result = await skillManager.executeSkill({
          skill_name: skillName,
        });

        return {
          success: true,
          content: result.content,
          shortResult: `Invoked skill: ${skillName}`,
        };
      } catch (error) {
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    formatCompactParams: (params: Record<string, unknown>) => {
      const skillName = params.skill_name as string;
      return skillName || "unknown-skill";
    },
  };
}
