/**
 * Live Configuration Manager
 *
 * Orchestrates live configuration reload functionality including:
 * - Hook configuration watching and reloading
 * - Configuration file watching for settings.json files
 * - Coordination between file watchers and configuration updates
 */

import { existsSync } from "fs";
import type { Logger } from "../types/index.js";
import {
  FileWatcherService,
  type FileWatchEvent,
} from "../services/fileWatcher.js";
import type { HookManager } from "./hookManager.js";
import type { PermissionManager } from "./permissionManager.js";
import {
  getProjectConfigPaths,
  getUserConfigPaths,
} from "@/utils/configPaths.js";
import type {
  WaveConfiguration,
  HookValidationResult,
} from "../types/hooks.js";
import { isValidHookEvent, isValidHookEventConfig } from "../types/hooks.js";
import { ConfigurationService } from "../services/configurationService.js";
import { ensureGlobalGitIgnore } from "../utils/fileUtils.js";

import type { ConfigurationLoadResult } from "../types/configuration.js";

export interface LiveConfigManagerOptions {
  workdir: string;
  logger?: Logger;
  hookManager?: HookManager;
  permissionManager?: PermissionManager;
  configurationService?: ConfigurationService;
}

export class LiveConfigManager {
  private readonly workdir: string;
  private readonly logger?: Logger;
  private readonly hookManager?: HookManager;
  private readonly permissionManager?: PermissionManager;
  private isInitialized: boolean = false;
  private readonly configurationService: ConfigurationService;

  // Configuration state
  private currentConfiguration: WaveConfiguration | null = null;
  private lastValidConfiguration: WaveConfiguration | null = null;

  // File watching state
  private fileWatcher: FileWatcherService;
  private userConfigPaths?: string[];
  private projectConfigPaths?: string[];
  private isWatching: boolean = false;
  private reloadInProgress: boolean = false;

  constructor(options: LiveConfigManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
    this.hookManager = options.hookManager;
    this.permissionManager = options.permissionManager;
    this.configurationService =
      options.configurationService || new ConfigurationService();
    this.fileWatcher = new FileWatcherService(this.logger);
    this.setupFileWatcherEvents();
  }

