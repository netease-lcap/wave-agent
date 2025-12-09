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
import type { WaveConfiguration } from "../types/hooks.js";
import { ConfigurationService } from "../services/configurationService.js";
import { EnvironmentService } from "../services/environmentService.js";

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
  private readonly environmentService: EnvironmentService;
  private readonly configurationService: ConfigurationService;

  constructor(options: LiveConfigManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
    this.hookManager = options.hookManager;
    this.memoryStore = options.memoryStore;
    this.environmentService = new EnvironmentService({ logger: this.logger });
    this.configurationService = new ConfigurationService();
  }

  /**
   * Initialize live configuration management
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger?.debug("Already initialized");
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
      this.logger?.info("Live configuration management initialized");
    } catch (error) {
      this.logger?.error(`Failed to initialize: ${(error as Error).message}`);
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
      this.logger?.info("Live configuration management shutdown completed");
    } catch (error) {
      this.logger?.error(`Error during shutdown: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Initialize configuration watcher for hook settings
   */
  private async initializeConfigurationWatcher(): Promise<void> {
    if (!this.hookManager) {
      this.logger?.debug(
        "No hook manager provided, skipping configuration watching",
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
    this.logger?.info("Configuration watching initialized");
  }

  /**
   * Initialize memory store watching for AGENTS.md files
   */
  private async initializeMemoryStoreWatching(): Promise<void> {
    if (!this.memoryStore || !this.configurationWatcher) {
      this.logger?.debug(
        "Memory store not available, skipping AGENTS.md watching",
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

      this.logger?.info("AGENTS.md file watching initialized");
    } catch (error) {
      this.logger?.warn(
        `Failed to initialize AGENTS.md watching: ${(error as Error).message}`,
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

    // Handle configuration errors with clear user feedback
    if (!event.isValid && event.errorMessage) {
      this.logger?.error(
        `Live Config: Configuration error - ${event.errorMessage}`,
      );
      this.logger?.warn(
        "Live Config: System is using previous valid configuration to maintain functionality",
      );
      return; // Skip environment update on configuration errors
    }

    // Load configuration once and use for both environment update and hook manager update
    this.configurationService
      .loadMergedConfiguration(this.workdir)
      .then((configResult) => {
        if (!configResult.success) {
          this.logger?.error(
            `Live Config: Failed to load configuration: ${configResult.error || "Unknown error"}`,
          );
          return;
        }

        // Update environment variables if configuration has env section
        if (configResult.configuration?.env) {
          this.updateEnvironmentFromConfiguration(
            configResult.configuration.env,
          );
        }

        // Update hook manager if available
        if (this.hookManager) {
          this.hookManager.loadConfigurationFromWaveConfig(
            configResult.configuration,
          );
          this.logger?.info("Live Config: Configuration reloaded successfully");
        }

        // Log configuration warnings
        if (configResult.warnings && configResult.warnings.length > 0) {
          this.logger?.warn(`Live Config: ${configResult.warnings.join("; ")}`);
        }
      })
      .catch((error) => {
        this.logger?.error(
          `Live Config: Exception during configuration reload: ${(error as Error).message}`,
        );
      });
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
      this.logger?.debug(`Live Config: AGENTS.md ${event.type} detected`);

      if (event.type === "delete") {
        this.memoryStore.removeContent(event.path);
      } else {
        await this.memoryStore.updateContent(event.path);
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
   * Update process.env from provided environment configuration
   */
  private updateEnvironmentFromConfiguration(
    envConfig: Record<string, string>,
  ): void {
    // Process environment variables using EnvironmentService
    const result = this.environmentService.processEnvironmentConfig(envConfig);

    // Handle conflicts and warnings
    if (result.conflicts.length > 0) {
      this.logger?.warn(
        `Live Config: ${result.conflicts.length} environment variable conflicts resolved`,
      );
    }

    if (result.warnings.length > 0) {
      this.logger?.warn(
        `Live Config: ${result.warnings.length} environment variable warnings`,
      );
    }

    if (result.applied) {
      const varCount = Object.keys(result.processedVars).length;
      this.logger?.info(
        `Live Config: Environment variables updated (${varCount} variables)`,
      );
    } else {
      this.logger?.error("Live Config: Failed to apply environment variables");
    }
  }

  /**
   * Get current configuration from the configuration watcher
   */
  getCurrentConfiguration(): WaveConfiguration | null {
    return this.configurationWatcher?.getCurrentConfiguration() || null;
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
