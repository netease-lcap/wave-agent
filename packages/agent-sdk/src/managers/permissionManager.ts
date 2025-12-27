/**
 * Permission Manager for handling tool permission checks
 *
 * This manager provides utilities for checking permissions before tool execution.
 * It implements the permission logic for different modes (default vs bypass) and
 * handles custom callback integration.
 */

import path from "node:path";
import type {
  PermissionDecision,
  ToolPermissionContext,
  PermissionCallback,
  PermissionMode,
} from "../types/permissions.js";
import { RESTRICTED_TOOLS } from "../types/permissions.js";
import type { Logger } from "../types/index.js";
import {
  splitBashCommand,
  stripEnvVars,
  stripRedirections,
  getSmartPrefix,
  DANGEROUS_COMMANDS,
} from "../utils/bashParser.js";
import { isPathInside } from "../utils/pathSafety.js";

const SAFE_COMMANDS = ["cd", "ls", "pwd"];

export interface PermissionManagerOptions {
  /** Logger for debugging permission decisions */
  logger?: Logger;
  /** Configured default permission mode from settings */
  configuredDefaultMode?: PermissionMode;
  /** Allowed rules from settings */
  allowedRules?: string[];
}

export class PermissionManager {
  private logger?: Logger;
  private configuredDefaultMode?: PermissionMode;
  private allowedRules: string[] = [];
  private onConfiguredDefaultModeChange?: (mode: PermissionMode) => void;

  constructor(options: PermissionManagerOptions = {}) {
    this.logger = options.logger;
    this.configuredDefaultMode = options.configuredDefaultMode;
    this.allowedRules = options.allowedRules || [];
  }

  /**
   * Set a callback to be notified when the effective permission mode changes due to configuration updates
   */
  public setOnConfiguredDefaultModeChange(
    callback: (mode: PermissionMode) => void,
  ): void {
    this.onConfiguredDefaultModeChange = callback;
  }

  /**
   * Update the configured default mode (e.g., when configuration reloads)
   */
  updateConfiguredDefaultMode(defaultMode?: PermissionMode): void {
    const oldEffectiveMode = this.getCurrentEffectiveMode();

    this.logger?.debug("Updating configured default permission mode", {
      previous: this.configuredDefaultMode,
      new: defaultMode,
    });
    this.configuredDefaultMode = defaultMode;

    const newEffectiveMode = this.getCurrentEffectiveMode();
    if (
      oldEffectiveMode !== newEffectiveMode &&
      this.onConfiguredDefaultModeChange
    ) {
      this.logger?.debug(
        "Effective permission mode changed due to configuration update",
        {
          oldMode: oldEffectiveMode,
          newMode: newEffectiveMode,
        },
      );
      this.onConfiguredDefaultModeChange(newEffectiveMode);
    }
  }

  /**
   * Get all currently allowed rules
   */
  public getAllowedRules(): string[] {
    return [...this.allowedRules];
  }

  /**
   * Update the allowed rules (e.g., when configuration reloads)
   */
  updateAllowedRules(rules: string[]): void {
    this.logger?.debug("Updating allowed permission rules", {
      count: rules.length,
    });
    this.allowedRules = rules;
  }

  /**
   * Get the current effective permission mode for tool execution context
   */
  getCurrentEffectiveMode(cliPermissionMode?: PermissionMode): PermissionMode {
    return this.resolveEffectivePermissionMode(cliPermissionMode);
  }

