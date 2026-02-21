import { readFile } from "fs/promises";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { EXIT_PLAN_MODE_TOOL_NAME } from "../constants/tools.js";

/**
 * Exit Plan Mode Tool Plugin
 */
export const exitPlanModeTool: ToolPlugin = {
  name: EXIT_PLAN_MODE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: EXIT_PLAN_MODE_TOOL_NAME,
      description: "Prompts the user to exit plan mode and start coding",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  prompt:
    () => `Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.
`,
  execute: async (
    _args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    try {
      if (!context.permissionManager) {
        return {
          success: false,
          content: "",
          error: "Permission manager is not available",
        };
      }

      const planFilePath = context.permissionManager.getPlanFilePath();
      if (!planFilePath) {
        return {
          success: false,
          content: "",
          error: "Plan file path is not set",
        };
      }

      let planContent = "";
      try {
        planContent = await readFile(planFilePath, "utf-8");
      } catch (error) {
        return {
          success: false,
          content: "",
          error: `Failed to read plan file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // Permission check triggers the 3-option UI
      const permissionContext = context.permissionManager.createContext(
        EXIT_PLAN_MODE_TOOL_NAME,
        context.permissionMode || "plan",
        context.canUseToolCallback,
        { plan_content: planContent },
      );

      const permissionResult =
        await context.permissionManager.checkPermission(permissionContext);

      if (permissionResult.behavior === "deny") {
        return {
          success: false,
          content: `User feedback: ${permissionResult.message || "Plan rejected by user"}. Please update your proposal accordingly.`,
          error: permissionResult.message ? undefined : "Plan rejected by user",
        };
      }

      return {
        success: true,
        content: "Plan approved. Exiting plan mode.",
        shortResult: "Plan approved",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`ExitPlanMode tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};
