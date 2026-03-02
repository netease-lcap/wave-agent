import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { SKILL_TOOL_NAME } from "../constants/tools.js";
import { GENERAL_PURPOSE_SUBAGENT_TYPE } from "../constants/subagents.js";
import type { SkillMetadata } from "../types/skills.js";
import { logger } from "../utils/globalLogger.js";
import {
  countToolBlocks,
  formatToolTokenSummary,
} from "../utils/messageOperations.js";

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
    const availableSkills = args?.availableSkills?.filter(
      (skill) => !skill.disableModelInvocation,
    );
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

      const skillMetadata = skillManager.getSkillMetadata(skillName);

      if (skillMetadata?.disableModelInvocation) {
        return {
          success: false,
          content: "",
          error: `Skill "${skillName}" is not available for model invocation.`,
        };
      }

      // Handle fork context
      if (skillMetadata?.context === "fork") {
        const subagentManager = context.subagentManager;
        if (!subagentManager) {
          return {
            success: false,
            content: "",
            error: "Subagent manager not available in tool context",
          };
        }

        const agentType = skillMetadata.agent || GENERAL_PURPOSE_SUBAGENT_TYPE;
        const configuration = await subagentManager.findSubagent(agentType);

        if (!configuration) {
          return {
            success: false,
            content: "",
            error: `No subagent found matching "${agentType}" for skill "${skillName}"`,
          };
        }

        // Execute the skill to get the content
        const skillResult = await skillManager.executeSkill({
          skill_name: skillName,
          args: skillArgs,
        });

        logger.debug(`Skill ${skillName} executed, allowedTools:`, {
          allowedTools: skillResult.allowedTools,
        });

        // Create subagent instance
        const instance = await subagentManager.createInstance(
          configuration,
          {
            description: `Skill: ${skillName}`,
            prompt: skillResult.content,
            subagent_type: agentType,
            allowedTools: skillResult.allowedTools,
            model: skillMetadata.model,
          },
          false, // run_in_background
          () => {
            // Update shortResult
            const messages = instance.messageManager.getMessages();
            const tokens = instance.messageManager.getlatestTotalTokens();
            const lastTools = instance.lastTools;

            const toolCount = countToolBlocks(messages);
            const summary = formatToolTokenSummary(toolCount, tokens);

            let shortResult = "";
            if (toolCount > 2) {
              shortResult += "... ";
            }
            if (lastTools.length > 0) {
              shortResult += `${lastTools.join(", ")} `;
            }
            shortResult += summary;

            context.onShortResultUpdate?.(shortResult);
          },
        );

        try {
          const result = await subagentManager.executeTask(
            instance,
            skillResult.content,
            context.abortSignal,
            false,
          );

          // Cleanup subagent instance after task completion
          subagentManager.cleanupInstance(instance.subagentId);

          const messages = instance.messageManager.getMessages();
          const tokens = instance.messageManager.getlatestTotalTokens();
          const toolCount = countToolBlocks(messages);
          const summary = formatToolTokenSummary(toolCount, tokens);

          return {
            success: true,
            content: result,
            shortResult: `Invoked skill: ${skillName}${summary ? ` ${summary}` : ""}`,
          };
        } catch (error) {
          return {
            success: false,
            content: "",
            error: `Skill fork failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      // Standard execution
      const result = await skillManager.executeSkill({
        skill_name: skillName,
        args: skillArgs,
      });

      // Add temporary rules if allowedTools are present
      if (result.allowedTools && result.allowedTools.length > 0) {
        context.permissionManager?.addTemporaryRules(result.allowedTools);
      }

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
