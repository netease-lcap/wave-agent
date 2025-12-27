/**
 * Permission system types for Wave Agent SDK
 * Dependencies: None
 */

/** Permission mode configuration */
export type PermissionMode = "default" | "bypassPermissions" | "acceptEdits";

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
}

/** List of tools that require permission checks in default mode */
export const RESTRICTED_TOOLS = [
  "Edit",
  "MultiEdit",
  "Delete",
  "Bash",
  "Write",
] as const;

/** Type for restricted tool names */
export type RestrictedTool = (typeof RESTRICTED_TOOLS)[number];
