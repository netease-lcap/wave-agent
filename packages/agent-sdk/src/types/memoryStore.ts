/**
 * Memory Store Type Definitions
 *
 * Provides TypeScript types for in-memory file storage system,
 * enabling optimized access to frequently read files like AGENTS.md.
 */

export interface MemoryStore {
  content: string; // Current file content in memory
  lastModified: number; // File modification timestamp
  path: string; // Absolute file path
  isLoaded: boolean; // Whether content has been loaded
}

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

/**
 * Memory Store Service Interface
 * Maps to FR-006, FR-007: Memory storage and updates
 */
export interface MemoryStoreService {
  /**
   * Get content from memory store (loads from file if not loaded)
   * Maps to FR-006: Keep AGENTS.md content in memory to avoid repeated reads
   */
  getContent(path: string): Promise<string>;

  /**
   * Update memory content from file
   * Maps to FR-007: Update memory content when file changes
   */
  updateContent(path: string): Promise<void>;

  /**
   * Get memory store statistics
   * For monitoring and debugging
   */
  getStats(path?: string): MemoryStoreStats;

  /**
   * Check if content is loaded in memory
   * For status checking
   */
  isLoaded(path: string): boolean;

  /**
   * Manually reload content from file
   * For force refresh scenarios
   */
  reloadContent(path: string): Promise<void>;

  /**
   * Remove content from memory store
   * For cleanup when file is deleted
   */
  removeContent(path: string): boolean;

  /**
   * Clear all content from memory store
   * For cleanup and testing
   */
  clear(): void;

  /**
   * Get all stored paths
   * For monitoring and debugging
   */
  getStoredPaths(): string[];

  /**
   * Check if file exists and is accessible
   */
  fileExists(path: string): Promise<boolean>;
}
