/**
 * Configuration Watcher Service
 *
 * Orchestrates live configuration reload functionality by coordinating file watching,
 * configuration validation, and error recovery. Provides automatic reload of settings.json
 * changes without restart.
 */

import { EventEmitter } from "events";
import { existsSync } from "fs";
import { FileWatcherService, type FileWatchEvent } from "./fileWatcher.js";
import { loadMergedWaveConfigWithFallback } from "./hook.js";
import type { WaveConfiguration, ValidationResult } from "../types/hooks.js";
import { isValidHookEvent, isValidHookEventConfig } from "../types/hooks.js";
import type { Logger } from "../types/index.js";
import {
  CONFIGURATION_EVENTS,
  FILE_WATCHER_EVENTS,
} from "../constants/events.js";

export interface ConfigurationChangeEvent {
  type: "settings_changed" | "memory_changed" | "env_changed";
  path: string;
  timestamp: number;
  changes: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  isValid: boolean;
  errorMessage?: string;
}

export interface ConfigurationReloadService {
  initializeWatching(
    userPaths: string[],
    projectPaths?: string[],
  ): Promise<void>;
  reloadConfiguration(): Promise<WaveConfiguration>;
  getCurrentConfiguration(): WaveConfiguration | null;
  validateEnvironmentVariables(env: Record<string, string>): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
  shutdown(): Promise<void>;
}

