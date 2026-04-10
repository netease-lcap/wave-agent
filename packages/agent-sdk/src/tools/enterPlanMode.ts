import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { ENTER_PLAN_MODE_TOOL_NAME } from "../constants/tools.js";
import { OPERATION_CANCELLED_BY_USER } from "../types/permissions.js";

/**
 * Enter Plan Mode Tool Plugin
 */
export const enterPlanModeTool: ToolPlugin = {
  name: ENTER_PLAN_MODE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: ENTER_PLAN_MODE_TOOL_NAME,
      description:
        "Request to enter plan mode for complex tasks requiring user approval before coding",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  prompt:
    () => `Use this tool to proactively request entering plan mode when a task is non-trivial and benefits from planning before implementation.

## When to Use This Tool
- Multi-file changes or refactoring that requires architectural decisions
- New features with multiple implementation steps or design trade-offs
- Tasks where you want user approval on approach before writing code
- Complex bug fixes that span multiple components

## When NOT to Use This Tool
- Simple fixes (typos, small logic changes in a single file)
- Research tasks (searching files, reading code, gathering information)
- Tasks where the implementation approach is straightforward and unambiguous
- When already in plan mode

## Examples

1. Task: "Refactor the authentication system to use OAuth2" - Use EnterPlanMode to propose an approach before implementation.
2. Task: "Add input validation to the login form" - Do NOT use EnterPlanMode, just implement it.
3. Task: "Migrate the database schema to support multi-tenancy" - Use EnterPlanMode to plan the migration steps.
4. Task: "Fix the off-by-one error in the pagination logic" - Do NOT use EnterPlanMode, just fix the bug.
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

      const permissionContext = context.permissionManager.createContext(
        ENTER_PLAN_MODE_TOOL_NAME,
        context.permissionMode || "default",
        context.canUseToolCallback,
        {},
        context.toolCallId,
      );

      const permissionResult =
        await context.permissionManager.checkPermission(permissionContext);

      if (permissionResult.behavior === "deny") {
        if (permissionResult.message === OPERATION_CANCELLED_BY_USER) {
          return {
            success: false,
            content: OPERATION_CANCELLED_BY_USER,
          };
        }
        return {
          success: false,
          content: `User declined to enter plan mode. Proceed in current mode.`,
          error: permissionResult.message
            ? undefined
            : "Operation declined by user",
        };
      }

      return {
        success: true,
        content:
          "Plan mode entered successfully. Please write your plan to the plan file and use ExitPlanMode when ready for approval.",
        shortResult: "Plan mode entered",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`EnterPlanMode tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};
