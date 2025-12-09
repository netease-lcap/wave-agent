/**
 * Configuration Management Types
 *
 * Types for centralized configuration loading and validation services.
 * These support the refactored configuration architecture that separates
 * configuration management from hook execution.
 */

import type { WaveConfiguration } from "./hooks.js";

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
