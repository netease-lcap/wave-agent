import { readFile } from "fs/promises";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";

/**
 * Exit Plan Mode Tool Plugin
 */
export const exitPlanModeTool: ToolPlugin = {
  name: "ExitPlanMode",
  config: {
    type: "function",
    function: {
      name: "ExitPlanMode",
      description:
        "Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval. This tool will read the plan from the file specified in the system message and present it to the user for confirmation. You should have already written your plan to that file before calling this tool.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
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
        "ExitPlanMode",
        context.permissionMode || "plan",
        context.canUseToolCallback,
        { plan_content: planContent },
      );

      const permissionResult =
        await context.permissionManager.checkPermission(permissionContext);

      if (permissionResult.behavior === "deny") {
        return {
          success: false,
          content: permissionResult.message || "Plan rejected by user",
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
