/**
 * Permission System Type Definitions
 * 
 * This file defines the TypeScript interfaces and types for the tool permission system.
 * These contracts define the API between different components of the system.
 */

/**
 * Permission mode configuration
 * - "default": Prompt for confirmation on restricted tools
 * - "bypassPermissions": Execute all tools without confirmation
 */
export type PermissionMode = "default" | "bypassPermissions";

/**
 * Result of a permission check
 */
export interface PermissionDecision {
  /** Whether to allow or deny the operation */
  behavior: "allow" | "deny";
  /** Optional message explaining the decision (required for deny) */
  message?: string;
}

/**
 * Callback function for custom permission logic
 * @param toolName - Name of the tool requesting permission
 * @returns Promise resolving to permission decision
 */
export type PermissionCallback = (
  toolName: string,
) => Promise<PermissionDecision>;

/**
 * Extended AgentOptions interface with permission system support
 */
export interface AgentOptionsWithPermissions {
  /** Permission mode - defaults to "default" */
  permissionMode?: PermissionMode;
  /** Custom permission callback */
  canUseTool?: PermissionCallback;
  // ... other existing AgentOptions fields
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
  /** Called when user makes a decision */
  onDecision: (decision: PermissionDecision) => void;
  /** Called when user cancels (ESC) */
  onCancel: () => void;
}

/**
 * Internal state for confirmation UI
 */
export interface ConfirmationState {
  /** Whether confirmation dialog is visible */
  isVisible: boolean;
  /** Currently selected option */
  selectedOption: "allow" | "alternative";
  /** Text entered for alternative instructions */
  alternativeText: string;
  /** Whether user has started typing (to hide placeholder) */
  hasUserInput: boolean;
  /** Tool name being confirmed */
  toolName: string;
}

/**
 * List of tools that require permission checks in default mode
 */
export const RESTRICTED_TOOLS = ["Edit", "MultiEdit", "Delete", "Bash", "Write"] as const;

/**
 * Type for restricted tool names
 */
export type RestrictedTool = typeof RESTRICTED_TOOLS[number];