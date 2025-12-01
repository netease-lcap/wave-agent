/**
 * Mock Logger Utilities for Testing Global Logger
 *
 * Provides standardized mock logger instances and helper functions
 * for testing the global logger system. Includes setup/teardown utilities
 * and verification helpers.
 */

import { vi, expect, type Mock } from "vitest";
import type { Logger } from "../../src/types/core.js";

/**
 * Mock Logger interface with Vitest Mock functions
 * Provides spy functionality for all Logger methods
 */
export interface MockLogger extends Logger {
  debug: Mock<(...args: unknown[]) => void>;
  info: Mock<(...args: unknown[]) => void>;
  warn: Mock<(...args: unknown[]) => void>;
  error: Mock<(...args: unknown[]) => void>;
}

/**
 * Create a fresh mock logger instance with Vitest mocks
 *
 * @returns MockLogger with all methods as Vitest mock functions
 *
 * @example
 * ```typescript
 * const mockLogger = createMockLogger();
 * mockLogger.debug('test');
 * expect(mockLogger.debug).toHaveBeenCalledWith('test');
 * ```
 */
export function createMockLogger(): MockLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Reset all mock functions on a MockLogger instance
 * Clears call history and return values
 *
 * @param mockLogger - MockLogger instance to reset
 *
 * @example
 * ```typescript
 * resetMockLogger(mockLogger);
 * expect(mockLogger.debug).not.toHaveBeenCalled();
 * ```
 */
export function resetMockLogger(mockLogger: MockLogger): void {
  mockLogger.debug.mockReset();
  mockLogger.info.mockReset();
  mockLogger.warn.mockReset();
  mockLogger.error.mockReset();
}

/**
 * Clear all mock calls on a MockLogger instance
 * Preserves mock implementation but clears call history
 *
 * @param mockLogger - MockLogger instance to clear
 */
export function clearMockLogger(mockLogger: MockLogger): void {
  mockLogger.debug.mockClear();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
}

/**
 * Verify that no logging methods were called on the mock logger
 * Useful for testing no-op behavior when global logger is unconfigured
 *
 * @param mockLogger - MockLogger instance to verify
 *
 * @example
 * ```typescript
 * // Test no-op behavior
 * clearGlobalLogger();
 * logger.debug('should be ignored');
 * expectNoLoggerCalls(mockLogger);
 * ```
 */
export function expectNoLoggerCalls(mockLogger: MockLogger): void {
  expect(mockLogger.debug).not.toHaveBeenCalled();
  expect(mockLogger.info).not.toHaveBeenCalled();
  expect(mockLogger.warn).not.toHaveBeenCalled();
  expect(mockLogger.error).not.toHaveBeenCalled();
}

/**
 * Verify specific logger method was called with expected arguments
 *
 * @param mockLogger - MockLogger instance to verify
 * @param level - Log level to check ('debug' | 'info' | 'warn' | 'error')
 * @param expectedArgs - Expected arguments passed to the method
 *
 * @example
 * ```typescript
 * expectLoggerCall(mockLogger, 'error', ['Operation failed:', error, { context: 'test' }]);
 * ```
 */
export function expectLoggerCall(
  mockLogger: MockLogger,
  level: keyof Logger,
  expectedArgs: unknown[],
): void {
  expect(mockLogger[level]).toHaveBeenCalledWith(...expectedArgs);
}

/**
 * Verify specific logger method was called exactly once
 *
 * @param mockLogger - MockLogger instance to verify
 * @param level - Log level to check
 *
 * @example
 * ```typescript
 * expectSingleLoggerCall(mockLogger, 'info');
 * ```
 */
export function expectSingleLoggerCall(
  mockLogger: MockLogger,
  level: keyof Logger,
): void {
  expect(mockLogger[level]).toHaveBeenCalledTimes(1);
}

/**
 * Get the total number of calls made to all logger methods
 * Useful for verifying overall logging activity
 *
 * @param mockLogger - MockLogger instance to check
 * @returns Total number of calls across all log levels
 *
 * @example
 * ```typescript
 * const totalCalls = getTotalLoggerCalls(mockLogger);
 * expect(totalCalls).toBe(3);
 * ```
 */
export function getTotalLoggerCalls(mockLogger: MockLogger): number {
  return (
    mockLogger.debug.mock.calls.length +
    mockLogger.info.mock.calls.length +
    mockLogger.warn.mock.calls.length +
    mockLogger.error.mock.calls.length
  );
}
