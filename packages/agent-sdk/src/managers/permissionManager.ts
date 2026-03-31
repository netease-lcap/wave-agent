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
  hasWriteRedirections,
  isBashHeredocWrite,
  getSmartPrefix,
  DANGEROUS_COMMANDS,
} from "../utils/bashParser.js";
import { isPathInside } from "../utils/pathSafety.js";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  READ_TOOL_NAME,
} from "../constants/tools.js";
import { Container } from "../utils/container.js";
import { ConfigurationService } from "../services/configurationService.js";

const SAFE_COMMANDS = [
  "cd",
  "ls",
  "pwd",
  "true",
  "false",
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "sleep",
];

const DEFAULT_ALLOWED_RULES = [
  "Bash(git status*)",
  "Bash(git diff*)",
  "Bash(git log*)",
  "Bash(git show*)",
  "Bash(git branch)",
  "Bash(git branch --list*)",
  "Bash(git branch -a*)",
  "Bash(git branch -r*)",
  "Bash(git branch --show-current*)",
  "Bash(git branch --merged*)",
  "Bash(git branch --no-merged*)",
  "Bash(git branch --contains*)",
  "Bash(git branch --no-contains*)",
  "Bash(git branch --verbose*)",
  "Bash(git branch -v*)",
  "Bash(git branch -vv*)",
  "Bash(git tag*)",
  "Bash(git remote*)",
  "Bash(git ls-files*)",
  "Bash(git rev-parse*)",
  "Bash(git config --list*)",
  "Bash(git config -l*)",
  "Bash(git cat-file*)",
  "Bash(git count-objects*)",
  "Bash(echo*)",
  "Bash(ls*)",
  "Bash(which*)",
  "Bash(type*)",
  "Bash(hostname*)",
  "Bash(whoami*)",
  "Bash(date*)",
  "Bash(uptime*)",
  "Bash(grep*)",
  "Bash(rg*)",
  "Bash(cat*)",
  "Bash(head*)",
  "Bash(tail*)",
  "Bash(wc*)",
  "Bash(sleep*)",
];

import { logger } from "../utils/globalLogger.js";

export interface PermissionManagerOptions {
  /** Configured permission mode from settings */
  configuredPermissionMode?: PermissionMode;
  /** Allowed rules from settings */
  allowedRules?: string[];
  /** Denied rules from settings */
  deniedRules?: string[];
  /** Instance-specific allowed rules (from AgentOptions) */
  instanceAllowedRules?: string[];
  /** Instance-specific denied rules (from AgentOptions) */
  instanceDeniedRules?: string[];
  /** Additional directories considered part of the Safe Zone */
  additionalDirectories?: string[];
  /** The main working directory */
  workdir?: string;
  /** Path to the current plan file */
  planFilePath?: string;
  /** Optional logger */
  logger?: Logger;
}

export class PermissionManager {
  private configuredPermissionMode?: PermissionMode;
  private allowedRules: string[] = [];
  private deniedRules: string[] = [];
  private instanceAllowedRules: string[] = [];
  private instanceDeniedRules: string[] = [];
  private temporaryRules: string[] = [];
  private additionalDirectories: string[] = [];
  private systemAdditionalDirectories: string[] = [];
  private workdir?: string;
  private planFilePath?: string;
  private worktreeName?: string;
  private mainRepoRoot?: string;
  private onConfiguredPermissionModeChange?: (mode: PermissionMode) => void;
  private _logger?: Logger;

  constructor(
    private container: Container,
    options: PermissionManagerOptions = {},
  ) {
    this.configuredPermissionMode = options.configuredPermissionMode;
    this.allowedRules = options.allowedRules || [];
    this.deniedRules = options.deniedRules || [];
    this.instanceAllowedRules = options.instanceAllowedRules || [];
    this.instanceDeniedRules = options.instanceDeniedRules || [];
    this.workdir = options.workdir;
    this.planFilePath = options.planFilePath;
    this._logger = options.logger;
    this.updateAdditionalDirectories(options.additionalDirectories || []);

    this.worktreeName = this.container.get<string>("WorktreeName");
    this.mainRepoRoot = this.container.get<string>("MainRepoRoot");
  }

  /**
   * Set a callback to be notified when the effective permission mode changes due to configuration updates
   */
  public setOnConfiguredPermissionModeChange(
    callback: (mode: PermissionMode) => void,
  ): void {
    this.onConfiguredPermissionModeChange = callback;
  }