export class ConfigurationWatcher
  extends EventEmitter
  implements ConfigurationReloadService
{
  private fileWatcher: FileWatcherService;
  private logger?: Logger;
  private currentConfiguration: WaveConfiguration | null = null;
  private lastValidConfiguration: WaveConfiguration | null = null;
  private userConfigPaths?: string[];
  private projectConfigPaths?: string[];
  private workdir: string;
  private isWatching: boolean = false;
  private reloadInProgress: boolean = false;

  constructor(workdir: string, logger?: Logger) {
    super();
    this.workdir = workdir;
    this.logger = logger;
    this.fileWatcher = new FileWatcherService(logger);
    this.setupFileWatcherEvents();
  }

  /**
   * Initialize configuration watching
   * Maps to FR-004: System MUST watch settings.json files
   * Supports watching multiple file paths (e.g., settings.local.json and settings.json)
   */
  async initializeWatching(
    userPaths: string[],
    projectPaths?: string[],
  ): Promise<void> {
    try {
      this.logger?.info("Live Config: Initializing configuration watching...");

      this.userConfigPaths = userPaths;
      this.projectConfigPaths = projectPaths;

      // Load initial configuration
      await this.reloadConfiguration();

      // Start watching user configs that exist
      for (const userPath of userPaths) {
        if (existsSync(userPath)) {
          this.logger?.debug(
            `Live Config: Starting to watch user config: ${userPath}`,
          );
          await this.fileWatcher.watchFile(userPath, (event) =>
            this.handleFileChange(event, "user"),
          );
        } else {
          this.logger?.debug(
            `Live Config: User config file does not exist: ${userPath}`,
          );
        }
      }

      // Start watching project configs that exist
      if (projectPaths) {
        for (const projectPath of projectPaths) {
          if (existsSync(projectPath)) {
            this.logger?.debug(
              `Live Config: Starting to watch project config: ${projectPath}`,
            );
            await this.fileWatcher.watchFile(projectPath, (event) =>
              this.handleFileChange(event, "project"),
            );
          } else {
            this.logger?.debug(
              `Live Config: Project config file does not exist: ${projectPath}`,
            );
          }
        }
      }

      this.isWatching = true;
      this.logger?.info(
        "Live Config: Configuration watching initialized successfully",
      );
    } catch (error) {
      const errorMessage = `Failed to initialize configuration watching: ${(error as Error).message}`;
      this.logger?.error(`Live Config: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Reload configuration from files
   * Maps to FR-008: Continue with previous valid configuration on errors
   */
  async reloadConfiguration(): Promise<WaveConfiguration> {
    if (this.reloadInProgress) {
      this.logger?.debug("Live Config: Reload already in progress, skipping");
      return this.currentConfiguration || {};
    }

    this.reloadInProgress = true;

    try {
      this.logger?.debug("Live Config: Reloading configuration from files...");

      // Load merged configuration with fallback support
      const loadResult = loadMergedWaveConfigWithFallback(
        this.workdir,
        this.lastValidConfiguration,
      );
      const newConfig = loadResult.config;
      const timestamp = Date.now();

      // Check for errors during loading
      if (loadResult.errors.length > 0) {
        const errorMessage = `Configuration load errors: ${loadResult.errors.join("; ")}`;
        this.logger?.error(`Live Config: ${errorMessage}`);

        // Emit error event
        this.emit(CONFIGURATION_EVENTS.CONFIGURATION_CHANGE, {
          type: "settings_changed",
          path:
            this.getFirstExistingProjectPath() ||
            this.getFirstExistingUserPath() ||
            "unknown",
          timestamp,
          changes: { added: [], modified: [], removed: [] },
          isValid: false,
          errorMessage,
        } as ConfigurationChangeEvent);

        // Use fallback configuration if available
        if (loadResult.usedFallback && this.lastValidConfiguration) {
          this.logger?.warn(
            "Live Config: Using previous valid configuration due to load errors",
          );
          this.currentConfiguration = this.lastValidConfiguration;
          return this.currentConfiguration;
        } else {
          this.logger?.warn(
            "Live Config: No previous valid configuration available, using empty config",
          );
          this.currentConfiguration = {};
          return this.currentConfiguration;
        }
      }

      // Validate new configuration if it exists
      if (newConfig) {
        const validation = this.validateConfiguration(newConfig);
        if (!validation.valid) {
          const errorMessage = `Invalid configuration: ${validation.errors.join(", ")}`;
          this.logger?.error(`Live Config: ${errorMessage}`);

          // Emit error event but continue with previous valid config
          this.emit(CONFIGURATION_EVENTS.CONFIGURATION_CHANGE, {
            type: "settings_changed",
            path:
              this.getFirstExistingProjectPath() ||
              this.getFirstExistingUserPath() ||
              "unknown",
            timestamp,
            changes: { added: [], modified: [], removed: [] },
            isValid: false,
            errorMessage,
          } as ConfigurationChangeEvent);

          // Use previous valid configuration for error recovery
          if (this.lastValidConfiguration) {
            this.logger?.warn(
              "Live Config: Using previous valid configuration due to validation errors",
            );
            this.currentConfiguration = this.lastValidConfiguration;
            return this.currentConfiguration;
          } else {
            this.logger?.warn(
              "Live Config: No previous valid configuration available, using empty config",
            );
            this.currentConfiguration = {};
            return this.currentConfiguration;
          }
        }
      }

      // Detect changes between old and new configuration
      const changes = this.detectChanges(this.currentConfiguration, newConfig);

      // Update current configuration
      this.currentConfiguration = newConfig || {};

      // Save as last valid configuration if it's valid and not empty
      if (newConfig && (newConfig.hooks || newConfig.env)) {
        this.lastValidConfiguration = { ...newConfig };
      }

      this.logger?.info(
        `Live Config: Configuration reloaded successfully with ${Object.keys(newConfig?.hooks || {}).length} event types and ${Object.keys(newConfig?.env || {}).length} environment variables`,
      );

      // Emit configuration change event
      this.emit(CONFIGURATION_EVENTS.CONFIGURATION_CHANGE, {
        type: "settings_changed",
        path:
          this.getFirstExistingProjectPath() ||
          this.getFirstExistingUserPath() ||
          "merged",
        timestamp,
        changes,
        isValid: true,
      } as ConfigurationChangeEvent);

      return this.currentConfiguration;
    } catch (error) {
      const errorMessage = `Failed to reload configuration: ${(error as Error).message}`;
      this.logger?.error(`Live Config: ${errorMessage}`);

      // Use previous valid configuration for error recovery
      if (this.lastValidConfiguration) {
        this.logger?.warn(
          "Live Config: Using previous valid configuration due to reload error",
        );
        this.currentConfiguration = this.lastValidConfiguration;
      } else {
        this.logger?.warn(
          "Live Config: No previous valid configuration available, using empty config",
        );
        this.currentConfiguration = {};
      }

      // Emit error event
      this.emit(CONFIGURATION_EVENTS.CONFIGURATION_CHANGE, {
        type: "settings_changed",
        path: "reload-error",
        timestamp: Date.now(),
        changes: { added: [], modified: [], removed: [] },
        isValid: false,
        errorMessage,
      } as ConfigurationChangeEvent);

      return this.currentConfiguration;
    } finally {
      this.reloadInProgress = false;
    }
  }

  /**
   * Get current effective configuration
   * Maps to FR-002: Merged configuration with project precedence
   */
  getCurrentConfiguration(): WaveConfiguration | null {
    return this.currentConfiguration ? { ...this.currentConfiguration } : null;
  }

  /**
   * Validate environment variables
   * Maps to FR-003: Validate env field format
   */
  validateEnvironmentVariables(env: Record<string, string>): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof env !== "object" || env === null) {
      errors.push("Environment variables must be an object");
      return { isValid: false, errors, warnings };
    }

    if (Array.isArray(env)) {
      errors.push("Environment variables cannot be an array");
      return { isValid: false, errors, warnings };
    }

    for (const [key, value] of Object.entries(env)) {
      // Validate key format
      if (typeof key !== "string" || key.trim() === "") {
        errors.push(
          `Invalid environment variable key: '${key}' (must be non-empty string)`,
        );
        continue;
      }

      // Validate key naming convention (optional warning)
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        warnings.push(
          `Environment variable '${key}' doesn't follow conventional naming (A-Z, 0-9, underscore)`,
        );
      }

      // Validate value type
      if (typeof value !== "string") {
        errors.push(
          `Environment variable '${key}' must have a string value (got ${typeof value})`,
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Stop watching and cleanup resources
   * Maps to cleanup requirements
   */
  async shutdown(): Promise<void> {
    this.logger?.info("Live Config: Shutting down configuration watcher...");

    this.isWatching = false;

    try {
      await this.fileWatcher.cleanup();
      this.removeAllListeners();
      this.logger?.info(
        "Live Config: Configuration watcher shutdown completed",
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Error during shutdown: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Watch an additional file (like AGENTS.md) for changes
   * Maps to T033: Add AGENTS.md file watching to HookManager
   */
  async watchAdditionalFile(
    filePath: string,
    callback: (event: FileWatchEvent) => void,
  ): Promise<void> {
    try {
      await this.fileWatcher.watchFile(filePath, callback);
      this.logger?.info(
        `Live Config: Started watching additional file: ${filePath}`,
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to watch additional file ${filePath}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Stop watching an additional file
   */
  async unwatchAdditionalFile(filePath: string): Promise<void> {
    try {
      await this.fileWatcher.unwatchFile(filePath);
      this.logger?.info(
        `Live Config: Stopped watching additional file: ${filePath}`,
      );
    } catch (error) {
      this.logger?.warn(
        `Live Config: Failed to stop watching file ${filePath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Check if watching is active
   */
  isWatchingActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get watcher status for monitoring
   */
  getWatcherStatus() {
    const statuses = this.fileWatcher.getAllWatcherStatuses();
    return {
      isActive: this.isWatching,
      configurationLoaded: this.currentConfiguration !== null,
      hasValidConfiguration: this.lastValidConfiguration !== null,
      reloadInProgress: this.reloadInProgress,
      watchedFiles: statuses.map((s) => ({
        path: s.path,
        isActive: s.isActive,
        method: s.method,
        errorCount: s.errorCount,
      })),
    };
  }

  private setupFileWatcherEvents(): void {
    this.fileWatcher.on("watcherError", (error: Error) => {
      this.logger?.error(`Live Config: File watcher error: ${error.message}`);
      this.emit(CONFIGURATION_EVENTS.WATCHER_ERROR, error);
    });
  }

  private async handleFileChange(
    event: FileWatchEvent,
    source: "user" | "project",
  ): Promise<void> {
    this.logger?.debug(
      `Live Config: File ${event.type} detected for ${source} config: ${event.path}`,
    );

    try {
      // Handle file deletion
      if (event.type === FILE_WATCHER_EVENTS.DELETE) {
        this.logger?.info(
          `Live Config: ${source} config file deleted: ${event.path}`,
        );
        // Reload configuration without the deleted file
        await this.reloadConfiguration();
        return;
      }

      // Handle file creation or modification
      if (
        event.type === FILE_WATCHER_EVENTS.CHANGE ||
        event.type === FILE_WATCHER_EVENTS.CREATE
      ) {
        this.logger?.info(
          `Live Config: ${source} config file ${event.type}: ${event.path}`,
        );

        // Add small delay to ensure file write is complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Reload configuration
        await this.reloadConfiguration();
      }
    } catch (error) {
      this.logger?.error(
        `Live Config: Error handling file change for ${source} config: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Validate configuration structure and content
   */
  private validateConfiguration(config: WaveConfiguration): ValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    // Validate hooks if present
    if (config.hooks) {
      if (typeof config.hooks !== "object") {
        errors.push("hooks property must be an object");
      } else {
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
            if (!isValidHookEventConfig(eventConfig)) {
              errors.push(
                `Invalid hook event configuration at ${eventName}[${index}]`,
              );
            }
          });
        }
      }
    }

    // Validate environment variables if present
    if (config.env) {
      if (typeof config.env !== "object" || Array.isArray(config.env)) {
        errors.push("env property must be an object");
      } else {
        for (const [key, value] of Object.entries(config.env)) {
          if (typeof key !== "string" || key.trim() === "") {
            errors.push(`Invalid environment variable key: ${key}`);
          }
          if (typeof value !== "string") {
            errors.push(`Environment variable ${key} must have a string value`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private detectChanges(
    oldConfig: WaveConfiguration | null,
    newConfig: WaveConfiguration | null,
  ): {
    added: string[];
    modified: string[];
    removed: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // Handle environment variables changes
    const oldEnv = oldConfig?.env || {};
    const newEnv = newConfig?.env || {};

    for (const key of Object.keys(newEnv)) {
      if (!(key in oldEnv)) {
        added.push(`env.${key}`);
      } else if (oldEnv[key] !== newEnv[key]) {
        modified.push(`env.${key}`);
      }
    }

    for (const key of Object.keys(oldEnv)) {
      if (!(key in newEnv)) {
        removed.push(`env.${key}`);
      }
    }

    // Handle hooks changes (simplified)
    const oldHooks = oldConfig?.hooks || {};
    const newHooks = newConfig?.hooks || {};

    for (const event of Object.keys(newHooks)) {
      if (isValidHookEvent(event)) {
        if (!(event in oldHooks)) {
          added.push(`hooks.${event}`);
        } else if (
          JSON.stringify(oldHooks[event]) !== JSON.stringify(newHooks[event])
        ) {
          modified.push(`hooks.${event}`);
        }
      }
    }

    for (const event of Object.keys(oldHooks)) {
      if (isValidHookEvent(event) && !(event in newHooks)) {
        removed.push(`hooks.${event}`);
      }
    }

    return { added, modified, removed };
  }

  /**
   * Get the first existing user config path for error reporting
   */
  private getFirstExistingUserPath(): string | undefined {
    return (
      this.userConfigPaths?.find((path) => existsSync(path)) ||
      this.userConfigPaths?.[0]
    );
  }

  /**
   * Get the first existing project config path for error reporting
   */
  private getFirstExistingProjectPath(): string | undefined {
    return (
      this.projectConfigPaths?.find((path) => existsSync(path)) ||
      this.projectConfigPaths?.[0]
    );
  }
}
