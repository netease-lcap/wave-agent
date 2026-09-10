/**
 * Live Configuration Manager
 *
 * Orchestrates live configuration reload functionality including:
 * - Hook configuration watching and reloading
 * - Configuration file watching for settings.json files
 * - Coordination between file watchers and configuration updates
 */

import { existsSync } from "fs";
import { dirname } from "path";
import type { Scope } from "../types/configuration.js";
import {
  FileWatcherService,
  type FileWatchEvent,
} from "../services/fileWatcher.js";
import type { HookManager } from "./hookManager.js";
import type { PermissionManager } from "./permissionManager.js";
import type { MemoryService } from "../services/memory.js";
import { USER_MEMORY_FILE } from "../utils/constants.js";
import { isValidHookEvent } from "../types/hooks.js";
import { ConfigurationService } from "../services/configurationService.js";
import type { TurnConfigurationSnapshot } from "../services/configurationService.js";
import { Container } from "../utils/container.js";

import type {
  ConfigurationLoadResult,
  WaveConfiguration,
} from "../types/configuration.js";

import { logger } from "../utils/globalLogger.js";

export interface LiveConfigManagerOptions {
  workdir: string;
  onReload?: (config: WaveConfiguration) => void | Promise<void>;
}

export class LiveConfigManager {
  private readonly workdir: string;
  private isInitialized: boolean = false;

  // Configuration state
  private currentConfiguration: WaveConfiguration | null = null;
  private lastValidConfiguration: WaveConfiguration | null = null;

  // Turn-scoped snapshot of the settings.json-derived configuration the running
  // turn reads from. Captured at turn start, dropped at turn end, so a live
  // reload landing mid-turn takes effect at the next turn instead of shifting
  // values under the running one (core/agent-config.md scenario 5). Nested turns
  // (a subagent turn inside its parent's) share the outer snapshot.
  private turnSnapshot: TurnConfigurationSnapshot | null = null;
  private turnDepth: number = 0;

  // File watching state
  private fileWatcher: FileWatcherService;
  private userConfigPaths?: string[];
  private projectConfigPaths?: string[];
  private isWatching: boolean = false;
  private reloadInProgress: boolean = false;

