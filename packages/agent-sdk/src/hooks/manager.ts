/**
 * Hook Manager
 *
 * Central orchestrator for the hooks system. Handles configuration loading,
 * validation, and hook execution across all supported events.
 */

import {
  type HookEvent,
  type HookEventConfig,
  type HookConfiguration,
  type PartialHookConfiguration,
  type HookExecutionContext,
  type ExtendedHookExecutionContext,
  type HookExecutionResult,
  type ValidationResult,
  HookConfigurationError,
  isValidHookEvent,
  isValidHookEventConfig,
} from "./types.js";
import { type IHookMatcher, HookMatcher } from "./matcher.js";
import { type IHookExecutor, HookExecutor } from "./executor.js";
import { loadMergedHooksConfig } from "./settings.js";
import type { Logger } from "../types.js";

export interface IHookManager {
  // Load configuration from settings
  loadConfiguration(
    userHooks?: PartialHookConfiguration,
    projectHooks?: PartialHookConfiguration,
  ): void;

  // Load configuration from filesystem settings
  loadConfigurationFromSettings(): void;

  // Execute hooks for specific event
  executeHooks(
    event: HookEvent,
    context: HookExecutionContext | ExtendedHookExecutionContext,
  ): Promise<HookExecutionResult[]>;

  // Check if hooks are configured for event
  hasHooks(event: HookEvent, toolName?: string): boolean;

  // Validate hook configuration
  validateConfiguration(config: HookConfiguration): ValidationResult;

  // Get current configuration
  getConfiguration(): PartialHookConfiguration | undefined;
}

export class HookManager implements IHookManager {
  private configuration: PartialHookConfiguration | undefined;
  private readonly matcher: IHookMatcher;
  private readonly executor: IHookExecutor;
  private readonly logger?: Logger;
  private readonly workdir: string;

  constructor(
    workdir: string,
    matcher: IHookMatcher = new HookMatcher(),
    executor?: IHookExecutor,
    logger?: Logger,
  ) {
    this.workdir = workdir;
    this.matcher = matcher;
    // Create executor with logger if provided, or use passed executor, or create default
    this.executor = logger
      ? new HookExecutor(logger)
      : executor || new HookExecutor();
    this.logger = logger;
  }

  /**
   * Load and merge hook configurations from user and project settings
   * Project settings take precedence over user settings
   */
  loadConfiguration(
    userHooks?: PartialHookConfiguration,
    projectHooks?: PartialHookConfiguration,
  ): void {
    const merged: PartialHookConfiguration = {};

    // Start with user hooks
    if (userHooks) {
      this.mergeHooksConfiguration(merged, userHooks);
    }

    // Override with project hooks (project settings take precedence)
    if (projectHooks) {
      this.mergeHooksConfiguration(merged, projectHooks);
    }

    // Validate merged configuration
    const validation = this.validatePartialConfiguration(merged);
    if (!validation.valid) {
      throw new HookConfigurationError(
        "merged configuration",
        validation.errors,
      );
    }

    this.configuration = merged;
  }

  /**
   * Load configuration from filesystem settings
   * Automatically loads and merges user and project hooks configuration
   */
  loadConfigurationFromSettings(): void {
    try {
      this.logger?.info(`[HookManager] Loading configuration...`);
      const mergedConfig = loadMergedHooksConfig(this.workdir);
      this.logger?.info(`[HookManager] Merged config result:`, mergedConfig);
      this.configuration = mergedConfig;

      // Validate the loaded configuration
      const validation = this.validatePartialConfiguration(mergedConfig);
      if (!validation.valid) {
        throw new HookConfigurationError(
          "filesystem settings",
          validation.errors,
        );
      }

      this.logger?.info(
        `[HookManager] Configuration loaded successfully with ${Object.keys(mergedConfig).length} event types`,
      );
    } catch (error) {
      // If loading fails, start with undefined configuration (no hooks)
      this.configuration = undefined;

      // Re-throw configuration errors, but handle file system errors gracefully
      if (error instanceof HookConfigurationError) {
        throw error;
      } else {
        this.logger?.warn(
          "Failed to load hooks configuration from settings:",
          error,
        );
      }
    }
  }