  /**
   * Resolve the effective permission mode based on CLI override and configured default
   */
  resolveEffectivePermissionMode(
    cliPermissionMode?: PermissionMode,
  ): PermissionMode {
    // CLI override takes highest precedence
    if (cliPermissionMode !== undefined) {
      this.logger?.debug("Using CLI permission mode override", {
        cliMode: cliPermissionMode,
        configuredDefault: this.configuredDefaultMode,
      });
      return cliPermissionMode;
    }

    // Use configured default mode if available
    if (this.configuredDefaultMode !== undefined) {
      this.logger?.debug("Using configured default permission mode", {
        configuredDefault: this.configuredDefaultMode,
      });
      return this.configuredDefaultMode;
    }

    // Fall back to system default
    this.logger?.debug("Using system default permission mode");
    return "default";
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

    // 1.1 If acceptEdits mode, allow Edit, MultiEdit, Delete, Write
    if (context.permissionMode === "acceptEdits") {
      const autoAcceptedTools = ["Edit", "MultiEdit", "Delete", "Write"];
      if (autoAcceptedTools.includes(context.toolName)) {
        this.logger?.debug(
          "Permission automatically accepted for tool in acceptEdits mode",
          {
            toolName: context.toolName,
          },
        );
        return { behavior: "allow" };
      }
    }

    // 1.2 Check if tool call matches any allowed rule
    if (this.isAllowedByRule(context)) {
      this.logger?.debug("Permission allowed by persistent rule", {
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
        const decision = await context.canUseToolCallback(context);
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
    toolInput?: Record<string, unknown>,
  ): ToolPermissionContext {
    let suggestedPrefix: string | undefined;
    if (toolName === "Bash" && toolInput?.command) {
      const command = String(toolInput.command);
      const parts = splitBashCommand(command);
      // Only suggest prefix for single commands to avoid confusion with complex chains
      if (parts.length === 1) {
        const processedPart = stripRedirections(stripEnvVars(parts[0]));
        suggestedPrefix = getSmartPrefix(processedPart) ?? undefined;
      }
    }

    const context: ToolPermissionContext = {
      toolName,
      permissionMode,
      canUseToolCallback: callback,
      toolInput,
      suggestedPrefix,
    };

    // Set hidePersistentOption for dangerous or out-of-bounds bash commands
    if (toolName === "Bash" && toolInput?.command) {
      const command = String(toolInput.command);
      const workdir = toolInput.workdir as string | undefined;
      const parts = splitBashCommand(command);

      const isDangerous = parts.some((part) => {
        const processedPart = stripRedirections(stripEnvVars(part));
        const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
        if (commandMatch) {
          const cmd = commandMatch[1];
          const args = commandMatch[2]?.trim() || "";

          // Check blacklist
          if (DANGEROUS_COMMANDS.includes(cmd)) {
            return true;
          }

          // Check out-of-bounds for cd and ls
          if (workdir && (cmd === "cd" || cmd === "ls")) {
            const pathArgs =
              (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                (arg) => !arg.startsWith("-"),
              ) || [];

            return pathArgs.some((pathArg) => {
              const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
              const absolutePath = path.resolve(workdir, cleanPath);
              return !isPathInside(absolutePath, workdir);
            });
          }
        }
        return false;
      });

      if (isDangerous) {
        context.hidePersistentOption = true;
      }
    }

    this.logger?.debug("Created permission context", {
      toolName,
      permissionMode,
      hasCallback: !!callback,
      hasToolInput: !!toolInput,
      suggestedPrefix,
    });

    return context;
  }

  /**
   * Check if a tool call is allowed by persistent rules
   */
  private isAllowedByRule(context: ToolPermissionContext): boolean {
    if (context.toolName === "Bash" && context.toolInput?.command) {
      const command = String(context.toolInput.command);
      const parts = splitBashCommand(command);
      if (parts.length === 0) return false;

      const workdir = context.toolInput?.workdir as string | undefined;

      return parts.every((part) => {
        const processedPart = stripRedirections(stripEnvVars(part));

        // Check for safe commands
        const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
        if (commandMatch) {
          const cmd = commandMatch[1];
          const args = commandMatch[2]?.trim() || "";

          if (SAFE_COMMANDS.includes(cmd)) {
            if (workdir) {
              if (cmd === "pwd") {
                return true;
              }

              // For cd and ls, check paths
              const pathArgs =
                (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                  (arg) => !arg.startsWith("-"),
                ) || [];

              if (pathArgs.length === 0) {
                // cd or ls without arguments operates on current dir (workdir)
                return true;
              }

              const allPathsSafe = pathArgs.every((pathArg) => {
                // Remove quotes if present
                const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
                const absolutePath = path.resolve(workdir, cleanPath);
                return isPathInside(absolutePath, workdir);
              });

              if (allPathsSafe) {
                return true;
              }
            }
          }
        }

        const action = `${context.toolName}(${processedPart})`;
        const allowedByRule = this.allowedRules.some((rule) => {
          if (rule.endsWith(":*)")) {
            const prefix = rule.slice(0, -3);
            return action.startsWith(prefix);
          }
          return action === rule;
        });

        if (allowedByRule) return true;
        return !this.isRestrictedTool(context.toolName);
      });
    }
    // Add other tools if needed in the future
    return false;
  }

  /**
   * Expand a bash command into individual permission rules, filtering out safe commands.
   * Used when saving permissions to the allow list.
   *
   * @param command The full bash command string
   * @param workdir The working directory for path safety checks
   * @returns Array of permission rules in "Bash(cmd)" format
   */
  public expandBashRule(command: string, workdir: string): string[] {
    const parts = splitBashCommand(command);
    const rules: string[] = [];

    for (const part of parts) {
      const processedPart = stripRedirections(stripEnvVars(part));

      // Check for safe commands
      const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
      let isSafe = false;

      if (commandMatch) {
        const cmd = commandMatch[1];
        const args = commandMatch[2]?.trim() || "";

        if (SAFE_COMMANDS.includes(cmd)) {
          if (cmd === "pwd") {
            isSafe = true;
          } else {
            // For cd and ls, check paths
            const pathArgs =
              (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                (arg) => !arg.startsWith("-"),
              ) || [];

            if (pathArgs.length === 0) {
              isSafe = true;
            } else {
              const allPathsSafe = pathArgs.every((pathArg) => {
                const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
                const absolutePath = path.resolve(workdir, cleanPath);
                return isPathInside(absolutePath, workdir);
              });
              if (allPathsSafe) {
                isSafe = true;
              }
            }
          }
        }
      }

      if (!isSafe) {
        // Check if command is dangerous or out-of-bounds
        const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
        if (commandMatch) {
          const cmd = commandMatch[1];
          const args = commandMatch[2]?.trim() || "";

          if (DANGEROUS_COMMANDS.includes(cmd)) {
            continue;
          }

          if (cmd === "cd" || cmd === "ls") {
            const pathArgs =
              (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                (arg) => !arg.startsWith("-"),
              ) || [];

            const isOutOfBounds = pathArgs.some((pathArg) => {
              const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
              const absolutePath = path.resolve(workdir, cleanPath);
              return !isPathInside(absolutePath, workdir);
            });

            if (isOutOfBounds) {
              continue;
            }
          }
        }

        const smartPrefix = getSmartPrefix(processedPart);
        if (smartPrefix) {
          rules.push(`Bash(${smartPrefix}:*)`);
        } else {
          rules.push(`Bash(${processedPart})`);
        }
      }
    }

    return rules;
  }
}
