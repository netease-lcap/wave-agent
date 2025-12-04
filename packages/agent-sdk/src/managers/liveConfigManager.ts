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
import { MemoryStoreService } from "../services/memoryStore.js";
import { type FileWatchEvent } from "../services/fileWatcher.js";
import { join } from "path";
import type { HookManager } from "./hookManager.js";
import {
  getProjectConfigPaths,
  getUserConfigPaths,
} from "@/utils/configPaths.js";
import { loadMergedWaveConfig } from "../services/hook.js";

export interface LiveConfigManagerOptions {
  workdir: string;
  logger?: Logger;
  hookManager?: HookManager;
  memoryStore?: MemoryStoreService;
}

export class LiveConfigManager {
  private readonly workdir: string;
  private readonly logger?: Logger;
  private readonly hookManager?: HookManager;
  private readonly memoryStore?: MemoryStoreService;
  private configurationWatcher?: ConfigurationWatcher;
  private isInitialized: boolean = false;

  constructor(options: LiveConfigManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
    this.hookManager = options.hookManager;
    this.memoryStore = options.memoryStore;
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

      // Initialize memory store watching for AGENTS.md if available
      if (this.memoryStore) {
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
    if (!this.hookManager) {
      this.logger?.debug(
        "Live Config: No hook manager provided, skipping configuration watching",
      );
      return;
    }

    this.configurationWatcher = new ConfigurationWatcher(
      this.workdir,
      this.logger,
    );

    // Set up configuration change handler using EventEmitter pattern
    this.configurationWatcher.on(
      "configurationChange",
      (event: ConfigurationChangeEvent) => {
        this.handleConfigurationChange(event);
      },
    );

    // Initialize watching for user and project settings
    const { userPaths, projectPaths } = this.getConfigurationPaths();
    await this.configurationWatcher.initializeWatching(userPaths, projectPaths);
    this.logger?.info("Live Config: Configuration watching initialized");
  }

  /**
   * Initialize memory store watching for AGENTS.md files
   */
  private async initializeMemoryStoreWatching(): Promise<void> {
    if (!this.memoryStore || !this.configurationWatcher) {
      this.logger?.debug(
        "Live Config: Memory store or configuration watcher not available, skipping AGENTS.md watching",
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

    // Update process.env from settings.json
    this.updateEnvironmentFromSettings();

    if (this.hookManager) {
      try {
        // Delegate to hook manager for hook-specific configuration reloading
        this.hookManager.loadConfigurationFromSettings();
        this.logger?.info(
          "Live Config: Hook configuration reloaded successfully",
        );
      } catch (error) {
        this.logger?.error(
          `Live Config: Failed to reload hook configuration: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Handle AGENTS.md file change events
   */
  private async handleMemoryStoreFileChange(
    event: FileWatchEvent,
  ): Promise<void> {
    if (!this.memoryStore) {
      return;
    }

    try {
      this.logger?.info(
        `Live Config: AGENTS.md ${event.type} detected: ${event.path}`,
      );

      if (event.type === "delete") {
        // Handle file deletion gracefully
        this.memoryStore.removeContent(event.path);
        this.logger?.info(
          "Live Config: Removed AGENTS.md from memory store due to file deletion",
        );
      } else {
        // Update memory store content
        await this.memoryStore.updateContent(event.path);
        this.logger?.info(
          "Live Config: Updated AGENTS.md content in memory store",
        );
      }
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
   * Update process.env from merged settings.json files
   */
  private updateEnvironmentFromSettings(): void {
    try {
      // Load merged Wave configuration (includes environment variables)
      const waveConfig = loadMergedWaveConfig(this.workdir);

      if (!waveConfig || !waveConfig.env) {
        this.logger?.debug(
          "Live Config: No environment configuration found in settings",
        );
        return;
      }

      // Update process.env with environment variables from settings.json
      for (const [key, value] of Object.entries(waveConfig.env)) {
        if (typeof value === "string") {
          process.env[key] = value;
          this.logger?.debug(`Live Config: Updated process.env.${key}`);
        }
      }

      this.logger?.info(
        "Live Config: Environment variables updated from settings",
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to update environment from settings: ${(error as Error).message}`,
      );
    }
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