  /**
   * Execute hooks for a specific event
   */
  async executeHooks(
    event: HookEvent,
    context: HookExecutionContext | ExtendedHookExecutionContext,
  ): Promise<HookExecutionResult[]> {
    // Validate execution context
    const contextValidation = this.validateExecutionContext(event, context);
    if (!contextValidation.valid) {
      this.logger?.error(
        `[HookManager] Invalid execution context for ${event}: ${contextValidation.errors.join(", ")}`,
      );
      return [
        {
          success: false,
          stderr: `Invalid execution context: ${contextValidation.errors.join(", ")}`,
          duration: 0,
          timedOut: false,
        },
      ];
    }

    if (!this.configuration) {
      this.logger?.info(
        `[HookManager] No configuration loaded, skipping ${event} hooks`,
      );
      return [];
    }

    const eventConfigs = this.configuration[event];
    if (!eventConfigs || eventConfigs.length === 0) {
      this.logger?.info(`[HookManager] No hooks configured for ${event} event`);
      return [];
    }

    this.logger?.info(
      `[HookManager] Starting ${event} hook execution with ${eventConfigs.length} configurations`,
    );

    const results: HookExecutionResult[] = [];
    const startTime = Date.now();

    for (
      let configIndex = 0;
      configIndex < eventConfigs.length;
      configIndex++
    ) {
      const config = eventConfigs[configIndex];

      // Check if this config applies to the current context
      if (!this.configApplies(config, event, context.toolName)) {
        this.logger?.debug(
          `[HookManager] Skipping configuration ${configIndex + 1}: matcher '${config.matcher}' does not match tool '${context.toolName}'`,
        );
        continue;
      }

      this.logger?.info(
        `[HookManager] Executing configuration ${configIndex + 1} with ${config.hooks.length} commands (matcher: ${config.matcher || "any"})`,
      );

      // Execute all commands for this configuration
      for (
        let commandIndex = 0;
        commandIndex < config.hooks.length;
        commandIndex++
      ) {
        const hookCommand = config.hooks[commandIndex];

        try {
          this.logger?.debug(
            `[HookManager] Executing command ${commandIndex + 1}/${config.hooks.length} in configuration ${configIndex + 1}`,
          );

          const result = await this.executor.executeCommand(
            hookCommand.command,
            context,
          );
          results.push(result);

          // Report individual command result
          if (result.success) {
            this.logger?.info(
              `[HookManager] Command ${commandIndex + 1} completed successfully in ${result.duration}ms`,
            );
          } else {
            this.logger?.warn(
              `[HookManager] Command ${commandIndex + 1} failed in ${result.duration}ms (exit code: ${result.exitCode}, timed out: ${result.timedOut})`,
            );
          }

          // Continue with next command even if this one fails
          // This allows for non-critical hooks to fail without stopping the workflow
        } catch (error) {
          // This should be rare as executor handles most errors
          const errorMessage =
            error instanceof Error ? error.message : "Unknown execution error";
          this.logger?.error(
            `[HookManager] Unexpected error in command ${commandIndex + 1}: ${errorMessage}`,
          );

          results.push({
            success: false,
            stderr: errorMessage,
            duration: 0,
            timedOut: false,
          });
        }
      }
    }

    // Generate execution summary
    const totalDuration = Date.now() - startTime;
    const summary = this.generateExecutionSummary(
      event,
      results,
      totalDuration,
    );
    this.logger?.info(`[HookManager] ${event} execution summary: ${summary}`);

    return results;
  }

