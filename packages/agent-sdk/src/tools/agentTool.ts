import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { EXPLORE_SUBAGENT_TYPE } from "../constants/subagents.js";
import { AGENT_TOOL_NAME } from "../constants/tools.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import {
  countToolBlocks,
  formatToolTokenSummary,
} from "../utils/messageOperations.js";

/**
 * Agent tool plugin for launching specialized agents to handle complex tasks
 */
export const agentTool: ToolPlugin = {
  name: AGENT_TOOL_NAME,
  config: {
    type: "function" as const,
    function: {
      name: AGENT_TOOL_NAME,
      description:
        "Launch a new agent to handle complex, multi-step tasks autonomously.",
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
              "Set to true to run this command in the background. Use Read to read the output later.",
          },
        },
        required: ["description", "prompt", "subagent_type"],
      },
    },
  },

  prompt: (args?: { availableSubagents?: SubagentConfiguration[] }) => {
    const subagentList = args?.availableSubagents
      ? args.availableSubagents
          .map((config) => {
            let toolsStr = "";
            if (config.tools && config.tools.length > 0) {
              toolsStr = ` (Tools: ${config.tools.join(", ")})`;
            } else {
              toolsStr = " (Tools: *)";
            }

            return `- ${config.name}: ${config.description}${toolsStr}`;
          })
          .join("\n")
      : "";

    return `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${subagentList || "No agents configured"}

When using the Agent tool, you must specify a subagent_type parameter to select which agent type to use from the list above. Choose the agent whose description best matches the task you want to delegate.

- When doing file search, prefer to use the ${AGENT_TOOL_NAME} tool in order to reduce context usage.
- You should proactively use the ${AGENT_TOOL_NAME} tool with specialized agents when the task at hand matches the agent's description.
- VERY IMPORTANT: When exploring the codebase to gather context or to answer a question that is not a needle query for a specific file/class/function, it is CRITICAL that you use the ${AGENT_TOOL_NAME} tool with subagent_type=${EXPLORE_SUBAGENT_TYPE} instead of running search commands directly.
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
- **Don't peek.** The tool result includes an output file path — do not Read or tail it unless the user explicitly asks for a progress check. You get a completion notification; trust it. Reading the transcript mid-flight pulls the agent's tool noise into your context, which defeats the point of backgrounding.
- **Don't race.** After launching, you know nothing about what the agent found. Never fabricate or predict agent results in any format — not as prose, summary, or structured output. The notification arrives as a user-role message in a later turn; it is never something you write yourself. If the user asks a follow-up before the notification lands, tell them the agent is still running — give status, not a guess.`;
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
        shortResult: "Agent delegation failed",
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
        shortResult: "Agent delegation failed",
      };
    }

    if (!prompt || typeof prompt !== "string") {
      return {
        success: false,
        content: "",
        error: "prompt parameter is required and must be a string",
        shortResult: "Agent delegation failed",
      };
    }

    if (!subagent_type || typeof subagent_type !== "string") {
      return {
        success: false,
        content: "",
        error: "subagent_type parameter is required and must be a string",
        shortResult: "Agent delegation failed",
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
          error: `No agent found matching "${subagent_type}". Available agents: ${availableNames || "none"}`,
          shortResult: "Agent not found",
        };
      }

      let isBackgrounded = false;

      // Create subagent instance and execute agent
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
          const tokens = instance.messageManager.getLatestTotalTokens();
          const usedTools = instance.usedTools;

          const toolCount = countToolBlocks(messages);
          const summary = formatToolTokenSummary(toolCount, tokens);

          const getDisplayParam = (t: {
            name: string;
            parameters: string;
            compactParams?: string;
            stage?: string;
          }) => {
            if (
              (t.stage === "end" || t.stage === "running") &&
              t.compactParams
            ) {
              return t.compactParams;
            }
            const flat = t.parameters.replace(/\n/g, "\\n");
            return flat.length > 30 ? `…${flat.slice(-30)}` : flat;
          };

          let shortResult = "";
          if (toolCount > 2) {
            shortResult += "... ";
          }
          shortResult += summary;
          if (usedTools.length > 0) {
            shortResult +=
              "\n" +
              usedTools
                .map((t) => `${t.name} ${getDisplayParam(t)}`)
                .join("\n");
          }

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
                const taskId = await subagentManager.backgroundInstance(
                  instance.subagentId,
                );
                const task = context.backgroundTaskManager?.getTask(taskId);
                const outputPath = task?.outputPath;
                resolve({
                  success: true,
                  content: `Agent backgrounded with ID: ${taskId}.${outputPath ? ` Real-time output: ${outputPath}` : ""}`,
                  shortResult: "Agent backgrounded",
                  isManuallyBackgrounded: true,
                });
              },
            });
          }

          try {
            const result = await subagentManager.executeAgent(
              instance,
              prompt,
              context.abortSignal,
              run_in_background,
            );

            if (isBackgrounded) {
              return;
            }

            if (run_in_background) {
              const task = context.backgroundTaskManager?.getTask(result);
              const outputPath = task?.outputPath;
              const backgroundMsg = [
                `Agent started in background with ID: ${result}.`,
                `The agent is working in the background. You will be notified automatically when it completes.`,
                `Do not duplicate this agent's work — avoid working with the same files or topics it is using.`,
                outputPath
                  ? `output_file: ${outputPath}`
                  : `Briefly tell the user what you launched and end your response.`,
              ].join("\n");
              resolve({
                success: true,
                content: backgroundMsg,
                shortResult: `Agent started in background: ${result}`,
              });
              return;
            }

            // Cleanup subagent instance after agent completion
            subagentManager.cleanupInstance(instance.subagentId);

            const messages = instance.messageManager.getMessages();
            const tokens = instance.messageManager.getLatestTotalTokens();
            const toolCount = countToolBlocks(messages);
            const summary = formatToolTokenSummary(toolCount, tokens);

            resolve({
              success: true,
              content: result,
              shortResult: `Agent completed${summary ? ` ${summary}` : ""}`,
            });
          } catch (error) {
            if (!isBackgrounded) {
              resolve({
                success: false,
                content: "",
                error: `Agent delegation failed: ${error instanceof Error ? error.message : String(error)}`,
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
        error: `Agent delegation failed: ${error instanceof Error ? error.message : String(error)}`,
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
