/**
 * CLI Integration Contracts
 * 
 * Defines interfaces for integrating permission system with the CLI application.
 */

import type { PermissionDecision } from "./permissions.js";

/**
 * Extended CLI options with permission flag
 */
export interface CLIOptionsWithPermissions {
  /** Skip permission checks - dangerous mode */
  dangerouslySkipPermissions?: boolean;
  // ... other existing CLI options
}

/**
 * Extended Chat Context with permission confirmation state
 */
export interface ChatContextWithPermissions {
  // ... existing ChatContextType fields
  
  /** Whether confirmation dialog is currently shown */
  isConfirmationVisible: boolean;
  /** Tool name being confirmed */
  confirmingTool?: string;
  /** Show confirmation for a tool (hides InputBox) */
  showConfirmation: (toolName: string) => Promise<PermissionDecision>;
  /** Hide confirmation dialog (shows InputBox) */
  hideConfirmation: () => void;
  /** Handle user decision */
  handleConfirmationDecision: (decision: PermissionDecision) => void;
  /** Handle user cancellation (ESC - shows InputBox) */
  handleConfirmationCancel: () => void;
}

/**
 * ChatInterface component props (no changes needed)
 * Uses confirmation state from useChat context
 */
export interface ChatInterfaceProps {
  // No additional props needed - all state comes from context
}

/**
 * Hook interface for managing confirmation state
 */
export interface UseConfirmationHook {
  /** Current confirmation state */
  isConfirming: boolean;
  /** Tool name being confirmed */
  confirmingTool?: string;
  /** Show confirmation for a tool (hides InputBox) */
  showConfirmation: (toolName: string) => Promise<PermissionDecision>;
  /** Hide confirmation dialog (shows InputBox) */
  hideConfirmation: () => void;
  /** Handle user decision */
  handleDecision: (decision: PermissionDecision) => void;
  /** Handle user cancellation (ESC - shows InputBox) */
  handleCancel: () => void;
}

/**
 * Context for permission system in React components
 */
export interface PermissionContext {
  /** Whether permissions are bypassed */
  bypassPermissions: boolean;
  /** Request permission for a tool */
  requestPermission: (toolName: string) => Promise<PermissionDecision>;
}

/**
 * CLI command configuration for permission flag
 */
export interface YargsPermissionConfig {
  option: "dangerously-skip-permissions";
  description: "Skip all permission checks (dangerous)";
  type: "boolean";
  default: false;
}