  /**
   * Initialize configuration watching
   * Maps to FR-004: System MUST watch settings.json files
   * Supports watching multiple file paths (e.g., settings.local.json and settings.json)
   */
  private async initializeWatching(
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
            if (projectPath.endsWith("settings.local.json")) {
              await ensureGlobalGitIgnore("**/.wave/settings.local.json");
            }
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
   * Get current configuration
   */
  getCurrentConfiguration(): WaveConfiguration | null {
    return this.currentConfiguration ? { ...this.currentConfiguration } : null;
  }

  /**
   * Initialize configuration management with file watching
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger?.debug("Already initialized");
      return;
    }

    try {
      // Get configuration file paths
      const { userPaths, projectPaths } = this.getConfigurationPaths();

      // Initialize configuration watching
      await this.initializeWatching(userPaths, projectPaths);

      this.isInitialized = true;
      this.logger?.info(
        "Live configuration management initialized with file watching",
      );
    } catch (error) {
      this.logger?.error(`Failed to initialize: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Shutdown configuration management and cleanup resources
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      this.logger?.info("Live Config: Shutting down configuration manager...");

      this.isWatching = false;

      // Cleanup file watcher
      await this.fileWatcher.cleanup();

      // Clean up state
      this.currentConfiguration = null;
      this.lastValidConfiguration = null;

      this.isInitialized = false;
      this.logger?.info("Live configuration management shutdown completed");
    } catch (error) {
      this.logger?.error(`Error during shutdown: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Reload configuration from files
   * Maps to FR-008: Continue with previous valid configuration on errors
   */
  private async reloadConfiguration(): Promise<WaveConfiguration> {
    if (this.reloadInProgress) {
      this.logger?.debug("Live Config: Reload already in progress, skipping");
      return this.currentConfiguration || {};
    }

    this.reloadInProgress = true;

    try {
      this.logger?.debug("Live Config: Reloading configuration from files...");

      // Load merged configuration using ConfigurationService
      const loadResult: ConfigurationLoadResult =
        await this.configurationService.loadMergedConfiguration(this.workdir);
      const newConfig = loadResult.configuration;

      // Check for errors during loading
      if (!loadResult.success) {
        const errorMessage =
          loadResult.error || "Configuration loading failed with unknown error";
        this.logger?.error(
          `Live Config: Configuration loading failed: ${errorMessage}`,
        );

        // Log warnings if any
        if (loadResult.warnings && loadResult.warnings.length > 0) {
          this.logger?.warn(
            `Live Config: Configuration warnings: ${loadResult.warnings.join("; ")}`,
          );
        }

        // Use fallback configuration if available
        if (this.lastValidConfiguration) {
          this.logger?.info(
            "Live Config: Using previous valid configuration due to loading errors",
          );
          this.currentConfiguration = this.lastValidConfiguration;

          // Apply environment variables to configuration service if configured
          if (this.lastValidConfiguration.env) {
            this.configurationService.setEnvironmentVars(
              this.lastValidConfiguration.env,
            );
          }

          // Update hook manager if available
          if (this.hookManager) {
            this.hookManager.loadConfigurationFromWaveConfig(
              this.lastValidConfiguration,
            );
          }

          return this.currentConfiguration;
        } else {
          this.logger?.warn(
            "Live Config: No previous valid configuration available, using empty config",
          );
          this.currentConfiguration = {};
          return this.currentConfiguration;
        }
      }

      // Log success with detailed information
      if (newConfig) {
        this.logger?.info(
          `Live Config: Configuration loaded successfully from ${loadResult.sourcePath || "merged sources"}`,
        );

        // Log detailed configuration info
        const hookCount = Object.keys(newConfig.hooks || {}).length;
        const envCount = Object.keys(newConfig.env || {}).length;
        this.logger?.debug(
          `Live Config: Loaded ${hookCount} hook events and ${envCount} environment variables`,
        );
      } else {
        this.logger?.info(
          "Live Config: No configuration found (using empty configuration)",
        );
      }

      // Log warnings from successful loading
      if (loadResult.warnings && loadResult.warnings.length > 0) {
        this.logger?.warn(
          `Live Config: Configuration warnings: ${loadResult.warnings.join("; ")}`,
        );
      }

      // Validate new configuration if it exists
      if (newConfig) {
        const validation = this.validateConfiguration(newConfig);
        if (!validation.valid) {
          const errorMessage = `Configuration validation failed: ${validation.errors.join(", ")}`;
          this.logger?.error(`Live Config: ${errorMessage}`);

          // Use previous valid configuration for error recovery
          if (this.lastValidConfiguration) {
            this.logger?.info(
              "Live Config: Using previous valid configuration due to validation errors",
            );
            this.currentConfiguration = this.lastValidConfiguration;

            // Apply environment variables to configuration service if configured
            if (this.lastValidConfiguration.env) {
              this.configurationService.setEnvironmentVars(
                this.lastValidConfiguration.env,
              );
            }

            // Update hook manager if available
            if (this.hookManager) {
              this.hookManager.loadConfigurationFromWaveConfig(
                this.lastValidConfiguration,
              );
            }

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
      this.detectChanges(this.currentConfiguration, newConfig);

      // Update current configuration
      this.currentConfiguration = newConfig || {};

      // Save as last valid configuration if it's valid and not empty
      if (newConfig && (newConfig.hooks || newConfig.env)) {
        this.lastValidConfiguration = { ...newConfig };
        this.logger?.debug(
          "Live Config: Saved current configuration as last valid backup",
        );
      }

      // Note: Environment variables are already applied by loadMergedConfiguration()
      // No need to set them again here as currentConfiguration === newConfig

      // Update hook manager if available
      if (this.hookManager) {
        this.hookManager.loadConfigurationFromWaveConfig(
          this.currentConfiguration,
        );
      }

      // Update permission manager if available
      if (this.permissionManager) {
        if (this.currentConfiguration.permissions?.defaultMode) {
          this.permissionManager.updateConfiguredDefaultMode(
            this.currentConfiguration.permissions.defaultMode,
          );
        }
        if (this.currentConfiguration.permissions?.allow) {
          this.permissionManager.updateAllowedRules(
            this.currentConfiguration.permissions.allow,
          );
        }
      }

      this.logger?.info(
        `Live Config: Configuration reload completed successfully with ${Object.keys(newConfig?.hooks || {}).length} event types and ${Object.keys(newConfig?.env || {}).length} environment variables`,
      );

      return this.currentConfiguration;
    } catch (error) {
      const errorMessage = `Configuration reload failed with exception: ${(error as Error).message}`;
      this.logger?.error(`Live Config: ${errorMessage}`);

      // Use previous valid configuration for error recovery
      if (this.lastValidConfiguration) {
        this.logger?.info(
          "Live Config: Using previous valid configuration due to reload exception",
        );
        this.currentConfiguration = this.lastValidConfiguration;

        // Apply environment variables to configuration service if configured
        if (this.lastValidConfiguration.env) {
          this.configurationService.setEnvironmentVars(
            this.lastValidConfiguration.env,
          );
        }

        // Update hook manager if available
        if (this.hookManager) {
          this.hookManager.loadConfigurationFromWaveConfig(
            this.lastValidConfiguration,
          );
        }
      } else {
        this.logger?.warn(
          "Live Config: No previous valid configuration available, using empty config",
        );
        this.currentConfiguration = {};
      }

      return this.currentConfiguration;
    } finally {
      this.reloadInProgress = false;
    }
  }

  /**
   * Reload configuration from files (public method)
   */
  async reload(): Promise<WaveConfiguration> {
    this.logger?.info("Manually reloading configuration...");
    return await this.reloadConfiguration();
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
      if (event.type === "delete") {
        this.logger?.info(
          `Live Config: ${source} config file deleted: ${event.path}`,
        );
        // Reload configuration without the deleted file
        await this.reloadConfiguration();
        return;
      }

      // Handle file creation or modification
      if (event.type === "change" || event.type === "create") {
        this.logger?.info(
          `Live Config: ${source} config file ${event.type}: ${event.path}`,
        );

        if (
          source === "project" &&
          event.path.endsWith("settings.local.json") &&
          event.type === "create"
        ) {
          await ensureGlobalGitIgnore("**/.wave/settings.local.json");
        }

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
  private validateConfiguration(
    config: WaveConfiguration,
  ): HookValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Configuration must be an object"] };
    }

    // Validate permissions if present
    if (config.permissions) {
      if (typeof config.permissions !== "object") {
        errors.push("permissions property must be an object");
      } else {
        // Validate defaultMode if present
        if (config.permissions.defaultMode !== undefined) {
          if (
            config.permissions.defaultMode !== "default" &&
            config.permissions.defaultMode !== "bypassPermissions" &&
            config.permissions.defaultMode !== "acceptEdits"
          ) {
            errors.push(
              `Invalid defaultMode: "${config.permissions.defaultMode}". Must be "default", "bypassPermissions" or "acceptEdits"`,
            );
          }
        }

        // Validate allow if present
        if (config.permissions.allow) {
          if (!Array.isArray(config.permissions.allow)) {
            errors.push("permissions.allow must be an array");
          }
        }
      }
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
   * Get configuration file paths for user and project settings
   * Returns paths in priority order (local.json first, then .json)
   */
  private getConfigurationPaths(): {
    userPaths: string[];
    projectPaths: string[];
  } {
    const userPaths = getUserConfigPaths();
    const projectPaths = getProjectConfigPaths(this.workdir);
    return { userPaths, projectPaths };
  }
}
