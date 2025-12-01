/**
 * Event name constants to prevent typos and ensure consistency
 *
 * Using constants instead of magic strings prevents bugs like:
 * - ConfigurationWatcher emitting 'configurationChange'
 * - LiveConfigManager listening for 'configurationChanged'
 *
 * This pattern ensures compile-time validation of event names.
 */

// Configuration Watcher Events
export const CONFIGURATION_EVENTS = {
  CONFIGURATION_CHANGE: "configurationChange",
  WATCHER_ERROR: "watcherError",
} as const;

// File Watcher Events
export const FILE_WATCHER_EVENTS = {
  CHANGE: "change",
  CREATE: "create",
  DELETE: "delete",
  RENAME: "rename",
} as const;

// Memory Store Events
export const MEMORY_STORE_EVENTS = {
  FILE_ADDED: "fileAdded",
  FILE_CHANGED: "fileChanged",
  FILE_REMOVED: "fileRemoved",
} as const;

// Type exports for better TypeScript support
export type ConfigurationEventName =
  (typeof CONFIGURATION_EVENTS)[keyof typeof CONFIGURATION_EVENTS];
export type FileWatcherEventName =
  (typeof FILE_WATCHER_EVENTS)[keyof typeof FILE_WATCHER_EVENTS];
export type MemoryStoreEventName =
  (typeof MEMORY_STORE_EVENTS)[keyof typeof MEMORY_STORE_EVENTS];