  /**
   * Update the configured default mode (e.g., when configuration reloads)
   */
  updateConfiguredPermissionMode(permissionMode?: PermissionMode): void {
    const oldEffectiveMode = this.getCurrentEffectiveMode();

    this.configuredPermissionMode = permissionMode;

    const newEffectiveMode = this.getCurrentEffectiveMode();
    if (
      oldEffectiveMode !== newEffectiveMode &&
      this.onConfiguredPermissionModeChange
    ) {
      this.onConfiguredPermissionModeChange(newEffectiveMode);
    }
  }

  /**
   * Get the configured default mode
   */
  public getConfiguredPermissionMode(): PermissionMode | undefined {
    return this.configuredPermissionMode;
  }

  /**
   * Get all currently allowed rules (user-defined)
   */
  public getAllowedRules(): string[] {
    return [...this.allowedRules];
  }

  /**
   * Get all currently denied rules
   */
  public getDeniedRules(): string[] {
    return [...this.deniedRules];
  }

  /**
   * Get all instance-specific allowed rules
   */
  public getInstanceAllowedRules(): string[] {
    return [...this.instanceAllowedRules];
  }

  /**
   * Get all instance-specific denied rules
   */
  public getInstanceDeniedRules(): string[] {
    return [...this.instanceDeniedRules];
  }

  /**
   * Get all additional directories
   */
  public getAdditionalDirectories(): string[] {
    return [...this.additionalDirectories];
  }

  /**
   * Get all default allowed rules
   */
  public getDefaultAllowedRules(): string[] {
    return [...DEFAULT_ALLOWED_RULES];
  }

  /**
   * Update the allowed rules (e.g., when configuration reloads)
   */
  updateAllowedRules(rules: string[]): void {
    this.allowedRules = rules;
  }

  /**
   * Update the denied rules (e.g., when configuration reloads)
   */
  updateDeniedRules(rules: string[]): void {
    this.deniedRules = rules;
  }

  /**
   * Add temporary rules for the current session
   */
  public addTemporaryRules(rules: string[]): void {
    this.temporaryRules.push(...rules);
  }

  /**
   * Clear all temporary rules
   */
  public clearTemporaryRules(): void {
    this.temporaryRules = [];
  }

  /**
   * Update the additional directories (e.g., when configuration reloads)
   */
  updateAdditionalDirectories(directories: string[]): void {
    this.additionalDirectories = directories.map((dir) => {
      if (this.workdir && !path.isAbsolute(dir)) {
        return path.resolve(this.workdir, dir);
      }
      return path.resolve(dir);
    });
  }

  /**
   * Add a system-level additional directory that is persistent across configuration reloads
   */
  public addSystemAdditionalDirectory(directory: string): void {
    const resolvedPath =
      this.workdir && !path.isAbsolute(directory)
        ? path.resolve(this.workdir, directory)
        : path.resolve(directory);

    if (!this.systemAdditionalDirectories.includes(resolvedPath)) {
      this.systemAdditionalDirectories.push(resolvedPath);
    }
  }

  /**
   * Update the working directory
   */
  updateWorkdir(workdir: string): void {
    this.workdir = workdir;
  }

  /**
   * Set the current plan file path
   */
  public setPlanFilePath(path: string | undefined): void {
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

    // Check system additional directories
    for (const dir of this.systemAdditionalDirectories) {
      if (isPathInside(absolutePath, dir)) {
        return { isInside: true, resolvedPath: absolutePath };
      }
    }

    return { isInside: false, resolvedPath: absolutePath };
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
      return cliPermissionMode;
    }

    // Use configured default mode if available
    if (this.configuredPermissionMode !== undefined) {
      return this.configuredPermissionMode;
    }

