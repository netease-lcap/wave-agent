/**
 * Permission System Type Definitions
 * 
 * This file defines the TypeScript interfaces and types for the tool permission system.
 * These contracts define the API between different components of the system.
 */

/**
 * Permission mode configuration
 * - "default": Prompt for confirmation on restricted tools
 * - "acceptEdits": Automatically accept file modifications
 * - "plan": Plan mode for the agent
 * - "bypassPermissions": Execute all tools without confirmation
 * - "dontAsk": Auto-deny restricted tools not in allow list
 */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions" | "dontAsk";

/**
 * Result of a permission check
 */
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

/**
 * Callback function for custom permission logic
 * @param context - Tool permission context
 * @returns Promise resolving to permission decision
 */
export type PermissionCallback = (
  context: ToolPermissionContext,
) => Promise<PermissionDecision>;

/**
 * Extended AgentOptions interface with permission system support
 */
export interface AgentOptionsWithPermissions {
  /** Permission mode - defaults to "default" */
  permissionMode?: PermissionMode;
  /** Custom permission callback */
  canUseTool?: PermissionCallback;
  /** Instance-specific allowed rules */
  allowedTools?: string[];
  /** Instance-specific denied rules */
  disallowedTools?: string[];
}

/**
 * Internal context passed to PermissionManager
 */
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
  /** Whether to hide the persistent permission option in the UI */
  hidePersistentOption?: boolean;
}

/**
 * Configuration for CLI permission handling
 */
export interface CLIPermissionConfig {
  /** Whether permissions are bypassed via CLI flag */
  bypassPermissions: boolean;
}

/**
 * Props for the confirmation component
 */
export interface ConfirmationProps {
  /** Name of the tool requesting permission */
  toolName: string;
  /** Tool input parameters */
  toolInput?: Record<string, unknown>;
  /** Called when user makes a decision */
  onDecision: (decision: PermissionDecision) => void;
  /** Called when user cancels (ESC) */
  onCancel: () => void;
  /** Called when user aborts the session */
  onAbort: () => void;
}

/**
 * Internal state for confirmation UI
 */
export interface ConfirmationState {
  /** Whether confirmation dialog is visible */
  isVisible: boolean;
  /** Currently selected option */
  selectedOption: "allow" | "alternative" | "smartWildcard" | "autoAcceptEdits" | "dontAskAgain";
  /** Text entered for alternative instructions */
  alternativeText: string;
  /** Whether user has started typing (to hide placeholder) */
  hasUserInput: boolean;
  /** Tool name being confirmed */
  toolName: string;
  /** Suggested pattern for smart wildcard */
  suggestedPattern?: string;
}

/**
 * List of tools that require permission checks in default mode
 */
export const RESTRICTED_TOOLS = ["Edit", "Bash", "Write", "Delete", "mkdir"] as const;

/**
 * Type for restricted tool names
 */
export type RestrictedTool = typeof RESTRICTED_TOOLS[number];
