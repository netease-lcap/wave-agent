/**
 * Permission system types for Wave Agent SDK
 * Dependencies: None
 */

import {
  AskUserQuestion,
  AskUserQuestionInput,
  AskUserQuestionOption,
} from "./tools.js";
import {
  EDIT_TOOL_NAME,
  BASH_TOOL_NAME,
  WRITE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  ARTIFACT_TOOL_NAME,
} from "../constants/tools.js";

/** Permission mode configuration */
export type PermissionMode =
  | "default"
  | "bypassPermissions"
  | "acceptEdits"
  | "plan"
  | "dontAsk";

/** Result of a permission check */
export interface PermissionDecision {
  /** Whether to allow or deny the operation */
  behavior: "allow" | "deny";
  /** Optional message explaining the decision (required for deny) */
  message?: string;
  /** Signal to change the session's permission mode */
  newPermissionMode?: PermissionMode;
  /** Signal to persist a new allowed rule */
  newPermissionRule?: string;
  /** Signal to add a directory to this session's Safe Zone (not persisted) */
  newAdditionalDirectory?: string;
}

/** Callback function for custom permission logic */
export type PermissionCallback = (
  context: ToolPermissionContext,
) => Promise<PermissionDecision>;

/** Internal context passed to PermissionManager */
export interface ToolPermissionContext {
  /** Name of the tool being executed */
  toolName: string;
  /** Current permission mode */
  permissionMode: PermissionMode;
  /** Custom permission callback if provided */
  canUseToolCallback?: PermissionCallback;
  /** Tool input parameters for better context */
  toolInput?: Record<string, unknown>;
  /** Suggested prefix for bash commands */
  suggestedPrefix?: string;
  /** Whether to hide the persistent permission option (e.g., "Don't ask again") in the UI */
  hidePersistentOption?: boolean;
  /**
   * Absolute path of the directory holding an out-of-Safe-Zone target, set for
   * Edit/Write when the target lies outside the Safe Zone. Lets the confirmation
   * UI offer adding that directory to the session Safe Zone.
   */
  outsideSafeZoneDirectory?: string;
  /** The ID of the tool call that triggered this permission request */
  toolCallId?: string;
  /** The content of the plan being exited from */
  planContent?: string;
  /** Optional warning line to surface in the confirmation UI (e.g. shared-live redeploy impact) */
  warning?: string;
}

/** List of tools that require permission checks in default mode */
export const RESTRICTED_TOOLS = [
  EDIT_TOOL_NAME,
  BASH_TOOL_NAME,
  WRITE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  ARTIFACT_TOOL_NAME,
] as const;

/**
 * Tools that must still reach the user when permission checks are bypassed
 * (`bypassPermissions` mode, or `plan` mode in a session holding the bypass
 * authorization) — aligned with Claude Code's `requiresUserInteraction`:
 * its permission pipeline returns the tool's own ask result before the
 * bypass step can allow it.
 *
 * - `AskUserQuestion`: the tool *is* the question; bypassing it would strand
 *   the agent without an answer.
 * - `ExitPlanMode`: leaving plan mode is the user's approval of the plan, so
 *   it stays a user decision even in a "don't ask me" session. This is the
 *   one remaining gate on plan mode for such sessions (see plan-mode.md).
 */
export const USER_INTERACTION_REQUIRED_TOOLS = [
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
] as const;

/** Type for restricted tool names */
export type RestrictedTool = (typeof RESTRICTED_TOOLS)[number];

export const OPERATION_CANCELLED_BY_USER = "Operation cancelled by user";

export type { AskUserQuestion, AskUserQuestionInput, AskUserQuestionOption };
