/**
 * Permission Manager Interface
 * 
 * Defines helper utilities for permission checking that tools can use
 * within their execute methods after validation/diff but before real operations.
 */

import type { 
  PermissionDecision, 
  ToolPermissionContext,
  PermissionCallback 
} from "./permissions.js";

/**
 * Options for creating a PermissionManager instance
 */
export interface PermissionManagerOptions {
  /** Logger for debugging permission decisions */
  logger?: Logger;
}

/**
 * Helper interface for permission utilities used by individual tools
 */
export interface IPermissionManager {
  /**
   * Check if a tool execution requires permission and handle the authorization flow
   * Called by individual tools after validation/diff, before real operation
   * 
   * @param context - Context containing tool name, mode, and callback
   * @returns Promise resolving to permission decision
   * @throws Error if permission callback fails
   */
  checkPermission(context: ToolPermissionContext): Promise<PermissionDecision>;
  
  /**
   * Determine if a tool requires permission checks based on its name
   * 
   * @param toolName - Name of the tool to check
   * @returns true if tool is restricted and requires permission
   */
  isRestrictedTool(toolName: string): boolean;
  
  /**
   * Helper method to create a permission context for CLI integration
   * 
   * @param toolName - Name of the tool
   * @param permissionMode - Current permission mode
   * @param callback - Optional permission callback
   * @returns ToolPermissionContext object
   */
  createContext(
    toolName: string, 
    permissionMode: PermissionMode, 
    callback?: PermissionCallback
  ): ToolPermissionContext;
}