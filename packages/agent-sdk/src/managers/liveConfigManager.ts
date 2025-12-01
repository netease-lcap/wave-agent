/**
 * Live Configuration Manager
 *
 * Orchestrates live configuration reload functionality including:
 * - Hook configuration watching and reloading
 * - Memory store management for AGENTS.md files
 * - Coordination between file watchers and configuration updates
 */

import type { Logger } from "../types/index.js";
import {
  ConfigurationWatcher,
  type ConfigurationChangeEvent,
} from "../services/configurationWatcher.js";

import { type FileWatchEvent } from "../services/fileWatcher.js";
import { configResolver } from "../utils/configResolver.js";
import { join } from "path";
import { homedir } from "os";
import { CONFIGURATION_EVENTS } from "../constants/events.js";

export interface LiveConfigManagerOptions {
  workdir: string;
  logger?: Logger;
  onConfigurationChanged?: () => void; // Callback for when configuration changes
  onMemoryStoreFileChanged?: (
    filePath: string,
    changeType: "add" | "change" | "unlink",
  ) => Promise<void>; // Callback for memory store file changes
}

export class LiveConfigManager {
  private readonly workdir: string;
  private readonly logger?: Logger;
  private readonly onConfigurationChanged?: () => void;
  private readonly onMemoryStoreFileChanged?: (
    filePath: string,
    changeType: "add" | "change" | "unlink",
  ) => Promise<void>;
  private configurationWatcher?: ConfigurationWatcher;
  private isInitialized: boolean = false;

  constructor(options: LiveConfigManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
    this.onConfigurationChanged = options.onConfigurationChanged;
    this.onMemoryStoreFileChanged = options.onMemoryStoreFileChanged;
  }

  /**
   * Initialize live configuration management
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger?.debug("[LiveConfigManager] Already initialized");
      return;
    }

    try {
      // Initialize configuration watcher for hook settings
      await this.initializeConfigurationWatcher();

      // Initialize memory store watching for AGENTS.md if callback is available
      if (this.onMemoryStoreFileChanged) {
        await this.initializeMemoryStoreWatching();
      }

      this.isInitialized = true;
      this.logger?.info(
        "Live Config: Live configuration management initialized successfully",
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to initialize: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Shutdown live configuration management
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      if (this.configurationWatcher) {
        await this.configurationWatcher.shutdown();
        this.configurationWatcher = undefined;
      }

      this.isInitialized = false;
      this.logger?.info(
        "Live Config: Live configuration management shutdown completed",
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Error during shutdown: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Initialize configuration watcher for hook settings
   */
  private async initializeConfigurationWatcher(): Promise<void> {
    this.configurationWatcher = new ConfigurationWatcher(
      this.workdir,
      this.logger,
    );

    // Set up configuration change handler using EventEmitter pattern
    this.configurationWatcher.on(
      CONFIGURATION_EVENTS.CONFIGURATION_CHANGE,
      (event: ConfigurationChangeEvent) => {
        this.handleConfigurationChange(event);
      },
    );

    // Initialize watching for user and project settings
    const { userPath, projectPath } = this.getConfigurationPaths();
    await this.configurationWatcher.initializeWatching(userPath, projectPath);
    this.logger?.info("Live Config: Configuration watching initialized");
  }

  /**
   * Initialize memory store watching for AGENTS.md files
   */
  private async initializeMemoryStoreWatching(): Promise<void> {
    if (!this.onMemoryStoreFileChanged || !this.configurationWatcher) {
      this.logger?.debug(
        "Live Config: Memory store callback or configuration watcher not available, skipping AGENTS.md watching",
      );
      return;
    }

    try {
      const agentsFilePath = join(this.workdir, "AGENTS.md");

      // Add AGENTS.md to file watcher
      await this.configurationWatcher.watchAdditionalFile(
        agentsFilePath,
        async (event: FileWatchEvent) => {
          await this.handleMemoryStoreFileChange(event);
        },
      );

      this.logger?.info("Live Config: AGENTS.md file watching initialized");
    } catch (error) {
      this.logger?.warn(
        `Live Config: Failed to initialize AGENTS.md watching: ${(error as Error).message}`,
      );
      // Don't throw - memory optimization is not critical for core functionality
    }
  }

  /**
   * Handle configuration change events
   */
  private handleConfigurationChange(event: ConfigurationChangeEvent): void {
    this.logger?.info(
      `Live Config: Configuration change detected: ${event.type} at ${event.path}`,
    );

    // Invalidate and refresh configuration cache for live environment variable updates
    configResolver.invalidateCache(this.workdir);
    configResolver.refreshCache(this.workdir);

    // Trigger Agent configuration update callback if provided
    if (this.onConfigurationChanged) {
      try {
        this.logger?.info("Live Config: Triggering Agent configuration update");
        this.onConfigurationChanged();
      } catch (error) {
        this.logger?.error(
          `Live Config: Error in configuration change callback: ${(error as Error).message}`,
        );
      }
    }

    // Log cache status after refresh
    const cacheStatus = configResolver.getCacheStatus();
    if (cacheStatus) {
      this.logger?.info(
        `Live Config: Configuration cache refreshed - ${cacheStatus.envVarCount} environment variables loaded`,
      );
    }
  }

  /**
   * Handle AGENTS.md file change events
   */
  private async handleMemoryStoreFileChange(
    event: FileWatchEvent,
  ): Promise<void> {
    if (!this.onMemoryStoreFileChanged) {
      return;
    }

    try {
      this.logger?.info(
        `Live Config: AGENTS.md ${event.type} detected: ${event.path}`,
      );

      const changeType: "add" | "change" | "unlink" =
        event.type === "delete"
          ? "unlink"
          : event.type === "create"
            ? "add"
            : "change";
      await this.onMemoryStoreFileChanged(event.path, changeType);

      this.logger?.info(
        `Live Config: Memory store updated for AGENTS.md ${event.type}`,
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to handle AGENTS.md file change: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get initialization status
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get configuration file paths for user and project settings
   */
  private getConfigurationPaths(): { userPath: string; projectPath: string } {
    const userPath = join(homedir(), ".config", "wave", "settings.json");
    const projectPath = join(this.workdir, ".wave", "settings.json");
    return { userPath, projectPath };
  }
}