  /**
   * Check if hooks are configured for an event/tool combination
   */
  hasHooks(event: HookEvent, toolName?: string): boolean {
    if (!this.configuration) return false;

    const eventConfigs = this.configuration[event];
    if (!eventConfigs || eventConfigs.length === 0) return false;

    return eventConfigs.some((config) =>
      this.configApplies(config, event, toolName),
    );
  }

  /**
   * Validate hook configuration structure and content
   */
  validateConfiguration(config: HookConfiguration): ValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    if (!config.hooks || typeof config.hooks !== "object") {
      return {
        valid: false,
        errors: ["Configuration must have a hooks property"],
      };
    }

    // Validate each hook event
    for (const [eventName, eventConfigs] of Object.entries(config.hooks)) {
      // Validate event name
      if (!isValidHookEvent(eventName)) {
        errors.push(`Invalid hook event: ${eventName}`);
        continue;
      }

      // Validate event configurations
      if (!Array.isArray(eventConfigs)) {
        errors.push(
          `Hook event ${eventName} must be an array of configurations`,
        );
        continue;
      }

      eventConfigs.forEach((eventConfig, index) => {
        const configErrors = this.validateEventConfig(
          eventName as HookEvent,
          eventConfig,
          index,
        );
        errors.push(...configErrors);
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate partial hook configuration structure and content
   */
  private validatePartialConfiguration(
    config: PartialHookConfiguration,
  ): ValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    // Validate each hook event that is present
    for (const [eventName, eventConfigs] of Object.entries(config)) {
      // Validate event name
      if (!isValidHookEvent(eventName)) {
        errors.push(`Invalid hook event: ${eventName}`);
        continue;
      }

      // Validate event configurations
      if (!Array.isArray(eventConfigs)) {
        errors.push(
          `Hook event ${eventName} must be an array of configurations`,
        );
        continue;
      }

      eventConfigs.forEach((eventConfig, index) => {
        const configErrors = this.validateEventConfig(
          eventName as HookEvent,
          eventConfig,
          index,
        );
        errors.push(...configErrors);
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get current configuration
   */
  getConfiguration(): PartialHookConfiguration | undefined {
    if (!this.configuration) return undefined;

    // Deep clone to prevent external modification
    return JSON.parse(JSON.stringify(this.configuration));
  }

  /**
   * Clear current configuration
   */
  clearConfiguration(): void {
    this.configuration = undefined;
  }

  /**
   * Validate execution context for a specific event
   */
  private validateExecutionContext(
    event: HookEvent,
    context: HookExecutionContext,
  ): ValidationResult {
    const errors: string[] = [];

    // Validate basic context structure
    if (!context || typeof context !== "object") {
      return { valid: false, errors: ["Context must be an object"] };
    }

    // Warn about event mismatch but don't fail validation
    if (context.event !== event) {
      this.logger?.warn(
        `[HookManager] Context event '${context.event}' does not match requested event '${event}'`,
      );
    }

    // Validate project directory
    if (!context.projectDir || typeof context.projectDir !== "string") {
      errors.push("Context must have a valid projectDir string");
    }

    // Validate timestamp
    if (!context.timestamp || !(context.timestamp instanceof Date)) {
      errors.push("Context must have a valid timestamp Date object");
    }

    // Validate tool-specific requirements
    if (event === "PreToolUse" || event === "PostToolUse") {
      if (!context.toolName || typeof context.toolName !== "string") {
        errors.push(`${event} event requires a valid toolName in context`);
      }
    }

    // Validate non-tool events don't have unexpected tool names
    if (
      (event === "UserPromptSubmit" || event === "Stop") &&
      context.toolName !== undefined
    ) {
      this.logger?.warn(
        `[HookManager] ${event} event has unexpected toolName in context: ${context.toolName}`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a summary of hook execution results
   */
  private generateExecutionSummary(
    event: HookEvent,
    results: HookExecutionResult[],
    totalDuration: number,
  ): string {
    if (results.length === 0) {
      return `No hooks executed for ${event}`;
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    const timedOut = results.filter((r) => r.timedOut).length;
    const avgDuration =
      results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    let summary = `${successful}/${results.length} commands successful`;

    if (failed > 0) {
      summary += `, ${failed} failed`;
    }

    if (timedOut > 0) {
      summary += `, ${timedOut} timed out`;
    }

    summary += ` (avg: ${Math.round(avgDuration)}ms, total: ${totalDuration}ms)`;

    return summary;
  }

  /**
   * Merge hook configurations, with the second taking precedence
   */
  private mergeHooksConfiguration(
    target: PartialHookConfiguration,
    source: PartialHookConfiguration,
  ): void {
    for (const [event, configs] of Object.entries(source)) {
      if (isValidHookEvent(event)) {
        // For now, completely replace event configs rather than merging
        // This ensures project settings completely override user settings for each event
        target[event] = [...configs];
      }
    }
  }

  /**
   * Check if a hook configuration applies to the current context
   */
  private configApplies(
    config: HookEventConfig,
    event: HookEvent,
    toolName?: string,
  ): boolean {
    // For events that don't use matchers, config always applies
    if (event === "UserPromptSubmit" || event === "Stop") {
      return true;
    }

    // For tool-based events, check matcher if present
    if (event === "PreToolUse" || event === "PostToolUse") {
      if (!config.matcher) {
        // No matcher means applies to all tools
        return true;
      }

      if (!toolName) {
        // No tool name provided, cannot match
        return false;
      }

      return this.matcher.matches(config.matcher, toolName);
    }

    return false;
  }

  /**
   * Validate a single event configuration
   */
  private validateEventConfig(
    event: HookEvent,
    config: unknown,
    index: number,
  ): string[] {
    const errors: string[] = [];
    const prefix = `Hook event ${event}[${index}]`;

    if (!isValidHookEventConfig(config)) {
      errors.push(`${prefix}: Invalid hook event configuration structure`);
      return errors;
    }

    // Validate matcher requirements
    if ((event === "PreToolUse" || event === "PostToolUse") && config.matcher) {
      if (!this.matcher.isValidPattern(config.matcher)) {
        errors.push(`${prefix}: Invalid matcher pattern: ${config.matcher}`);
      }
    }

    // Validate that non-tool events don't have matchers
    if ((event === "UserPromptSubmit" || event === "Stop") && config.matcher) {
      errors.push(`${prefix}: Event ${event} should not have a matcher`);
    }

    // Validate commands
    config.hooks.forEach((hookCommand, cmdIndex) => {
      if (!this.executor.isCommandSafe(hookCommand.command)) {
        errors.push(
          `${prefix}.hooks[${cmdIndex}]: Command may be unsafe: ${hookCommand.command}`,
        );
      }
    });

    return errors;
  }

  /**
   * Get statistics about current configuration
   */
  getConfigurationStats(): {
    totalEvents: number;
    totalConfigs: number;
    totalCommands: number;
    eventBreakdown: Record<HookEvent, number>;
  } {
    if (!this.configuration) {
      return {
        totalEvents: 0,
        totalConfigs: 0,
        totalCommands: 0,
        eventBreakdown: {
          PreToolUse: 0,
          PostToolUse: 0,
          UserPromptSubmit: 0,
          Stop: 0,
        },
      };
    }

    const eventBreakdown: Record<HookEvent, number> = {
      PreToolUse: 0,
      PostToolUse: 0,
      UserPromptSubmit: 0,
      Stop: 0,
    };

    let totalConfigs = 0;
    let totalCommands = 0;

    Object.entries(this.configuration).forEach(([event, configs]) => {
      if (isValidHookEvent(event)) {
        eventBreakdown[event] = configs.length;
        totalConfigs += configs.length;
        totalCommands += configs.reduce(
          (sum, config) => sum + config.hooks.length,
          0,
        );
      }
    });

    return {
      totalEvents: Object.keys(this.configuration).length,
      totalConfigs,
      totalCommands,
      eventBreakdown,
    };
  }
}