    // Fall back to system default
    return "default";
  }

  /**
   * Check if a tool execution requires permission and handle the authorization flow
   * Called by individual tools after validation/diff, before real operation
   */
  async checkPermission(
    context: ToolPermissionContext,
  ): Promise<PermissionDecision> {
    // 0. Intercept Bash EOF writing operations
    if (context.toolName === BASH_TOOL_NAME && context.toolInput?.command) {
      const command = String(context.toolInput.command);
      if (isBashHeredocWrite(command)) {
        // Check if this specific command is explicitly allowed by a rule that includes redirection
        const isExplicitlyAllowed = [
          ...this.instanceAllowedRules,
          ...this.temporaryRules,
          ...this.allowedRules,
          ...DEFAULT_ALLOWED_RULES,
        ].some((rule) => {
          if (rule.startsWith("Bash(") && rule.endsWith(")")) {
            const pattern = rule.substring(5, rule.length - 1);
            // If the pattern itself has write redirections, we check if it matches
            if (hasWriteRedirections(pattern)) {
              return this.matchesRule(context, rule);
            }
          }
          return false;
        });

        if (!isExplicitlyAllowed) {
          return {
            behavior: "deny",
            message:
              "Bash-based file writing operations using heredocs (e.g., 'cat <<EOF > file') are not allowed. Please use the dedicated 'Write' or 'Edit' tools instead for file modifications.",
          };
        }
      }
    }

    // 0. Check instance-specific denied rules first - Deny always takes precedence
    for (const rule of this.instanceDeniedRules) {
      if (this.matchesRule(context, rule)) {
        logger?.warn("Permission denied by instance rule", {
          toolName: context.toolName,
          rule,
        });
        return {
          behavior: "deny",
          message: `Access to tool '${context.toolName}' is explicitly denied by instance rule: ${rule}`,
        };
      }
    }

    // 0. Check worktree safety for Write and Edit tools
    if (
      this.worktreeName &&
      this.mainRepoRoot &&
      this.workdir &&
      (context.toolName === WRITE_TOOL_NAME ||
        context.toolName === EDIT_TOOL_NAME)
    ) {
      const targetPath = context.toolInput?.file_path as string | undefined;
      if (targetPath) {
        const absoluteTargetPath = path.resolve(this.workdir, targetPath);
        const isInsideMainRepo = isPathInside(
          absoluteTargetPath,
          this.mainRepoRoot,
        );
        const isInsideWorktree = isPathInside(absoluteTargetPath, this.workdir);

        // If it's inside the main repo but NOT inside the current worktree
        if (isInsideMainRepo && !isInsideWorktree) {
          logger?.warn("Worktree safety violation", {
            toolName: context.toolName,
            targetPath,
            worktreeName: this.worktreeName,
            mainRepoRoot: this.mainRepoRoot,
            workdir: this.workdir,
          });
          return {
            behavior: "deny",
            message: `Access denied: You are currently in a worktree session ("${this.worktreeName}"). Modifying files in the main repository (outside the worktree) is not allowed. Please only modify files within the worktree directory: ${this.workdir}`,
          };
        }
      }
    }

    // 0. Check denied rules first - Deny always takes precedence
    for (const rule of this.deniedRules) {
      if (this.matchesRule(context, rule)) {
        logger?.warn("Permission denied by rule", {
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
      return { behavior: "allow" };
    }

    // 1.1 If acceptEdits mode, allow Edit, Write, and mkdir in safe zone
    if (context.permissionMode === "acceptEdits") {
      const autoAcceptedTools = [EDIT_TOOL_NAME, WRITE_TOOL_NAME];
      if (autoAcceptedTools.includes(context.toolName)) {
        // Enforce Safe Zone for file operations
        const targetPath = context.toolInput?.file_path as string | undefined;
        const workdir = context.toolInput?.workdir as string | undefined;

        if (targetPath) {
          const { isInside, resolvedPath } = this.isInsideSafeZone(
            targetPath,
            workdir,
          );
          if (!isInside) {
            logger?.info(
              "File operation outside the Safe Zone in acceptEdits mode, falling back to manual confirmation",
              {
                toolName: context.toolName,
                targetPath,
                resolvedPath,
              },
            );
            // Fall through to normal permission check flow to trigger confirmation prompt
          } else {
            return { behavior: "allow" };
          }
        }
      }

      // Special case for mkdir in Bash tool
      if (context.toolName === BASH_TOOL_NAME && context.toolInput?.command) {
        const command = String(context.toolInput.command).trim();
        if (command.startsWith("mkdir ")) {
          const parts = splitBashCommand(command);
          // Check if it's a simple mkdir command (first part is mkdir)
          if (parts.length === 1) {
            const processedPart = stripEnvVars(parts[0]);
            if (processedPart.startsWith("mkdir ")) {
              const args = processedPart.slice(6).trim();
              const pathArgs =
                (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                  (arg) => !arg.startsWith("-"),
                ) || [];

              if (pathArgs.length > 0) {
                const allPathsSafe = pathArgs.every((pathArg) => {
                  const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
                  const { isInside } = this.isInsideSafeZone(
                    cleanPath,
                    context.toolInput?.workdir as string | undefined,
                  );
                  return isInside;
                });

                if (allPathsSafe) {
                  return { behavior: "allow" };
                }
              }
            }
          }
        }
      }
    }

    // 1.2 Check if tool call is allowed by persistent or temporary rules
    if (this.isAllowedByRule(context)) {
      return { behavior: "allow" };
    }

    // 1.3 If plan mode, allow Read-only tools and Edit/Write for plan file
    if (context.permissionMode === "plan") {
      const writeTools = [EDIT_TOOL_NAME, WRITE_TOOL_NAME];
      if (writeTools.includes(context.toolName)) {
        const targetPath = context.toolInput?.file_path as string | undefined;

        if (this.planFilePath && targetPath) {
          const absoluteTargetPath = path.resolve(targetPath);
          const absolutePlanPath = path.resolve(this.planFilePath);

          if (absoluteTargetPath === absolutePlanPath) {
            return { behavior: "allow" };
          }
        }

        return {
          behavior: "deny",
          message: `In plan mode, you are only allowed to edit the designated plan file: ${this.planFilePath || "not set"}.`,
        };
      }
    }

    // 2. If not a restricted tool, always allow
    if (!this.isRestrictedTool(context.toolName)) {
      return { behavior: "allow" };
    }

    // 2.1 If dontAsk mode, auto-deny restricted tools that were not allowed by rules above
    if (context.permissionMode === "dontAsk") {
      logger?.info("Restricted tool automatically denied in dontAsk mode", {
        toolName: context.toolName,
      });
      return {
        behavior: "deny",
        message: `Tool '${context.toolName}' was automatically denied because 'dontAsk' permission mode is active and no pre-approved rule matches this call.`,
      };
    }

    // 3. If custom callback provided, call it and return result
    if (context.canUseToolCallback) {
      try {
        const decision = await context.canUseToolCallback(context);
        if (decision.behavior !== "allow") {
          logger?.debug("Custom callback returned decision", {
            toolName: context.toolName,
            decision,
          });
        }
        return decision;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger?.error("Error in permission callback", {
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
    logger?.warn(
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
    return (
      (RESTRICTED_TOOLS as readonly string[]).includes(toolName) ||
      toolName.startsWith("mcp__")
    );
  }

  /**
   * Check if a tool is completely denied by name in instance or global rules
   */
  public isToolDenied(toolName: string): boolean {
    // Check instance-specific denied rules
    if (this.instanceDeniedRules.includes(toolName)) {
      return true;
    }

    // Check global denied rules
    if (this.deniedRules.includes(toolName)) {
      return true;
    }

    return false;
  }

  /**
   * Helper method to create a permission context for CLI integration
   */
  createContext(
    toolName: string,
    permissionMode: PermissionMode,
    callback?: PermissionCallback,
    toolInput?: Record<string, unknown>,
    toolCallId?: string,
    planContent?: string,
  ): ToolPermissionContext {
    let suggestedPrefix: string | undefined;
    if (toolName === BASH_TOOL_NAME && toolInput?.command) {
      const command = String(toolInput.command);
      const parts = splitBashCommand(command);
      // Only suggest prefix for single commands to avoid confusion with complex chains
      if (parts.length === 1) {
        const processedPart = stripRedirections(stripEnvVars(parts[0]));
        suggestedPrefix = getSmartPrefix(processedPart) ?? undefined;
      }
    } else if (toolName.startsWith("mcp__")) {
      suggestedPrefix = toolName;
    }

    const context: ToolPermissionContext = {
      toolName,
      permissionMode,
      canUseToolCallback: callback,
      toolInput,
      suggestedPrefix,
      toolCallId,
      planContent,
    };

    // Set hidePersistentOption for out-of-bounds file operations
    const fileTools = [EDIT_TOOL_NAME, WRITE_TOOL_NAME];
    if (fileTools.includes(toolName)) {
      const targetPath = toolInput?.file_path as string | undefined;
      const workdir = toolInput?.workdir as string | undefined;

      if (targetPath) {
        const { isInside } = this.isInsideSafeZone(targetPath, workdir);
        if (!isInside) {
          context.hidePersistentOption = true;
        }
      }
    }

    // Set hidePersistentOption for dangerous or out-of-bounds bash commands
    if (toolName === BASH_TOOL_NAME && toolInput?.command) {
      const command = String(toolInput.command);
      const workdir = toolInput.workdir as string | undefined;
      const parts = splitBashCommand(command);

      const isDangerous = parts.some((part) => {
        if (hasWriteRedirections(part)) {
          return true;
        }
        const processedPart = stripRedirections(stripEnvVars(part));
        const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
        if (commandMatch) {
          const cmd = commandMatch[1];
          const args = commandMatch[2]?.trim() || "";

          // Check blacklist
          if (DANGEROUS_COMMANDS.includes(cmd)) {
            return true;
          }

          // Check out-of-bounds for cd
          if (cmd === "cd") {
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

    // 2. Tool with pattern match (e.g., "Bash(rm *)", "Read(**/*.env)")
    const match = rule.match(/^(\w+)\((.*)\)$/);
    if (!match) {
      return false;
    }

    const [, toolName, pattern] = match;
    if (toolName !== context.toolName) {
      return false;
    }

    // Handle Bash command rules
    if (toolName === BASH_TOOL_NAME) {
      const command = String(context.toolInput?.command || "");
      const hasWriteInPattern = hasWriteRedirections(pattern);
      const hasWriteInCommand = hasWriteRedirections(command);

      // If the command has write redirections, it must match a pattern that also has write redirections
      if (hasWriteInCommand && !hasWriteInPattern) {
        return false;
      }

      const processedPart = hasWriteInPattern
        ? stripEnvVars(command)
        : stripRedirections(stripEnvVars(command));
      // For Bash commands, we want '*' to match everything including slashes and spaces
      // minimatch's default behavior for '*' is to not match across directory separators
      // We use a regex to replace '*' with '.*' (match anything)
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\?]/g, "\\$&") // Escape regex special chars including ?
        .replace(/\*/g, ".*"); // Replace * with .*
      const regex = new RegExp(`^${regexPattern}$`, "s");
      const matched = regex.test(processedPart);
      return matched;
    }

    // Handle path-based rules (e.g., "Read(**/*.env)")
    const pathTools = [READ_TOOL_NAME, WRITE_TOOL_NAME, EDIT_TOOL_NAME];
    if (pathTools.includes(toolName)) {
      const targetPath = (context.toolInput?.file_path ||
        context.toolInput?.path) as string | undefined;

      if (targetPath) {
        if (minimatch(targetPath, pattern, { dot: true })) {
          return true;
        }

        // If direct match fails, try matching relative path if targetPath is absolute and pattern is relative
        if (
          path.isAbsolute(targetPath) &&
          !path.isAbsolute(pattern) &&
          this.workdir
        ) {
          const relativePath = path.relative(this.workdir, targetPath);
          // Ensure the path is not outside the workdir (doesn't start with ..)
          if (
            !relativePath.startsWith("..") &&
            !path.isAbsolute(relativePath)
          ) {
            return minimatch(relativePath, pattern, { dot: true });
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a tool call is allowed by persistent or temporary rules
   */
  private isAllowedByRule(context: ToolPermissionContext): boolean {
    const isAllowedByRuleList = (
      ctx: ToolPermissionContext,
      rules: string[],
      isDefaultRules: boolean = false,
    ) => {
      if (ctx.toolName === BASH_TOOL_NAME && ctx.toolInput?.command) {
        const command = String(ctx.toolInput.command);
        const parts = splitBashCommand(command);
        if (parts.length === 0) return false;

        const workdir = ctx.toolInput?.workdir as string | undefined;

        return parts.every((part) => {
          const hasWrite = hasWriteRedirections(part);
          const processedPart = stripRedirections(stripEnvVars(part));

          // Check for safe commands
          if (!hasWrite) {
            const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
            if (commandMatch) {
              const cmd = commandMatch[1];
              const args = commandMatch[2]?.trim() || "";

              if (SAFE_COMMANDS.includes(cmd)) {
                if (
                  cmd === "pwd" ||
                  cmd === "true" ||
                  cmd === "false" ||
                  cmd === "ls" ||
                  cmd === "grep" ||
                  cmd === "rg" ||
                  cmd === "cat" ||
                  cmd === "head" ||
                  cmd === "tail" ||
                  cmd === "wc" ||
                  cmd === "sleep"
                ) {
                  return true;
                }

                if (workdir) {
                  // For cd, check paths
                  const pathArgs =
                    (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).filter(
                      (arg) => !arg.startsWith("-"),
                    ) || [];

                  if (pathArgs.length === 0) {
                    // cd without arguments operates on current dir (workdir)
                    return true;
                  }

                  const allPathsSafe = pathArgs.every((pathArg) => {
                    // Remove quotes if present
                    const cleanPath = pathArg.replace(/^['"](.*)['"]$/, "$1");
                    const { isInside } = this.isInsideSafeZone(
                      cleanPath,
                      workdir,
                    );
                    return isInside;
                  });

                  if (allPathsSafe) {
                    return true;
                  }
                }
              }
            }
          }

          // Check if this specific part is allowed by any rule
          if (hasWrite && isDefaultRules) {
            return false;
          }

          // We create a temporary context with just this part of the command
          const partContext = {
            ...ctx,
            toolInput: { ...ctx.toolInput, command: part },
          };
          const allowedByRule = rules.some((rule) => {
            return this.matchesRule(partContext, rule);
          });

          if (allowedByRule) return true;

          return !this.isRestrictedTool(ctx.toolName);
        });
      }

      // For other tools, check if any rule matches
      return rules.some((rule) => this.matchesRule(ctx, rule));
    };

    // Check instance-specific allowed rules first
    if (isAllowedByRuleList(context, this.instanceAllowedRules)) {
      return true;
    }

    // Check temporary rules
    if (isAllowedByRuleList(context, this.temporaryRules)) {
      return true;
    }

    // Check persistent allowed rules
    if (isAllowedByRuleList(context, this.allowedRules)) {
      return true;
    }

    // Check default allowed rules
    return isAllowedByRuleList(context, DEFAULT_ALLOWED_RULES, true);
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
      const hasWrite = hasWriteRedirections(part);
      const processedPart = stripRedirections(stripEnvVars(part));

      // Check for safe commands
      const commandMatch = processedPart.match(/^(\w+)(\s+.*)?$/);
      let isSafe = false;

      if (commandMatch && !hasWrite) {
        const cmd = commandMatch[1];
        const args = commandMatch[2]?.trim() || "";

        if (SAFE_COMMANDS.includes(cmd)) {
          if (
            cmd === "pwd" ||
            cmd === "true" ||
            cmd === "false" ||
            cmd === "ls" ||
            cmd === "grep" ||
            cmd === "rg" ||
            cmd === "cat" ||
            cmd === "head" ||
            cmd === "tail" ||
            cmd === "wc" ||
            cmd === "sleep"
          ) {
            isSafe = true;
          } else {
            // For cd, check paths
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

          if (cmd === "cd") {
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

        const smartPrefix = hasWrite ? null : getSmartPrefix(processedPart);
        if (smartPrefix) {
          rules.push(`Bash(${smartPrefix}*)`);
        } else {
          rules.push(`Bash(${hasWrite ? stripEnvVars(part) : processedPart})`);
        }
      }
    }

    return rules;
  }

  /**
   * Add a persistent permission rule
   * @param rule - The rule to add (e.g., "Bash(ls)")
   */
  public async addPermissionRule(rule: string): Promise<void> {
    if (!this.workdir) {
      throw new Error("Working directory not set in PermissionManager");
    }

    // 1. Expand rule if it's a Bash command
    let rulesToAdd = [rule];
    const bashMatch = rule.match(/^Bash\((.*)\)$/);
    if (bashMatch) {
      const command = bashMatch[1];
      rulesToAdd = this.expandBashRule(command, this.workdir);
    }

    const configurationService = this.container.get<ConfigurationService>(
      "ConfigurationService",
    );

    for (const ruleToAdd of rulesToAdd) {
      // 2. Update PermissionManager state
      const currentRules = this.getAllowedRules();
      const defaultRules = this.getDefaultAllowedRules();
      if (
        !currentRules.includes(ruleToAdd) &&
        !defaultRules.includes(ruleToAdd)
      ) {
        this.updateAllowedRules([...currentRules, ruleToAdd]);

        // 3. Persist to settings.local.json
        try {
          if (configurationService) {
            await configurationService.addAllowedRule(this.workdir, ruleToAdd);
            this._logger?.debug("Persistent permission rule added", {
              rule: ruleToAdd,
            });
          }
        } catch (error) {
          this._logger?.error("Failed to persist permission rule", {
            rule: ruleToAdd,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}
