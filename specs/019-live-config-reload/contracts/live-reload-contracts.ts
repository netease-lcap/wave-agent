/**
 * API Contracts for Live Configuration Reload
 * 
 * Generated from functional requirements in spec.md
 * These TypeScript interfaces define the contracts for live configuration reload functionality
 */

// =============================================================================
// Configuration Contracts
// =============================================================================

/**
 * Wave Agent Configuration with Environment Variables
 * Extends existing HookConfiguration to include env field
 * Maps to FR-001: settings.json MUST support optional "env" field
 */
export interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>;
}

/**
 * Environment Variable Validation Result
 * Maps to FR-003: System MUST validate env field format
 */
export interface EnvironmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Merged Environment Context
 * Maps to FR-002: System MUST merge user-level and project-level env configurations
 */
export interface MergedEnvironmentContext {
  userVars: Record<string, string>;
  projectVars: Record<string, string>;
  mergedVars: Record<string, string>;
  conflicts: Array<{
    key: string;
    userValue: string;
    projectValue: string;
    resolvedValue: string;
  }>;
}

// =============================================================================
// File Watching Contracts
// =============================================================================

/**
 * File Watch Event
 * Maps to FR-004, FR-005: System MUST watch files for changes
 */
export interface FileWatchEvent {
  type: 'change' | 'create' | 'delete' | 'rename';
  path: string;
  timestamp: number;
  size?: number;
}

/**
 * File Watcher Configuration
 * Maps to FR-010: File watchers MUST handle file events
 * Uses Chokidar for robust cross-platform file watching
 */
export interface FileWatcherConfig {
  stabilityThreshold: number; // Chokidar awaitWriteFinish delay (ms)
  pollInterval: number;       // Chokidar polling interval (ms)  
  maxRetries: number;        // Default: 3
  fallbackPolling: boolean;  // Default: false
  ignoreTempFiles: boolean;  // Default: true
}

/**
 * File Watcher Status
 * Maps to FR-012: System MUST handle watcher initialization failures
 */
export interface FileWatcherStatus {
  isActive: boolean;
  path: string;
  method: 'native' | 'polling' | 'failed';
  errorCount: number;
  lastError?: string;
  lastEvent?: FileWatchEvent;
}

// =============================================================================
// Memory Caching Contracts
// =============================================================================

/**
 * Memory Store Entry
 * Maps to FR-006: System MUST keep AGENTS.md content in memory
 */
export interface MemoryStoreEntry {
  content: string;
  path: string;
  lastModified: number;
  isLoaded: boolean;
}

/**
 * Memory Store Statistics
 * For monitoring and debugging
 */
export interface MemoryStoreStats {
  contentSize: number;
  lastUpdated: number;
  updateCount: number;
  isLoaded: boolean;
}

/**
 * Memory Update Event
 * Maps to FR-007: System MUST update memory content when file changes
 */
export interface MemoryUpdateEvent {
  path: string;
  reason: 'file_change' | 'initial_load' | 'manual_reload';
  timestamp: number;
  previousSize?: number;
  newSize: number;
}

// =============================================================================
// Service Contracts
// =============================================================================

/**
 * Configuration Reload Service Interface
 * Maps to FR-004, FR-008: Configuration reload and error handling
 */
export interface ConfigurationReloadService {
  /**
   * Initialize configuration watching
   * Maps to FR-004: System MUST watch settings.json files
   */
  initializeWatching(userPath: string, projectPath?: string): Promise<void>;

  /**
   * Reload configuration from files
   * Maps to FR-008: Continue with previous valid configuration on errors
   */
  reloadConfiguration(): Promise<WaveConfiguration>;

  /**
   * Get current effective configuration
   * Maps to FR-002: Merged configuration with project precedence
   */
  getCurrentConfiguration(): WaveConfiguration | null;

  /**
   * Stop watching and cleanup resources
   * Maps to cleanup requirements
   */
  shutdown(): Promise<void>;
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
  getStats(): MemoryStoreStats;

  /**
   * Check if content is loaded in memory
   * For status checking
   */
  isLoaded(path: string): boolean;
}

/**
 * File Watcher Service Interface
 * Maps to FR-010, FR-012: File watching and error handling
 */
export interface FileWatcherService {
  /**
   * Start watching a file
   * Maps to FR-010: Handle file deletion, creation, and modification
   */
  watchFile(path: string, callback: (event: FileWatchEvent) => void): Promise<void>;

  /**
   * Stop watching a file
   * Resource cleanup
   */
  unwatchFile(path: string): Promise<void>;

  /**
   * Get watcher status
   * Maps to FR-012: Handle watcher initialization failures
   */
  getWatcherStatus(path: string): FileWatcherStatus | null;

  /**
   * Get all watcher statuses
   * For monitoring and debugging
   */
  getAllWatcherStatuses(): FileWatcherStatus[];

  /**
   * Configure watcher behavior
   * Runtime configuration updates
   */
  updateConfig(config: Partial<FileWatcherConfig>): void;
}

// =============================================================================
// Event Contracts
// =============================================================================

/**
 * Configuration Change Event
 * Maps to FR-009: Log configuration reload events
 */
export interface ConfigurationChangeEvent {
  type: 'settings_changed' | 'memory_changed' | 'env_changed';
  path: string;
  timestamp: number;
  changes: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Live Reload Event Emitter Interface
 * For coordinating live reload across the system
 */
export interface LiveReloadEventEmitter {
  /**
   * Emit configuration change event
   * Notify all listeners of configuration changes
   */
  emitConfigurationChange(event: ConfigurationChangeEvent): void;

  /**
   * Subscribe to configuration change events
   * Allow components to react to configuration changes
   */
  onConfigurationChange(callback: (event: ConfigurationChangeEvent) => void): () => void;

  /**
   * Subscribe to memory update events
   * Allow components to react to memory changes
   */
  onMemoryUpdate(callback: (event: MemoryUpdateEvent) => void): () => void;
}

// =============================================================================
// Error Contracts
// =============================================================================

/**
 * Configuration Error Types
 * Maps to FR-003, FR-008, FR-009: Error handling and logging
 */
export type ConfigurationErrorType = 
  | 'invalid_json'
  | 'invalid_env_format'
  | 'file_access_error'
  | 'watcher_failure'
  | 'validation_error'
  | 'merge_conflict';

/**
 * Configuration Error
 * Standardized error reporting for configuration issues
 */
export interface ConfigurationError {
  type: ConfigurationErrorType;
  message: string;
  path?: string;
  details?: Record<string, any>;
  timestamp: number;
  recoverable: boolean;
}

/**
 * Error Recovery Result
 * Maps to FR-008: Continue operating with previous valid configuration
 */
export interface ErrorRecoveryResult {
  success: boolean;
  fallbackUsed: boolean;
  errorCount: number;
  recoveryStrategy: 'previous_config' | 'default_config' | 'partial_config';
  message: string;
}

// =============================================================================
// Integration Contracts
// =============================================================================

/**
 * Enhanced Hook Execution Context
 * Maps to FR-011: Environment variables available to hook processes
 */
export interface EnhancedHookExecutionContext extends HookExecutionContext {
  environmentVariables: Record<string, string>;
  configurationVersion: number;
  reloadTimestamp?: number;
}

/**
 * Agent Memory Context
 * Enhanced memory context with storage information
 */
export interface EnhancedMemoryContext {
  content: string;
  isFromMemory: boolean;
  lastUpdated: number;
  source: 'memory' | 'file' | 'empty';
}