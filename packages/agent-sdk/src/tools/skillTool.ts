import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { SKILL_TOOL_NAME } from "../constants/tools.js";
import type { SkillMetadata } from "../types/skills.js";

/**
 * Skill tool plugin for invoking Wave skills
 */
export const skillTool: ToolPlugin = {
  name: SKILL_TOOL_NAME,
  config: {
    type: "function" as const,
    function: {
      name: SKILL_TOOL_NAME,
      description:
        "Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific.",
      parameters: {
        type: "object",
        properties: {
          skill_name: {
            type: "string",
            description: "Name of the skill to invoke",
          },
          args: {
            type: "string",
            description: "Optional arguments to pass to the skill",
          },
        },
        required: ["skill_name"],
      },
    },
  },

  prompt: (args?: { availableSkills?: SkillMetadata[] }) => {
    const availableSkills = args?.availableSkills;
    if (!availableSkills || availableSkills.length === 0) {
      return "Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific. No skills are currently available.";
    }

    const skillList = availableSkills
      .map(
        (skill) => `• **${skill.name}** (${skill.type}): ${skill.description}`,
      )
      .join("\n");

    return `Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific.\n\nAvailable skills:\n${skillList}`;
  },

  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    try {
      const skillManager = context.skillManager;
      if (!skillManager) {
        return {
          success: false,
          content: "",
          error: "Skill manager not available in tool context",
        };
      }

      // Validate arguments
      const skillName = args.skill_name as string;
      const skillArgs = args.args as string | undefined;

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
        args: skillArgs,
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
