/**
 * File Watcher Service
 *
 * Provides robust cross-platform file watching using Chokidar library.
 * Handles file watching with debouncing, error recovery, and graceful fallbacks.
 */

import * as chokidar from "chokidar";
import { EventEmitter } from "events";
import type { Logger } from "../types/index.js";
import { FILE_WATCHER_EVENTS } from "../constants/events.js";

export interface FileWatchEvent {
  type: "change" | "create" | "delete" | "rename";
  path: string;
  timestamp: number;
  size?: number;
}

export interface FileWatcherConfig {
  stabilityThreshold: number; // Chokidar awaitWriteFinish delay (ms)
  pollInterval: number; // Chokidar polling interval (ms)
  maxRetries: number; // Default: 3
  fallbackPolling: boolean; // Default: false
  ignoreTempFiles: boolean; // Default: true
}

export interface FileWatcherStatus {
  isActive: boolean;
  path: string;
  method: "native" | "polling" | "failed";
  errorCount: number;
  lastError?: string;
  lastEvent?: FileWatchEvent;
}

interface FileWatcherEntry {
  path: string;
  watcher: chokidar.FSWatcher | null;
  isActive: boolean;
  lastEvent: number;
  errorCount: number;
  lastError?: string;
  callbacks: Set<(event: FileWatchEvent) => void>;
  config: FileWatcherConfig;
}

export class FileWatcherService extends EventEmitter {
  private watchers: Map<string, FileWatcherEntry> = new Map();
  private globalWatcher: chokidar.FSWatcher | null = null;
  private defaultConfig: FileWatcherConfig;
  private logger?: Logger;

  constructor(logger?: Logger, config?: Partial<FileWatcherConfig>) {
    super();
    this.logger = logger;
    this.defaultConfig = {
      stabilityThreshold: 300,
      pollInterval: 100,
      maxRetries: 3,
      fallbackPolling: false,
      ignoreTempFiles: true,
      ...config,
    };
  }

