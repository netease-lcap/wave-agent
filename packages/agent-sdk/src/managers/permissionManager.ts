/**
 * Permission Manager for handling tool permission checks
 *
 * This manager provides utilities for checking permissions before tool execution.
 * It implements the permission logic for different modes (default vs bypass) and
 * handles custom callback integration.
 */

import path from "node:path";
import { minimatch } from "minimatch";
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

const SAFE_COMMANDS = ["cd", "ls", "pwd", "true", "false"];

export interface PermissionManagerOptions {
  /** Logger for debugging permission decisions */
  logger?: Logger;
  /** Configured default permission mode from settings */
  configuredDefaultMode?: PermissionMode;
  /** Allowed rules from settings */
  allowedRules?: string[];
  /** Denied rules from settings */
  deniedRules?: string[];
  /** Additional directories considered part of the Safe Zone */
  additionalDirectories?: string[];
  /** The main working directory */
  workdir?: string;
  /** Path to the current plan file */
  planFilePath?: string;
}

export class PermissionManager {
  private logger?: Logger;
  private configuredDefaultMode?: PermissionMode;
  private allowedRules: string[] = [];
  private deniedRules: string[] = [];
  private temporaryRules: string[] = [];
  private additionalDirectories: string[] = [];
  private workdir?: string;
  private planFilePath?: string;
  private onConfiguredDefaultModeChange?: (mode: PermissionMode) => void;

  constructor(options: PermissionManagerOptions = {}) {
    this.logger = options.logger;
    this.configuredDefaultMode = options.configuredDefaultMode;
    this.allowedRules = options.allowedRules || [];
    this.deniedRules = options.deniedRules || [];
    this.workdir = options.workdir;
    this.planFilePath = options.planFilePath;
    this.updateAdditionalDirectories(options.additionalDirectories || []);
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
   * Update the denied rules (e.g., when configuration reloads)
   */
  updateDeniedRules(rules: string[]): void {
    this.logger?.debug("Updating denied permission rules", {
      count: rules.length,
    });
    this.deniedRules = rules;
  }

  /**
   * Add temporary rules for the current session
   */
  public addTemporaryRules(rules: string[]): void {
    this.logger?.debug("Adding temporary permission rules", {
      count: rules.length,
      rules,
    });
    this.temporaryRules.push(...rules);
  }

  /**
   * Clear all temporary rules
   */
  public clearTemporaryRules(): void {
    this.logger?.debug("Clearing temporary permission rules");
    this.temporaryRules = [];
  }

  /**
   * Update the additional directories (e.g., when configuration reloads)
   */
  updateAdditionalDirectories(directories: string[]): void {
    this.logger?.debug("Updating additional directories", {
      count: directories.length,
    });
    this.additionalDirectories = directories.map((dir) => {
      if (this.workdir && !path.isAbsolute(dir)) {
        return path.resolve(this.workdir, dir);
      }
      return path.resolve(dir);
    });
  }

  /**
   * Update the working directory
   */
  updateWorkdir(workdir: string): void {
    this.logger?.debug("Updating working directory", {
      workdir,
    });
    this.workdir = workdir;
  }

  /**
   * Set the current plan file path
   */
  public setPlanFilePath(path: string | undefined): void {
    this.logger?.debug("Setting plan file path", { path });
    this.planFilePath = path;
  }

  /**
   * Get the current plan file path
   */
  public getPlanFilePath(): string | undefined {
    return this.planFilePath;
  }

  /**
   * Check if a path is inside the Safe Zone (workdir + additionalDirectories)
   */
  private isInsideSafeZone(
    targetPath: string,
    workdir?: string,
  ): { isInside: boolean; resolvedPath: string } {
    const effectiveWorkdir = workdir || this.workdir;

    // Resolve the target path relative to effectiveWorkdir if it's not absolute
    const absolutePath =
      effectiveWorkdir && !path.isAbsolute(targetPath)
        ? path.resolve(effectiveWorkdir, targetPath)
        : path.resolve(targetPath);

    // Check workdir
    if (effectiveWorkdir && isPathInside(absolutePath, effectiveWorkdir)) {
      return { isInside: true, resolvedPath: absolutePath };
    }

    // Check additional directories
    for (const dir of this.additionalDirectories) {
      if (isPathInside(absolutePath, dir)) {
        return { isInside: true, resolvedPath: absolutePath };
      }
    }

    this.logger?.debug("Path is outside Safe Zone", {
      absolutePath,
      workdir: effectiveWorkdir,
      additionalDirectories: this.additionalDirectories,
    });

    return { isInside: false, resolvedPath: absolutePath };
  }

  /**
   * Get the current effective permission mode for tool execution context
   */
  getCurrentEffectiveMode(cliPermissionMode?: PermissionMode): PermissionMode {
    const mode = this.resolveEffectivePermissionMode(cliPermissionMode);
    this.logger?.debug("getCurrentEffectiveMode", {
      cliPermissionMode,
      configuredDefaultMode: this.configuredDefaultMode,
      resolvedMode: mode,
    });
    return mode;
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

    // 0. Check denied rules first - Deny always takes precedence
    for (const rule of this.deniedRules) {
      if (this.matchesRule(context, rule)) {
        this.logger?.warn("Permission denied by rule", {
          toolName: context.toolName,
          rule,
        });
        return {
          behavior: "deny",
          message: `Access to tool '${context.toolName}' is explicitly denied by rule: ${rule}`,
        };
      }
    }

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
        // Enforce Safe Zone for file operations
        const targetPath = (context.toolInput?.file_path ||
          context.toolInput?.target_file) as string | undefined;
        const workdir = context.toolInput?.workdir as string | undefined;

        if (targetPath) {
          const { isInside, resolvedPath } = this.isInsideSafeZone(
            targetPath,
            workdir,
          );
          if (!isInside) {
            this.logger?.warn(
              "File operation outside the Safe Zone in acceptEdits mode",
              {
                toolName: context.toolName,
                targetPath,
                resolvedPath,
              },
            );
            return {
              behavior: "deny",
              message: `Tool '${context.toolName}' attempted to modify a file outside the Safe Zone: ${targetPath}. Operations outside the Safe Zone always require manual confirmation.`,
            };
          }
        }

        this.logger?.debug(
          "Permission automatically accepted for tool in acceptEdits mode",
          {
            toolName: context.toolName,
          },
        );
        return { behavior: "allow" };
      }
    }

