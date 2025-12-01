/**
 * Memory Store Service
 *
 * Provides in-memory storage for file content with automatic updates.
 * Optimizes performance by keeping frequently accessed files in memory.
 */

import { promises as fs } from "fs";
import { EventEmitter } from "events";
import type { Logger } from "../types/index.js";

export interface MemoryStoreEntry {
  content: string;
  path: string;
  lastModified: number;
  isLoaded: boolean;
}

export interface MemoryStoreStats {
  contentSize: number;
  lastUpdated: number;
  updateCount: number;
  isLoaded: boolean;
}

export interface MemoryUpdateEvent {
  path: string;
  reason: "file_change" | "initial_load" | "manual_reload";
  timestamp: number;
  previousSize?: number;
  newSize: number;
}

export class MemoryStoreService extends EventEmitter {
  private store: Map<string, MemoryStoreEntry> = new Map();
  private updateCounts: Map<string, number> = new Map();
  private logger?: Logger;

  constructor(logger?: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Get content from memory store (loads from file if not loaded)
   * Maps to FR-006: Keep AGENTS.md content in memory to avoid repeated reads
   */
  async getContent(path: string): Promise<string> {
    const entry = this.store.get(path);

    if (entry && entry.isLoaded) {
      this.logger?.debug(`Live Config: Memory hit for ${path}`);
      return entry.content;
    }

    // Load from file if not in memory
    return await this.loadFromFile(path, "initial_load");
  }

  /**
   * Update memory content from file
   * Maps to FR-007: Update memory content when file changes
   */
  async updateContent(path: string): Promise<void> {
    const previousEntry = this.store.get(path);
    const previousSize = previousEntry?.content.length || 0;

    await this.loadFromFile(path, "file_change", previousSize);
  }

  /**
   * Get memory store statistics
   * For monitoring and debugging
   */
  getStats(path?: string): MemoryStoreStats {
    if (path) {
      const entry = this.store.get(path);
      const updateCount = this.updateCounts.get(path) || 0;

      return {
        contentSize: entry?.content.length || 0,
        lastUpdated: entry?.lastModified || 0,
        updateCount,
        isLoaded: entry?.isLoaded || false,
      };
    }

    // Return aggregate stats for all entries
    let totalSize = 0;
    let latestUpdate = 0;
    let totalUpdates = 0;
    let anyLoaded = false;

    for (const [entryPath, entry] of this.store) {
      totalSize += entry.content.length;
      latestUpdate = Math.max(latestUpdate, entry.lastModified);
      totalUpdates += this.updateCounts.get(entryPath) || 0;
      anyLoaded = anyLoaded || entry.isLoaded;
    }

    return {
      contentSize: totalSize,
      lastUpdated: latestUpdate,
      updateCount: totalUpdates,
      isLoaded: anyLoaded,
    };
  }

  /**
   * Check if content is loaded in memory
   * For status checking
   */
  isLoaded(path: string): boolean {
    const entry = this.store.get(path);
    return entry?.isLoaded || false;
  }

  /**
   * Manually reload content from file
   * For force refresh scenarios
   */
  async reloadContent(path: string): Promise<void> {
    const previousEntry = this.store.get(path);
    const previousSize = previousEntry?.content.length || 0;

    await this.loadFromFile(path, "manual_reload", previousSize);
  }

  /**
   * Remove content from memory store
   * For cleanup when file is deleted
   */
  removeContent(path: string): boolean {
    const removed = this.store.delete(path);
    this.updateCounts.delete(path);

    if (removed) {
      this.logger?.info(`Live Config: Removed ${path} from memory store`);
    }

    return removed;
  }

  /**
   * Clear all content from memory store
   * For cleanup and testing
   */
  clear(): void {
    const pathCount = this.store.size;
    this.store.clear();
    this.updateCounts.clear();

    if (pathCount > 0) {
      this.logger?.info(
        `Live Config: Cleared ${pathCount} entries from memory store`,
      );
    }
  }

  /**
   * Get all stored paths
   * For monitoring and debugging
   */
  getStoredPaths(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Check if file exists and is accessible
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async loadFromFile(
    path: string,
    reason: MemoryUpdateEvent["reason"],
    previousSize?: number,
  ): Promise<string> {
    try {
      // Check if file exists
      const exists = await this.fileExists(path);
      if (!exists) {
        // Handle file deletion gracefully
        const entry: MemoryStoreEntry = {
          content: "",
          path,
          lastModified: Date.now(),
          isLoaded: true,
        };

        this.store.set(path, entry);
        this.incrementUpdateCount(path);

        this.logger?.info(
          `Live Config: File ${path} not found, storing empty content`,
        );

        this.emitUpdateEvent(path, reason, previousSize, 0);
        return "";
      }

      // Read file content
      const content = await fs.readFile(path, "utf-8");
      const stats = await fs.stat(path);

      const entry: MemoryStoreEntry = {
        content,
        path,
        lastModified: stats.mtime.getTime(),
        isLoaded: true,
      };

      this.store.set(path, entry);
      this.incrementUpdateCount(path);

      this.logger?.info(
        `Live Config: Loaded ${content.length} bytes from ${path} into memory`,
      );

      this.emitUpdateEvent(path, reason, previousSize, content.length);
      return content;
    } catch (error) {
      const errorMessage = `Live Config: Failed to load ${path} into memory: ${(error as Error).message}`;
      this.logger?.error(errorMessage);

      // Return existing content if available, otherwise empty string
      const existingEntry = this.store.get(path);
      if (existingEntry?.isLoaded) {
        this.logger?.warn(
          `Live Config: Using cached content for ${path} due to read error`,
        );
        return existingEntry.content;
      }

      // Store empty content as fallback
      const entry: MemoryStoreEntry = {
        content: "",
        path,
        lastModified: Date.now(),
        isLoaded: true,
      };

      this.store.set(path, entry);
      this.emitUpdateEvent(path, reason, previousSize, 0);
      return "";
    }
  }

  private incrementUpdateCount(path: string): void {
    const current = this.updateCounts.get(path) || 0;
    this.updateCounts.set(path, current + 1);
  }

  private emitUpdateEvent(
    path: string,
    reason: MemoryUpdateEvent["reason"],
    previousSize: number | undefined,
    newSize: number,
  ): void {
    const event: MemoryUpdateEvent = {
      path,
      reason,
      timestamp: Date.now(),
      previousSize,
      newSize,
    };

    this.emit("memoryUpdate", event);
    this.logger?.debug(
      `Live Config: Memory update event for ${path}: ${reason}`,
    );
  }
}