  /**
   * Start watching a file
   * Maps to FR-010: Handle file deletion, creation, and modification
   */
  async watchFile(
    path: string,
    callback: (event: FileWatchEvent) => void,
  ): Promise<void> {
    try {
      if (this.watchers.has(path)) {
        // Add callback to existing watcher
        const entry = this.watchers.get(path)!;
        entry.callbacks.add(callback);
        return;
      }

      // Create new watcher entry
      const entry: FileWatcherEntry = {
        path,
        watcher: null,
        isActive: false,
        lastEvent: Date.now(),
        errorCount: 0,
        lastError: undefined,
        callbacks: new Set([callback]),
        config: { ...this.defaultConfig },
      };

      this.watchers.set(path, entry);
      await this.initializeWatcher(entry);
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to watch file ${path}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Stop watching a file
   * Resource cleanup
   */
  async unwatchFile(path: string): Promise<void> {
    const entry = this.watchers.get(path);
    if (!entry) return;

    try {
      if (entry.watcher) {
        entry.watcher.unwatch(path);
      }

      this.watchers.delete(path);
      this.logger?.info(`Live Config: Stopped watching file: ${path}`);
    } catch (error) {
      this.logger?.warn(
        `Live Config: Error unwatching file ${path}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get watcher status
   * Maps to FR-012: Handle watcher initialization failures
   */
  getWatcherStatus(path: string): FileWatcherStatus | null {
    const entry = this.watchers.get(path);
    if (!entry) return null;

    return {
      isActive: entry.isActive,
      path: entry.path,
      method:
        entry.errorCount > 0
          ? "failed"
          : entry.config.fallbackPolling
            ? "polling"
            : "native",
      errorCount: entry.errorCount,
      lastError: entry.lastError,
      lastEvent:
        entry.lastEvent > 0
          ? {
              type: FILE_WATCHER_EVENTS.CHANGE,
              path: entry.path,
              timestamp: entry.lastEvent,
            }
          : undefined,
    };
  }

  /**
   * Get all watcher statuses
   * For monitoring and debugging
   */
  getAllWatcherStatuses(): FileWatcherStatus[] {
    return Array.from(this.watchers.keys())
      .map((path) => this.getWatcherStatus(path))
      .filter((status): status is FileWatcherStatus => status !== null);
  }

  /**
   * Configure watcher behavior
   * Runtime configuration updates
   */
  updateConfig(config: Partial<FileWatcherConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };

    // Update existing watchers with new config
    for (const entry of this.watchers.values()) {
      entry.config = { ...entry.config, ...config };
    }
  }

  /**
   * Cleanup all watchers
   */
  async cleanup(): Promise<void> {
    const paths = Array.from(this.watchers.keys());
    await Promise.all(paths.map((path) => this.unwatchFile(path)));

    if (this.globalWatcher) {
      await this.globalWatcher.close();
      this.globalWatcher = null;
    }
  }

  private async initializeWatcher(entry: FileWatcherEntry): Promise<void> {
    try {
      // Initialize global watcher if needed
      if (!this.globalWatcher) {
        this.globalWatcher = chokidar.watch([], {
          persistent: true,
          ignoreInitial: true,
          awaitWriteFinish: {
            stabilityThreshold: entry.config.stabilityThreshold,
            pollInterval: entry.config.pollInterval,
          },
          usePolling: entry.config.fallbackPolling,
          interval: entry.config.pollInterval,
        });

        this.setupGlobalWatcherEvents();
      }

      // Add path to global watcher
      this.globalWatcher.add(entry.path);
      entry.watcher = this.globalWatcher;
      entry.isActive = true;
      entry.errorCount = 0;

      this.logger?.info(`Live Config: Started watching file: ${entry.path}`);
    } catch (error) {
      entry.errorCount++;
      entry.isActive = false;
      entry.lastError = (error as Error).message;

      this.logger?.error(
        `Live Config: Failed to initialize watcher for ${entry.path}: ${(error as Error).message}`,
      );

      // Try fallback polling if not already using it
      if (
        !entry.config.fallbackPolling &&
        entry.errorCount < entry.config.maxRetries
      ) {
        this.logger?.info(
          `Live Config: Attempting polling fallback for ${entry.path}`,
        );
        entry.config.fallbackPolling = true;
        await this.initializeWatcher(entry);
      } else {
        throw error;
      }
    }
  }

  private setupGlobalWatcherEvents(): void {
    if (!this.globalWatcher) return;

    this.globalWatcher.on(
      FILE_WATCHER_EVENTS.CHANGE,
      (filePath: string, stats?: { size?: number }) => {
        this.handleFileEvent(FILE_WATCHER_EVENTS.CHANGE, filePath, stats);
      },
    );

    this.globalWatcher.on(
      "add",
      (filePath: string, stats?: { size?: number }) => {
        this.handleFileEvent(FILE_WATCHER_EVENTS.CREATE, filePath, stats);
      },
    );

    this.globalWatcher.on("unlink", (filePath: string) => {
      this.handleFileEvent(FILE_WATCHER_EVENTS.DELETE, filePath);
    });

    this.globalWatcher.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger?.error(`Live Config: File watcher error: ${error.message}`);
      this.emit("watcherError", error);
    });
  }

  private handleFileEvent(
    type: FileWatchEvent["type"],
    filePath: string,
    stats?: { size?: number },
  ): void {
    const entry = this.watchers.get(filePath);
    if (!entry) return;

    const event: FileWatchEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
      size: stats?.size,
    };

    entry.lastEvent = event.timestamp;

    // Notify all callbacks for this file
    for (const callback of entry.callbacks) {
      try {
        callback(event);
      } catch (error) {
        this.logger?.error(
          `Live Config: Error in file watch callback for ${filePath}: ${(error as Error).message}`,
        );
      }
    }

    this.logger?.debug(`Live Config: File ${type} event for ${filePath}`);
  }
}
