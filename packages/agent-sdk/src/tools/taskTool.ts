import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import type { SubagentManager } from "../managers/subagentManager.js";
import { TASK_TOOL_NAME } from "../constants/tools.js";

/**
 * Create a task tool plugin that uses the provided SubagentManager
 * Note: SubagentManager should be initialized before calling this function
 */
export function createTaskTool(subagentManager: SubagentManager): ToolPlugin {
  // Ensure SubagentManager is initialized
  subagentManager.getConfigurations();

  return {
    name: TASK_TOOL_NAME,
    get config() {
      // Get available subagents from the initialized subagent manager
      const availableSubagents = subagentManager.getConfigurations();
      const subagentList = availableSubagents
        .map((config) => `- ${config.name}: ${config.description}`)
        .join("\n");

      const description = `Delegate a task to a specialized subagent. Use this when you need specialized expertise or want to break down complex work into focused subtasks.
    
    Available subagents:
    ${subagentList || "No subagents configured"}`;

      return {
        type: "function" as const,
        function: {
          name: TASK_TOOL_NAME,
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
              run_in_background: {
                type: "boolean",
                description:
                  "Set to true to run this command in the background. Use TaskOutput to read the output later.",
              },
            },
            required: ["description", "prompt", "subagent_type"],
          },
        },
      };
    },

    prompt: () => `
- When doing file search, prefer to use the ${TASK_TOOL_NAME} tool in order to reduce context usage.
- You should proactively use the ${TASK_TOOL_NAME} tool with specialized agents when the task at hand matches the agent's description.
- VERY IMPORTANT: When exploring the codebase to gather context or to answer a question that is not a needle query for a specific file/class/function, it is CRITICAL that you use the ${TASK_TOOL_NAME} tool with subagent_type=Explore instead of running search commands directly.`,

    execute: async (
      args: Record<string, unknown>,
      context: ToolContext,
    ): Promise<ToolResult> => {
      return new Promise((resolve) => {
        (async () => {
          // Input validation
          const description = args.description as string;
          const prompt = args.prompt as string;
          const subagent_type = args.subagent_type as string;
          const run_in_background = args.run_in_background as boolean;

          if (!description || typeof description !== "string") {
            return resolve({
              success: false,
              content: "",
              error: "description parameter is required and must be a string",
              shortResult: "Task delegation failed",
            });
          }

          if (!prompt || typeof prompt !== "string") {
            return resolve({
              success: false,
              content: "",
              error: "prompt parameter is required and must be a string",
              shortResult: "Task delegation failed",
            });
          }

          if (!subagent_type || typeof subagent_type !== "string") {
            return resolve({
              success: false,
              content: "",
              error: "subagent_type parameter is required and must be a string",
              shortResult: "Task delegation failed",
            });
          }

          try {
            // Subagent selection logic with explicit name matching only
            const configuration =
              await subagentManager.findSubagent(subagent_type);

            if (!configuration) {
              // Error handling for nonexistent subagents with available subagents listing
              const allConfigs = subagentManager.getConfigurations();
              const availableNames = allConfigs.map((c) => c.name).join(", ");

              return resolve({
                success: false,
                content: "",
                error: `No subagent found matching "${subagent_type}". Available subagents: ${availableNames || "none"}`,
                shortResult: "Subagent not found",
              });
            }

            // Set up callback to update shortResult with message count and tokens
            const updateShortResult = () => {
              const messages = instance.messageManager.getMessages();
              const tokens = instance.messageManager.getlatestTotalTokens();
              let shortResult = `${messages.length} msgs`;
              if (tokens > 0) {
                shortResult += ` | ${tokens.toLocaleString()} tokens`;
              }
              context.onShortResultUpdate?.(shortResult);
            };

            // Create subagent instance and execute task
            const instance = await subagentManager.createInstance(
              configuration,
              {
                description,
                prompt,
                subagent_type,
              },
              run_in_background,
              updateShortResult,
            );

            // Initial update
            updateShortResult();

            let isBackgrounded = false;

            // Register for backgrounding if not already in background
            if (!run_in_background && context.foregroundTaskManager) {
              context.foregroundTaskManager.registerForegroundTask({
                id: instance.subagentId,
                backgroundHandler: async () => {
                  isBackgrounded = true;
                  const taskId = await subagentManager.backgroundInstance(
                    instance.subagentId,
                  );
                  // Resolve the tool execution early so the main agent can continue
                  resolve({
                    success: true,
                    content: `Task moved to background with ID: ${taskId}.`,
                    shortResult: "Task backgrounded",
                    isManuallyBackgrounded: true,
                  });
                },
              });
            }

            try {
              const result = await subagentManager.executeTask(
                instance,
                prompt,
                context.abortSignal,
                run_in_background,
              );

              if (isBackgrounded) return;

              if (run_in_background) {
                return resolve({
                  success: true,
                  content: `Task started in background with ID: ${result}`,
                  shortResult: `Task started in background: ${result}`,
                });
              }

              return resolve({
                success: true,
                content: result,
                shortResult: `Task completed by ${configuration.name}`,
              });
            } finally {
              if (!run_in_background && context.foregroundTaskManager) {
                context.foregroundTaskManager.unregisterForegroundTask(
                  instance.subagentId,
                );
              }
            }
          } catch (error) {
            return resolve({
              success: false,
              content: "",
              error: `Task delegation failed: ${error instanceof Error ? error.message : String(error)}`,
              shortResult: "Delegation error",
            });
          }
        })();
      });
    },

    formatCompactParams: (params: Record<string, unknown>) => {
      const subagent_type = params.subagent_type as string;
      const description = params.description as string;
      return `${subagent_type || "unknown"}: ${description || "no description"}`;
    },
  };
}