    // 1.3 If plan mode, allow Read-only tools and Edit/Write for plan file
    if (context.permissionMode === "plan") {
      if (context.toolName === "Bash") {
        return {
          behavior: "deny",
          message: "Bash commands are not allowed in plan mode.",
        };
      }

      if (context.toolName === "Delete") {
        return {
          behavior: "deny",
          message: "Delete operations are not allowed in plan mode.",
        };
      }

      const writeTools = ["Edit", "MultiEdit", "Write"];
      if (writeTools.includes(context.toolName)) {
        const targetPath = (context.toolInput?.file_path ||
          context.toolInput?.target_file) as string | undefined;

        if (this.planFilePath && targetPath) {
          const absoluteTargetPath = path.resolve(targetPath);
          const absolutePlanPath = path.resolve(this.planFilePath);

          if (absoluteTargetPath === absolutePlanPath) {
            this.logger?.debug("Allowing write to plan file in plan mode", {
              toolName: context.toolName,
              targetPath,
            });
            return { behavior: "allow" };
          }
        }

        return {
          behavior: "deny",
          message: `In plan mode, you are only allowed to edit the designated plan file: ${this.planFilePath || "not set"}.`,
        };
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
          if (cmd === "cd" || cmd === "ls") {
            const pathArgs =
              (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                (arg) => !arg.startsWith("-"),
              ) || [];

            return pathArgs.some((pathArg) => {
              const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
              const { isInside } = this.isInsideSafeZone(cleanPath, workdir);
              return !isInside;
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
   * Check if a tool call matches a specific permission rule
   */
  private matchesRule(context: ToolPermissionContext, rule: string): boolean {
    // 1. Simple tool name match (e.g., "Bash", "Write")
    if (rule === context.toolName) {
      return true;
    }

    // 2. Tool with pattern match (e.g., "Bash(rm:*)", "Read(**/*.env)")
    const match = rule.match(/^(\w+)\((.*)\)$/);
    if (!match) {
      return false;
    }

    const [, toolName, pattern] = match;
    if (toolName !== context.toolName) {
      return false;
    }

    // Handle Bash command rules
    if (toolName === "Bash") {
      const command = String(context.toolInput?.command || "");
      const parts = splitBashCommand(command);
      return parts.some((part) => {
        const processedPart = stripRedirections(stripEnvVars(part));
        if (pattern.endsWith(":*")) {
          return processedPart.startsWith(pattern.slice(0, -2));
        }
        return processedPart === pattern;
      });
    }

    // Handle path-based rules (e.g., "Read(**/*.env)")
    const pathTools = ["Read", "Write", "Edit", "MultiEdit", "Delete", "LS"];
    if (pathTools.includes(toolName)) {
      const targetPath = (context.toolInput?.file_path ||
        context.toolInput?.target_file ||
        context.toolInput?.path) as string | undefined;

      if (targetPath) {
        return minimatch(targetPath, pattern, { dot: true });
      }
    }

    return false;
  }

  /**
   * Check if a tool call is allowed by persistent rules
   */
  private isAllowedByRule(context: ToolPermissionContext): boolean {
    // Check temporary rules first (simple tool name match)
    if (this.temporaryRules.includes(context.toolName)) {
      return true;
    }

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
            if (cmd === "pwd" || cmd === "true" || cmd === "false") {
              return true;
            }

            if (workdir) {
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
                const { isInside } = this.isInsideSafeZone(cleanPath, workdir);
                return isInside;
              });

              if (allPathsSafe) {
                return true;
              }
            }
          }
        }

        // Check if this specific part is allowed by any rule
        // We create a temporary context with just this part of the command
        const partContext = {
          ...context,
          toolInput: { ...context.toolInput, command: processedPart },
        };
        const allowedByRule = this.allowedRules.some((rule) =>
          this.matchesRule(partContext, rule),
        );

        if (allowedByRule) return true;
        return !this.isRestrictedTool(context.toolName);
      });
    }

    // For other tools, check if any rule matches
    return this.allowedRules.some((rule) => this.matchesRule(context, rule));
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
          if (cmd === "pwd" || cmd === "true" || cmd === "false") {
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
                const { isInside } = this.isInsideSafeZone(cleanPath, workdir);
                return isInside;
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
              const { isInside } = this.isInsideSafeZone(cleanPath, workdir);
              return !isInside;
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
