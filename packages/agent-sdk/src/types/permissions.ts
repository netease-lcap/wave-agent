/**
 * Permission system types for Wave Agent SDK
 * Dependencies: None
 */

/** Permission mode configuration */
export type PermissionMode = "default" | "bypassPermissions";

/** Result of a permission check */
export interface PermissionDecision {
  /** Whether to allow or deny the operation */
  behavior: "allow" | "deny";
  /** Optional message explaining the decision (required for deny) */
  message?: string;
}

/** Callback function for custom permission logic */
export type PermissionCallback = (
  toolName: string,
) => Promise<PermissionDecision>;

/** Internal context passed to PermissionManager */
export interface ToolPermissionContext {
  /** Name of the tool being executed */
  toolName: string;
  /** Current permission mode */
  permissionMode: PermissionMode;
  /** Custom permission callback if provided */
  canUseToolCallback?: PermissionCallback;
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
