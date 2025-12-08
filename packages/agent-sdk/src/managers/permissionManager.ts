/**
 * Permission Manager for handling tool permission checks
 *
 * This manager provides utilities for checking permissions before tool execution.
 * It implements the permission logic for different modes (default vs bypass) and
 * handles custom callback integration.
 */

import type {
  PermissionDecision,
  ToolPermissionContext,
  PermissionCallback,
  PermissionMode,
} from "../types/permissions.js";
import { RESTRICTED_TOOLS } from "../types/permissions.js";
import type { Logger } from "../types/index.js";

export interface PermissionManagerOptions {
  /** Logger for debugging permission decisions */
  logger?: Logger;
}

export class PermissionManager {
  private logger?: Logger;

  constructor(options: PermissionManagerOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Check if a tool execution requires permission and handle the authorization flow
   * Called by individual tools after validation/diff, before real operation
   */
  async checkPermission(
    context: ToolPermissionContext,
  ): Promise<PermissionDecision> {
    this.logger?.debug("Checking permission for tool", {
      toolName: context.toolName,
      permissionMode: context.permissionMode,
      hasCallback: !!context.canUseToolCallback,
    });

    // 1. If bypassPermissions mode, always allow
    if (context.permissionMode === "bypassPermissions") {
      this.logger?.debug("Permission bypassed for tool", {
        toolName: context.toolName,
      });
      return { behavior: "allow" };
    }

    // 2. If not a restricted tool, always allow
    if (!this.isRestrictedTool(context.toolName)) {
      this.logger?.debug("Tool is not restricted, allowing", {
        toolName: context.toolName,
      });
      return { behavior: "allow" };
    }

    // 3. If custom callback provided, call it and return result
    if (context.canUseToolCallback) {
      try {
        this.logger?.debug("Calling custom permission callback for tool", {
          toolName: context.toolName,
        });
        const decision = await context.canUseToolCallback(context.toolName);
        this.logger?.debug("Custom callback returned decision", {
          toolName: context.toolName,
          decision,
        });
        return decision;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger?.error("Error in permission callback", {
          toolName: context.toolName,
          error: errorMessage,
        });
        return {
          behavior: "deny",
          message: "Error in permission callback",
        };
      }
    }

    // 4. For default mode on restricted tools without callback, integrate with CLI confirmation
    // Note: CLI confirmation integration will be implemented in Phase 2
    this.logger?.warn(
      "No permission callback provided for restricted tool in default mode",
      {
        toolName: context.toolName,
      },
    );
    return {
      behavior: "deny",
      message: `Tool '${context.toolName}' requires permission approval. No permission callback configured.`,
    };
  }

  /**
   * Determine if a tool requires permission checks based on its name
   */
  isRestrictedTool(toolName: string): boolean {
    const isRestricted = (RESTRICTED_TOOLS as readonly string[]).includes(
      toolName,
    );
    this.logger?.debug("Checking if tool is restricted", {
      toolName,
      isRestricted,
    });
    return isRestricted;
  }

  /**
   * Helper method to create a permission context for CLI integration
   */
  createContext(
    toolName: string,
    permissionMode: PermissionMode,
    callback?: PermissionCallback,
  ): ToolPermissionContext {
    const context: ToolPermissionContext = {
      toolName,
      permissionMode,
      canUseToolCallback: callback,
    };

    this.logger?.debug("Created permission context", {
      toolName,
      permissionMode,
      hasCallback: !!callback,
    });

    return context;
  }
}
