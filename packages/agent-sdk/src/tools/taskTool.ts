import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import type { SubagentManager } from "../managers/subagentManager.js";

/**
 * Create a task tool plugin that uses the provided SubagentManager
 * Note: SubagentManager should be initialized before calling this function
 */
export function createTaskTool(subagentManager: SubagentManager): ToolPlugin {
  // Get available subagents from the initialized subagent manager
  const availableSubagents = subagentManager.getConfigurations();
  const subagentList = availableSubagents
    .map((config) => `- ${config.name}: ${config.description}`)
    .join("\n");

  const description = `Delegate a task to a specialized subagent. Use this when you need specialized expertise or want to break down complex work into focused subtasks.

Available subagents:
${subagentList || "No subagents configured"}`;

  return {
    name: "Task",
    config: {
      type: "function",
      function: {
        name: "Task",
        description,
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description:
                "A clear, concise description of what needs to be accomplished",
            },
            prompt: {
              type: "string",
              description:
                "The specific instructions or prompt to send to the subagent",
            },
            subagent_type: {
              type: "string",
              description: `The type or name of subagent to use. Available options: ${availableSubagents.map((c) => c.name).join(", ") || "none"}`,
            },
          },
          required: ["description", "prompt", "subagent_type"],
        },
      },
    },

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<ToolResult> => {
      // Input validation
      const description = args.description as string;
      const prompt = args.prompt as string;
      const subagent_type = args.subagent_type as string;

      if (!description || typeof description !== "string") {
        return {
          success: false,
          content: "",
          error: "description parameter is required and must be a string",
          shortResult: "Task delegation failed",
        };
      }

      if (!prompt || typeof prompt !== "string") {
        return {
          success: false,
          content: "",
          error: "prompt parameter is required and must be a string",
          shortResult: "Task delegation failed",
        };
      }

      if (!subagent_type || typeof subagent_type !== "string") {
        return {
          success: false,
          content: "",
          error: "subagent_type parameter is required and must be a string",
          shortResult: "Task delegation failed",
        };
      }

      try {
        // Subagent selection logic with explicit name matching only
        const configuration = await subagentManager.findSubagent(subagent_type);

        if (!configuration) {
          // Error handling for nonexistent subagents with available subagents listing
          const allConfigs = subagentManager.getConfigurations();
          const availableNames = allConfigs.map((c) => c.name).join(", ");

          return {
            success: false,
            content: "",
            error: `No subagent found matching "${subagent_type}". Available subagents: ${availableNames || "none"}`,
            shortResult: "Subagent not found",
          };
        }

        // Create subagent instance and execute task
        const instance = await subagentManager.createInstance(configuration, {
          description,
          prompt,
          subagent_type,
        });
        const response = await subagentManager.executeTask(
          instance,
          prompt,
          context.abortSignal,
        );

        return {
          success: true,
          content: response,
          shortResult: `Task completed by ${configuration.name}`,
        };
      } catch (error) {
        return {
          success: false,
          content: "",
          error: `Task delegation failed: ${error instanceof Error ? error.message : String(error)}`,
          shortResult: "Delegation error",
        };
      }
    },

    formatCompactParams: (params: Record<string, unknown>) => {
      const subagent_type = params.subagent_type as string;
      const description = params.description as string;
      return `${subagent_type || "unknown"}: ${description || "no description"}`;
    },
  };
}
