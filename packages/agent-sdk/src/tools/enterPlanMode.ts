import { ENTER_PLAN_MODE_TOOL_NAME } from "../constants/tools.js";
import type { ToolPlugin } from "./types.js";

/**
 * Tool to enter plan mode
 */
export const enterPlanModeTool: ToolPlugin = {
  name: ENTER_PLAN_MODE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: ENTER_PLAN_MODE_TOOL_NAME,
      description:
        "Requests permission to enter plan mode for complex tasks requiring exploration and design. Use this proactively for non-trivial implementation (new features, architectural changes) to ensure user alignment before writing code.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  execute: async (_args, context) => {
    if (!context.permissionManager) {
      return {
        success: false,
        error: "Permission manager is not available",
        content: "",
      };
    }

    context.permissionManager.updateConfiguredDefaultMode("plan");

    return {
      success: true,
      content: "Entered plan mode. Please write your plan to the file.",
    };
  },
};
