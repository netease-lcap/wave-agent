import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { EXPLORE_SUBAGENT_TYPE } from "../constants/subagents.js";
import { TASK_TOOL_NAME } from "../constants/tools.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import {
  countToolBlocks,
  formatToolTokenSummary,
} from "../utils/messageOperations.js";

/**
 * Task tool plugin for delegating tasks to specialized subagents
 */
export const taskTool: ToolPlugin = {
  name: TASK_TOOL_NAME,
  config: {
    type: "function" as const,
    function: {
      name: TASK_TOOL_NAME,
      description:
        "Delegate a task to a specialized subagent. Use this when you need specialized expertise or want to break down complex work into focused subtasks.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "A short (3-5 word) description of the task",
          },
          prompt: {
            type: "string",
            description: "The task for the agent to perform",
          },
          subagent_type: {
            type: "string",
            description: "The type of specialized agent to use for this task",
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
  },

  prompt: (args?: { availableSubagents?: SubagentConfiguration[] }) => {
    const subagentList = args?.availableSubagents
      ? args.availableSubagents
          .map((config) => `- ${config.name}: ${config.description}`)
          .join("\n")
      : "";

    return `
Delegate a task to a specialized subagent. Use this when you need specialized expertise or want to break down complex work into focused subtasks.

Available subagents:
${subagentList || "No subagents configured"}

- When doing file search, prefer to use the ${TASK_TOOL_NAME} tool in order to reduce context usage.
- You should proactively use the ${TASK_TOOL_NAME} tool with specialized agents when the task at hand matches the agent's description.
- VERY IMPORTANT: When exploring the codebase to gather context or to answer a question that is not a needle query for a specific file/class/function, it is CRITICAL that you use the ${TASK_TOOL_NAME} tool with subagent_type=${EXPLORE_SUBAGENT_TYPE} instead of running search commands directly.`;
  },

  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const subagentManager = context.subagentManager;
    if (!subagentManager) {
      return {
        success: false,
        content: "",
        error: "Subagent manager not available in tool context",
        shortResult: "Task delegation failed",
      };
    }

    // Input validation
    const description = args.description as string;
    const prompt = args.prompt as string;
    const subagent_type = args.subagent_type as string;
    const run_in_background = args.run_in_background as boolean;

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

      let isBackgrounded = false;

      // Create subagent instance and execute task
      const instance = await subagentManager.createInstance(
        configuration,
        {
          description,
          prompt,
          subagent_type,
        },
        run_in_background,
        () => {
          // Do not update shortResult if it is running in background
          if (run_in_background || isBackgrounded) return;

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

      return new Promise<ToolResult>((resolve) => {
        (async () => {
          // Register for backgrounding if not already in background
          if (!run_in_background && context.foregroundTaskManager) {
            context.foregroundTaskManager.registerForegroundTask({
              id: instance.subagentId,
              backgroundHandler: async () => {
                isBackgrounded = true;
                await subagentManager.backgroundInstance(instance.subagentId);
                resolve({
                  success: true,
                  content: "Task backgrounded",
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

            if (isBackgrounded) {
              return;
            }

            if (run_in_background) {
              resolve({
                success: true,
                content: `Task started in background with ID: ${result}`,
                shortResult: `Task started in background: ${result}`,
              });
              return;
            }

            // Cleanup subagent instance after task completion
            subagentManager.cleanupInstance(instance.subagentId);

            const messages = instance.messageManager.getMessages();
            const tokens = instance.messageManager.getlatestTotalTokens();
            const toolCount = countToolBlocks(messages);
            const summary = formatToolTokenSummary(toolCount, tokens);

            resolve({
              success: true,
              content: result,
              shortResult: `Task completed${summary ? ` ${summary}` : ""}`,
            });
          } catch (error) {
            if (!isBackgrounded) {
              resolve({
                success: false,
                content: "",
                error: `Task delegation failed: ${error instanceof Error ? error.message : String(error)}`,
                shortResult: "Delegation error",
              });
            }
          } finally {
            if (!run_in_background && context.foregroundTaskManager) {
              context.foregroundTaskManager.unregisterForegroundTask(
                instance.subagentId,
              );
            }
          }
        })();
      });
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