  constructor(
    private container: Container,
    private options: LiveConfigManagerOptions,
  ) {
    this.workdir = options.workdir;
    this.fileWatcher = new FileWatcherService(logger);
    this.setupFileWatcherEvents();
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get permissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  private get memoryService(): MemoryService | undefined {
    return this.container.get<MemoryService>("MemoryService");
  }

  /**
   * Keep the auto-memory system safe zone in sync with the live auto-memory
   * toggle (core/agent-config.md scenario 6). Turning auto-memory off must
   * revoke the privilege its directory got at construction time, and turning it
   * back on must restore it — both without rebuilding the session. Idempotent:
   * the underlying add/remove are dedup'ed by path.
   */
  private syncAutoMemorySafeZone(): void {
    const permissionManager = this.permissionManager;
    const memoryService = this.memoryService;
    if (!permissionManager || !memoryService) {
      return;
    }

    const directories = [
      memoryService.getAutoMemoryDirectory(this.workdir),
      USER_MEMORY_FILE,
    ];
    const enabled = this.configurationService.resolveAutoMemoryEnabledNow();

    for (const directory of directories) {
      if (enabled) {
        permissionManager.addSystemAdditionalDirectory(directory);
      } else {
        permissionManager.removeSystemAdditionalDirectory(directory);
      }
    }
  }

  /**
   * Initialize configuration watching
   * Maps to FR-004: System MUST watch settings.json files
   * Supports watching multiple file paths (e.g., local settings.local.json and settings.json)
   */
  private async initializeWatching(
    userPaths: string[],
    projectPaths?: string[],
  ): Promise<void> {
    try {
      this.userConfigPaths = userPaths;
      this.projectConfigPaths = projectPaths;

      // Load initial configuration
      await this.reloadConfiguration();

      // Watch every configuration path, including ones that don't exist yet:
      // chokidar delivers `add` once a missing path appears, but only if its
      // parent chain exists when watching starts. Skipping absent paths (the
      // pre-2026-09-10 behavior) silently dropped the very first save of a
      // user-level settings.json created after session start
      // (core/agent-config.md scenario 7).
      for (const userPath of userPaths) {
        await this.fileWatcher.watchFile(
          this.resolveWatchTarget(userPath),
          (event) => this.handleFileChange(event, "user"),
        );
      }

      if (projectPaths) {
        for (const projectPath of projectPaths) {
          await this.fileWatcher.watchFile(
            this.resolveWatchTarget(projectPath),
            (event) => this.handleFileChange(event, "project"),
          );
        }
      }

      this.isWatching = true;
    } catch (error) {
      const errorMessage = `Failed to initialize configuration watching: ${(error as Error).message}`;
      logger?.error(`Live Config: ${errorMessage}`);
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
      return;
    }

    try {
      // Get configuration file paths
      const { userPaths, projectPaths } = this.getConfigurationPaths();

      // Initialize configuration watching
      await this.initializeWatching(userPaths, projectPaths);

      this.isInitialized = true;
    } catch (error) {
      logger?.error(`Failed to initialize: ${(error as Error).message}`);
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
      this.isWatching = false;

      // Cleanup file watcher
      await this.fileWatcher.cleanup();

      // Clean up state
      this.currentConfiguration = null;
      this.lastValidConfiguration = null;

      this.isInitialized = false;
    } catch (error) {
      logger?.error(`Error during shutdown: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Turn boundary: pin the settings.json-derived configuration for the duration
   * of a turn (called by AIManager). A live reload may land mid-turn and the
   * turn must not see it (core/agent-config.md scenario 5) — the change is
   * picked up by the snapshot taken when the next turn starts. Permission rules,
   * hooks and env stay live: those are enforcement state and follow the file
   * immediately.
   */
  onTurnStart(): void {
    if (this.turnDepth === 0) {
      const configuration = this.getCurrentConfiguration();
      this.turnSnapshot = {
        configuration: configuration ? structuredClone(configuration) : null,
        // `env` on the merged configuration is exactly what was published as the
        // session env snapshot when it was loaded (both come from the same
        // merge), so the snapshot carries both without querying the service.
        env: { ...(configuration?.env ?? {}) },
      };
    }
    this.turnDepth++;
  }

  /** Turn boundary: drop the snapshot so the next turn reads live values. */
  onTurnEnd(): void {
    if (this.turnDepth === 0) {
      return;
    }
    this.turnDepth--;
    if (this.turnDepth === 0) {
      this.turnSnapshot = null;
    }
  }

  /** Configuration snapshot of the running turn, or null outside a turn. */
  getTurnSnapshot(): TurnConfigurationSnapshot | null {
    return this.turnDepth > 0 ? this.turnSnapshot : null;
  }

  /**
   * Reload configuration from files
   * Maps to FR-008: Continue with previous valid configuration on errors
   */
  private async reloadConfiguration(): Promise<WaveConfiguration> {
    if (this.reloadInProgress) {
      return this.currentConfiguration || {};
    }

    this.reloadInProgress = true;

    try {
      // Load merged configuration using ConfigurationService
      const loadResult: ConfigurationLoadResult =
        await this.configurationService.loadMergedConfiguration(this.workdir);
      const newConfig = loadResult.configuration;

      // Check for errors during loading
      if (!loadResult.success) {
        const errorMessage =
          loadResult.error || "Configuration loading failed with unknown error";
        logger?.error(
          `Live Config: Configuration loading failed: ${errorMessage}`,
        );

        // Log warnings if any
        if (loadResult.warnings && loadResult.warnings.length > 0) {
          logger?.warn(
            `Live Config: Configuration warnings: ${loadResult.warnings.join("; ")}`,
          );
        }

        // Use fallback configuration if available
        if (this.lastValidConfiguration) {
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
          logger?.warn(
            "Live Config: No previous valid configuration available, using empty config",
          );
          this.currentConfiguration = {};
          return this.currentConfiguration;
        }
      }

      // Log warnings from successful loading
      if (loadResult.warnings && loadResult.warnings.length > 0) {
        logger?.warn(
          `Live Config: Configuration warnings: ${loadResult.warnings.join("; ")}`,
        );
      }

      // Detect changes between old and new configuration
      this.detectChanges(this.currentConfiguration, newConfig);

      // Update current configuration
      this.currentConfiguration = newConfig || {};

      // Save as last valid configuration if it's valid and not empty
      if (newConfig && (newConfig.hooks || newConfig.env)) {
        this.lastValidConfiguration = { ...newConfig };
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
        this.permissionManager.updateConfiguredPermissionMode(
          this.currentConfiguration.permissions?.defaultMode,
        );
        this.permissionManager.updateAllowedRules(
          this.currentConfiguration.permissions?.allow || [],
        );
        this.permissionManager.updateDeniedRules(
          this.currentConfiguration.permissions?.deny || [],
        );
        this.permissionManager.updateAdditionalDirectories(
          this.currentConfiguration.permissions?.additionalDirectories || [],
        );
        this.syncAutoMemorySafeZone();
      }

      // Trigger reload callback. Awaited so fire-and-forget work spawned by the
      // callback (e.g. skill rediscovery) completes before the reload resolves —
      // otherwise Agent.create() can return while a skill rescan is still
      // running (refreshSkills swaps caches atomically only after the scan).
      await this.options.onReload?.(this.currentConfiguration);

      return this.currentConfiguration;
    } catch (error) {
      const errorMessage = `Configuration reload failed with exception: ${(error as Error).message}`;
      logger?.error(`Live Config: ${errorMessage}`);

      // Use previous valid configuration for error recovery
      if (this.lastValidConfiguration) {
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
        logger?.warn(
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
      logger?.error(`Live Config: File watcher error: ${error.message}`);
    });
  }

  private async handleFileChange(
    event: FileWatchEvent,
    source: Scope,
  ): Promise<void> {
    try {
      // Handle file deletion
      if (event.type === "delete") {
        // Reload configuration without the deleted file
        await this.reloadConfiguration();
        return;
      }

      // Handle file creation or modification
      if (event.type === "change" || event.type === "create") {
        // Add small delay to ensure file write is complete
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Reload configuration
        await this.reloadConfiguration();
      }
    } catch (error) {
      logger?.error(
        `Live Config: Error handling file change for ${source} config: ${(error as Error).message}`,
      );
    }
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
   * Chokidar only starts watching a non-existent path when its parent directory
   * exists at watch time (a path whose parents are all missing is never
   * picked up, not even after they appear). Walk up to the deepest node whose
   * parent exists and watch that instead — events for its descendants still
   * reach this path's callback (FileWatcherService matches by path prefix).
   */
  private resolveWatchTarget(configPath: string): string {
    let candidate = configPath;
    while (!existsSync(dirname(candidate))) {
      const parent = dirname(candidate);
      if (parent === candidate) {
        // Reached the filesystem root without an existing parent: nothing to
        // watch (unreachable for absolute paths).
        return configPath;
      }
      candidate = parent;
    }
    return candidate;
  }

  /**
   * Get configuration file paths for user and project settings
   * Returns paths in priority order (local.json first, then .json)
   */
  private getConfigurationPaths(): {
    userPaths: string[];
    projectPaths: string[];
  } {
    const paths = this.configurationService.getConfigurationPaths(this.workdir);
    return {
      userPaths: paths.userPaths,
      projectPaths: paths.projectPaths,
    };
  }
}
