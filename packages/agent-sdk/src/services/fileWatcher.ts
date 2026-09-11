/**
 * File Watcher Service
 *
 * Provides robust cross-platform file watching using Chokidar library.
 * Handles file watching with debouncing, error recovery, and graceful fallbacks.
 */

import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import type { Logger } from "../types/index.js";

/**
 * Expand a watch path to its canonical long form (Windows only).
 *
 * libuv's fs-event backend resolves each event path with `GetLongPathNameW()`
 * and then asserts the result is prefixed by the watched directory string
 * (`uv__relative_path()`, src\win\fs-event.c). libuv <= 1.51 expanded the
 * watched directory itself; 1.52 dropped that step (it ships with Node 24.16+,
 * 26.x, and Electron 43 — which bundles Node 24.18), so `handle->dirw`
 * keeps whatever the caller passed, and watching an 8.3 short path
 * (`C:\Users\LIUYIQ~1\...` — what %TEMP% yields when it is configured with a
 * short name) aborts the whole process on the first event. The abort is not a
 * catchable error, so the root must be canonicalized before it reaches
 * chokidar. `fs.realpathSync()` alone is not enough: only the `.native()`
 * variant expands short names.
 *
 * Paths that don't exist yet (`~/.wave/settings.json` on a fresh install) are
 * handled by expanding the nearest existing ancestor and appending the
 * remaining segments back; if nothing can be resolved the input is returned
 * unchanged.
 */
function toLongFormPath(target: string): string {
  if (process.platform !== "win32") return target;
  // Only drive-qualified (`C:\...`) and UNC (`\\server\share`) paths are real
  // Windows paths. POSIX-style input (what tests and other platforms use) is
  // passed through untouched rather than re-rooted onto the current drive.
  if (!/^[a-zA-Z]:[\\/]/.test(target) && !target.startsWith("\\\\")) {
    return target;
  }

  let candidate = target;
  const missing: string[] = [];
  for (;;) {
    try {
      const resolved = fs.realpathSync.native(candidate);
      return missing.length > 0 ? path.join(resolved, ...missing) : resolved;
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return target;
      missing.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

/** Whether `filePath` (slash-normalized) is the watched root or inside it. */
function isWithin(filePath: string, root: string): boolean {
  const normalizedRoot = root.replace(/\\/g, "/");
  return (
    filePath === normalizedRoot || filePath.startsWith(normalizedRoot + "/")
  );
}

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
  depth: number; // default: 5
  ignored: string[]; // default: ['**/node_modules/**', '**/.git/**', '**/*.swp', '**/*~']
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
  /** The path handed to chokidar (long form on Windows); see toLongFormPath. */
  watchPath: string;
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
      depth: 5,
      ignored: ["**/node_modules/**", "**/.git/**", "**/*.swp", "**/*~"],
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
        watchPath: toLongFormPath(path),
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
        `FileWatcher: Failed to watch file ${path}: ${(error as Error).message}`,
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
        entry.watcher.unwatch(entry.watchPath);
      }

      this.watchers.delete(path);
    } catch (error) {
      this.logger?.warn(
        `FileWatcher: Error unwatching file ${path}: ${(error as Error).message}`,
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
              type: "change",
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
   * Cleanup all watchers
   */
  async cleanup(): Promise<void> {
    const paths = Array.from(this.watchers.keys());
    for (const path of paths) {
      await this.unwatchFile(path);
    }

    if (this.globalWatcher) {
      const watcher = this.globalWatcher;
      this.globalWatcher = null;
      await watcher.close();
    }
  }

  private async initializeWatcher(entry: FileWatcherEntry): Promise<void> {
    try {
      // Initialize global watcher if needed
      if (!this.globalWatcher) {
        this.globalWatcher = chokidar.watch([], {
          persistent: true,
          ignoreInitial: true,
          depth: entry.config.depth,
          ignored: entry.config.ignored,
          awaitWriteFinish: {
            stabilityThreshold: entry.config.stabilityThreshold,
            pollInterval: entry.config.pollInterval,
          },
          usePolling: entry.config.fallbackPolling,
          interval: entry.config.pollInterval,
        });

        // Unref the global watcher to allow natural exit if it's the only thing left
        // (chokidar watchers keep the process alive by default)
        // Note: some platforms might need additional handling
        const watcher = this.globalWatcher as unknown as { unref?: () => void };
        if (watcher.unref) {
          watcher.unref();
        }

        this.setupGlobalWatcherEvents();
      }

      // Add path to global watcher
      this.globalWatcher.add(entry.watchPath);
      entry.watcher = this.globalWatcher;
      entry.isActive = true;
      entry.errorCount = 0;
    } catch (error) {
      entry.errorCount++;
      entry.isActive = false;
      entry.lastError = (error as Error).message;

      this.logger?.error(
        `FileWatcher: Failed to initialize watcher for ${entry.path}: ${(error as Error).message}`,
      );

      // Try fallback polling if not already using it
      if (
        !entry.config.fallbackPolling &&
        entry.errorCount < entry.config.maxRetries
      ) {
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
      "change",
      (filePath: string, stats?: { size?: number }) => {
        this.handleFileEvent("change", filePath, stats);
      },
    );

    this.globalWatcher.on(
      "add",
      (filePath: string, stats?: { size?: number }) => {
        this.handleFileEvent("create", filePath, stats);
      },
    );

    this.globalWatcher.on("unlink", (filePath: string) => {
      this.handleFileEvent("delete", filePath);
    });

    this.globalWatcher.on("addDir", (dirPath: string) => {
      this.handleFileEvent("create", dirPath);
    });

    this.globalWatcher.on("unlinkDir", (dirPath: string) => {
      this.handleFileEvent("delete", dirPath);
    });

    this.globalWatcher.on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      const isEMFILE = (error as NodeJS.ErrnoException).code === "EMFILE";
      if (isEMFILE) {
        this.logger?.warn(
          "FileWatcher: Too many open files (EMFILE). " +
            "Consider increasing the limit: `ulimit -n 10240` (macOS) or `ulimit -n 65536` (Linux).",
        );
      } else {
        this.logger?.error(`FileWatcher: File watcher error: ${error.message}`);
      }
      this.emit("watcherError", error);
    });
  }

  private handleFileEvent(
    type: FileWatchEvent["type"],
    filePath: string,
    stats?: { size?: number },
  ): void {
    const event: FileWatchEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
      size: stats?.size,
    };

    // Notify all watchers that match the path or are parents of the path.
    // Events arrive under whichever form chokidar was given (the long form on
    // Windows), while entries are keyed by the caller's original path, so both
    // have to be considered.
    for (const [watchedPath, entry] of this.watchers.entries()) {
      const normalizedFilePath = filePath.replace(/\\/g, "/");
      if (
        isWithin(normalizedFilePath, watchedPath) ||
        isWithin(normalizedFilePath, entry.watchPath)
      ) {
        entry.lastEvent = event.timestamp;

        // Notify all callbacks for this watcher
        for (const callback of entry.callbacks) {
          try {
            callback(event);
          } catch (error) {
            this.logger?.error(
              `FileWatcher: Error in file watch callback for ${watchedPath} (event on ${filePath}): ${(error as Error).message}`,
            );
          }
        }
      }
    }
  }
}
