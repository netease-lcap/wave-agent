/**
 * Global Logger Registry for Agent SDK
 *
 * Provides zero-overhead logging access for utility functions and services
 * without requiring parameter passing. Maintains singleton logger instance
 * accessible across all SDK modules.
 *
 * Features:
 * - Zero overhead when no logger configured (single null check)
 * - Thread-safe in Node.js single-threaded environment
 * - Maintains backward compatibility with existing Logger interface
 * - Direct function delegation when configured
 */

import type { Logger } from "../types/core.js";

/**
 * Module-level storage for the global logger instance
 * null = unconfigured (logging calls are no-ops)
 * Logger = configured (calls are forwarded)
 */
let globalLogger: Logger | null = null;

// =============================================================================
// Registry Management API
// =============================================================================

/**
 * Configure the global logger instance used by utility functions and services
 *
 * @param logger - Logger instance implementing the Logger interface, or null to disable logging
 * @returns void
 *
 * @example
 * ```typescript
 * import { setGlobalLogger } from './utils/globalLogger.js';
 *
 * // Configure logger
 * setGlobalLogger(myLogger);
 *
 * // Disable logging
 * setGlobalLogger(null);
 * ```
 */
export function setGlobalLogger(logger: Logger | null): void {
  globalLogger = logger;
}

/**
 * Reset global logger to unconfigured state
 * Equivalent to setGlobalLogger(null)
 *
 * @example
 * ```typescript
 * clearGlobalLogger(); // All subsequent logging calls become no-ops
 * ```
 */
export function clearGlobalLogger(): void {
  globalLogger = null;
}

/**
 * Check if global logger is currently configured
 *
 * @returns true if logger configured, false otherwise
 *
 * @example
 * ```typescript
 * if (isLoggerConfigured()) {
 *   // Perform expensive logging operation
 *   const debugInfo = generateDebugInfo();
 *   logger.debug(debugInfo);
 * }
 * ```
 */
export function isLoggerConfigured(): boolean {
  return globalLogger !== null;
}

// =============================================================================
// Zero-Overhead Logging API
// =============================================================================

/**
 * Zero-overhead logging interface
 *
 * Performance characteristics:
 * - Unconfigured: Single null check + early return (near-zero cost)
 * - Configured: Null check + function delegation
 * - No object creation or intermediate allocations
 */
export const logger = {
  /**
   * Log debug-level message through global logger
   * No-op when global logger is null (zero overhead)
   */
  debug: (...args: unknown[]): void => {
    if (globalLogger === null) return;
    globalLogger.debug(...args);
  },

  /**
   * Log info-level message through global logger
   * No-op when global logger is null (zero overhead)
   */
  info: (...args: unknown[]): void => {
    if (globalLogger === null) return;
    globalLogger.info(...args);
  },

  /**
   * Log warning-level message through global logger
   * No-op when global logger is null (zero overhead)
   */
  warn: (...args: unknown[]): void => {
    if (globalLogger === null) return;
    globalLogger.warn(...args);
  },

  /**
   * Log error-level message through global logger
   * No-op when global logger is null (zero overhead)
   */
  error: (...args: unknown[]): void => {
    if (globalLogger === null) return;
    globalLogger.error(...args);
  },
} as const;
