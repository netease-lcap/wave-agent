/**
 * Configuration Management Types
 *
 * Types for centralized configuration loading and validation services.
 * These support the refactored configuration architecture that separates
 * configuration management from hook execution.
 */

import type { HookEvent, HookEventConfig } from "./hooks.js";
import type { PermissionMode } from "./permissions.js";

export type Scope = "user" | "project" | "local";

/**
 * Root configuration structure for all Wave Agent settings including hooks and environment variables
 */
export interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>; // Environment variables key-value pairs
  /** New field for persistent permissions */
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: PermissionMode; // Default permission mode for restricted tools
    /**
     * List of directories that are considered part of the Safe Zone.
     * File operations within these directories can be auto-accepted.
     */
    additionalDirectories?: string[];
  };
  /** New field for scoped plugin management */
  enabledPlugins?: Record<string, boolean>;
  /** Preferred language for agent communication */
  language?: string;
}

/**
 * Legacy alias for backward compatibility - will be deprecated
 */
export interface HookConfiguration extends WaveConfiguration {
  hooks: Partial<Record<HookEvent, HookEventConfig[]>>;
}

/**
 * Partial hook configuration for loading/merging scenarios
 */
export type PartialHookConfiguration = Partial<
  Record<HookEvent, HookEventConfig[]>
>;

/**
 * Direct hook configuration record (for test convenience)
 */
export type HookConfigurationRecord = Record<HookEvent, HookEventConfig[]>;

/**
 * Result of configuration loading operations with detailed status information
 */
export interface ConfigurationLoadResult {
  /** The loaded configuration, or null if loading failed */
  configuration: WaveConfiguration | null;
  /** Whether the loading operation was successful */
  success: boolean;
  /** Error message if loading failed */
  error?: string;
  /** Path of the successfully loaded file */
  sourcePath?: string;
  /** Non-critical warnings during loading */
  warnings: string[];
}

/**
 * Result of configuration validation operations
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  isValid: boolean;
  /** Critical errors that prevent configuration use */
  errors: string[];
  /** Non-critical warnings about the configuration */
  warnings: string[];
}

/**
 * Configuration file paths organized by category
 */
export interface ConfigurationPaths {
  /** User-specific configuration file paths in priority order */
  userPaths: string[];
  /** Project-specific configuration file paths in priority order */
  projectPaths: string[];
  /** All configuration paths combined */
  allPaths: string[];
  /** Only the paths that actually exist on the filesystem */
  existingPaths: string[];
}

/**
 * Options for configuring the ConfigurationService
 */
export interface ConfigurationServiceOptions {
  /** Working directory for resolving project configurations */
  workdir: string;
  /** Optional logger for configuration operations */
  logger?: Logger;
  /** Whether to enable validation during loading (default: true) */
  enableValidation?: boolean;
}

/**
 * Minimal logger interface for configuration services
 */
interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}
