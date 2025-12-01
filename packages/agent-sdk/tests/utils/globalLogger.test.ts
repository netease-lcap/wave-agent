/**
 * Comprehensive Unit Tests for Global Logger Registry
 *
 * Tests all aspects of the global logger system including:
 * - Registry management (set/get/clear/isConfigured)
 * - Zero-overhead logging functions
 * - No-op behavior when unconfigured
 * - Proper forwarding when configured
 * - State isolation between tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setGlobalLogger,
  getGlobalLogger,
  clearGlobalLogger,
  isLoggerConfigured,
  logger,
} from "../../src/utils/globalLogger.js";
import {
  createMockLogger,
  resetMockLogger,
  expectNoLoggerCalls,
  expectLoggerCall,
  expectSingleLoggerCall,
  getTotalLoggerCalls,
  type MockLogger,
} from "./mockLogger.js";

describe("Global Logger Registry", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    // Create fresh mock logger for each test
    mockLogger = createMockLogger();
    // Ensure clean state before each test
    clearGlobalLogger();
  });

  afterEach(() => {
    // Reset global state after each test to prevent interference
    clearGlobalLogger();
    resetMockLogger(mockLogger);
  });

  // =============================================================================
  // Registry Management API Tests
  // =============================================================================

  describe("setGlobalLogger()", () => {
    it("should set the global logger instance", () => {
      expect(getGlobalLogger()).toBeNull();

      setGlobalLogger(mockLogger);

      expect(getGlobalLogger()).toBe(mockLogger);
    });

    it("should replace existing logger with new instance", () => {
      const firstLogger = createMockLogger();
      const secondLogger = createMockLogger();

      setGlobalLogger(firstLogger);
      expect(getGlobalLogger()).toBe(firstLogger);

      setGlobalLogger(secondLogger);
      expect(getGlobalLogger()).toBe(secondLogger);
      expect(getGlobalLogger()).not.toBe(firstLogger);
    });

    it("should accept null to clear the logger", () => {
      setGlobalLogger(mockLogger);
      expect(getGlobalLogger()).toBe(mockLogger);

      setGlobalLogger(null);
      expect(getGlobalLogger()).toBeNull();
    });

    it("should handle multiple set operations correctly", () => {
      // Set -> Clear -> Set -> Clear sequence
      setGlobalLogger(mockLogger);
      expect(getGlobalLogger()).toBe(mockLogger);

      setGlobalLogger(null);
      expect(getGlobalLogger()).toBeNull();

      const secondLogger = createMockLogger();
      setGlobalLogger(secondLogger);
      expect(getGlobalLogger()).toBe(secondLogger);

      setGlobalLogger(null);
      expect(getGlobalLogger()).toBeNull();
    });
  });

  describe("getGlobalLogger()", () => {
    it("should return null when no logger is configured", () => {
      expect(getGlobalLogger()).toBeNull();
    });

    it("should return the configured logger instance", () => {
      setGlobalLogger(mockLogger);

      const retrieved = getGlobalLogger();
      expect(retrieved).toBe(mockLogger);
      expect(retrieved).not.toBeNull();
    });

    it("should return same instance on multiple calls", () => {
      setGlobalLogger(mockLogger);

      const first = getGlobalLogger();
      const second = getGlobalLogger();

      expect(first).toBe(second);
      expect(first).toBe(mockLogger);
    });

    it("should reflect logger changes immediately", () => {
      expect(getGlobalLogger()).toBeNull();

      setGlobalLogger(mockLogger);
      expect(getGlobalLogger()).toBe(mockLogger);

      const newLogger = createMockLogger();
      setGlobalLogger(newLogger);
      expect(getGlobalLogger()).toBe(newLogger);
      expect(getGlobalLogger()).not.toBe(mockLogger);
    });
  });

  describe("clearGlobalLogger()", () => {
    it("should reset logger to null when logger was configured", () => {
      setGlobalLogger(mockLogger);
      expect(getGlobalLogger()).toBe(mockLogger);

      clearGlobalLogger();
      expect(getGlobalLogger()).toBeNull();
    });

    it("should be safe to call when no logger is configured", () => {
      expect(getGlobalLogger()).toBeNull();

      clearGlobalLogger();
      expect(getGlobalLogger()).toBeNull();
    });

    it("should be equivalent to setGlobalLogger(null)", () => {
      setGlobalLogger(mockLogger);

      clearGlobalLogger();
      const afterClear = getGlobalLogger();

      setGlobalLogger(mockLogger);
      setGlobalLogger(null);
      const afterSetNull = getGlobalLogger();

      expect(afterClear).toBe(afterSetNull);
      expect(afterClear).toBeNull();
    });

    it("should handle multiple consecutive clears", () => {
      setGlobalLogger(mockLogger);

      clearGlobalLogger();
      clearGlobalLogger();
      clearGlobalLogger();

      expect(getGlobalLogger()).toBeNull();
    });
  });

  describe("isLoggerConfigured()", () => {
    it("should return false when no logger is configured", () => {
      expect(isLoggerConfigured()).toBe(false);
    });

    it("should return true when logger is configured", () => {
      setGlobalLogger(mockLogger);

      expect(isLoggerConfigured()).toBe(true);
    });

    it("should return false after clearing logger", () => {
      setGlobalLogger(mockLogger);
      expect(isLoggerConfigured()).toBe(true);

      clearGlobalLogger();
      expect(isLoggerConfigured()).toBe(false);
    });

    it("should reflect configuration changes immediately", () => {
      expect(isLoggerConfigured()).toBe(false);

      setGlobalLogger(mockLogger);
      expect(isLoggerConfigured()).toBe(true);

      setGlobalLogger(null);
      expect(isLoggerConfigured()).toBe(false);

      const newLogger = createMockLogger();
      setGlobalLogger(newLogger);
      expect(isLoggerConfigured()).toBe(true);
    });
  });

  // =============================================================================
  // Zero-Overhead Logging API Tests
  // =============================================================================

  describe("logger.debug()", () => {
    it("should be no-op when global logger is null", () => {
      expect(getGlobalLogger()).toBeNull();

      logger.debug("test message");
      logger.debug("multiple", "arguments", { key: "value" });

      // No logger was ever set, so no calls should be made
      expectNoLoggerCalls(mockLogger);
    });

    it("should forward to global logger when configured", () => {
      setGlobalLogger(mockLogger);

      logger.debug("test message");

      expectSingleLoggerCall(mockLogger, "debug");
      expectLoggerCall(mockLogger, "debug", ["test message"]);
    });

    it("should forward multiple arguments correctly", () => {
      setGlobalLogger(mockLogger);

      const args = ["message", 42, { key: "value" }, [1, 2, 3]];
      logger.debug(...args);

      expectLoggerCall(mockLogger, "debug", args);
    });

    it("should handle no arguments", () => {
      setGlobalLogger(mockLogger);

      logger.debug();

      expectSingleLoggerCall(mockLogger, "debug");
      expectLoggerCall(mockLogger, "debug", []);
    });

    it("should switch between no-op and forwarding based on configuration", () => {
      // Start unconfigured - should be no-op
      logger.debug("ignored");
      expectNoLoggerCalls(mockLogger);

      // Configure logger - should forward
      setGlobalLogger(mockLogger);
      logger.debug("forwarded");
      expectSingleLoggerCall(mockLogger, "debug");

      // Clear logger - should be no-op again
      clearGlobalLogger();
      resetMockLogger(mockLogger);
      logger.debug("ignored again");
      expectNoLoggerCalls(mockLogger);
    });
  });

  describe("logger.info()", () => {
    it("should be no-op when global logger is null", () => {
      expect(getGlobalLogger()).toBeNull();

      logger.info("test message");
      logger.info("multiple", "arguments", { key: "value" });

      expectNoLoggerCalls(mockLogger);
    });

    it("should forward to global logger when configured", () => {
      setGlobalLogger(mockLogger);

      logger.info("info message");

      expectSingleLoggerCall(mockLogger, "info");
      expectLoggerCall(mockLogger, "info", ["info message"]);
    });

    it("should forward complex arguments correctly", () => {
      setGlobalLogger(mockLogger);

      const errorObj = new Error("test error");
      const complexArgs = [
        "Operation completed",
        errorObj,
        { status: "success", count: 5 },
      ];

      logger.info(...complexArgs);

      expectLoggerCall(mockLogger, "info", complexArgs);
    });

    it("should handle undefined and null arguments", () => {
      setGlobalLogger(mockLogger);

      logger.info("message with", null, "and", undefined);

      expectLoggerCall(mockLogger, "info", [
        "message with",
        null,
        "and",
        undefined,
      ]);
    });
  });

  describe("logger.warn()", () => {
    it("should be no-op when global logger is null", () => {
      expect(getGlobalLogger()).toBeNull();

      logger.warn("warning message");
      logger.warn("multiple warnings", "with context");

      expectNoLoggerCalls(mockLogger);
    });

    it("should forward to global logger when configured", () => {
      setGlobalLogger(mockLogger);

      logger.warn("deprecation warning");

      expectSingleLoggerCall(mockLogger, "warn");
      expectLoggerCall(mockLogger, "warn", ["deprecation warning"]);
    });

    it("should preserve warning message formatting", () => {
      setGlobalLogger(mockLogger);

      const warningArgs = [
        "Performance warning:",
        "Operation took",
        1500,
        "ms",
        { threshold: 1000, actual: 1500 },
      ];

      logger.warn(...warningArgs);

      expectLoggerCall(mockLogger, "warn", warningArgs);
    });
  });

  describe("logger.error()", () => {
    it("should be no-op when global logger is null", () => {
      expect(getGlobalLogger()).toBeNull();

      logger.error("error message");
      logger.error("multiple", "error", "arguments");

      expectNoLoggerCalls(mockLogger);
    });

    it("should forward to global logger when configured", () => {
      setGlobalLogger(mockLogger);

      logger.error("critical error");

      expectSingleLoggerCall(mockLogger, "error");
      expectLoggerCall(mockLogger, "error", ["critical error"]);
    });

    it("should handle Error objects correctly", () => {
      setGlobalLogger(mockLogger);

      const error = new Error("Something went wrong");
      const context = { operation: "test", retry: false };

      logger.error("Operation failed:", error, context);

      expectLoggerCall(mockLogger, "error", [
        "Operation failed:",
        error,
        context,
      ]);
    });

    it("should handle stack traces and complex error data", () => {
      setGlobalLogger(mockLogger);

      const error = new Error("Complex error");
      error.stack = "Error: Complex error\n    at test (/path/to/file.js:10:5)";

      logger.error("Stack trace:", error, {
        errorCode: "ERR_001",
        severity: "high",
      });

      expectSingleLoggerCall(mockLogger, "error");
      expect(mockLogger.error.mock.calls[0][0]).toBe("Stack trace:");
      expect(mockLogger.error.mock.calls[0][1]).toBe(error);
      expect(mockLogger.error.mock.calls[0][2]).toEqual({
        errorCode: "ERR_001",
        severity: "high",
      });
    });
  });

  // =============================================================================
  // Cross-Method Integration Tests
  // =============================================================================

  describe("Multiple Log Levels", () => {
    it("should handle mixed log levels when configured", () => {
      setGlobalLogger(mockLogger);

      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");

      expectSingleLoggerCall(mockLogger, "debug");
      expectSingleLoggerCall(mockLogger, "info");
      expectSingleLoggerCall(mockLogger, "warn");
      expectSingleLoggerCall(mockLogger, "error");

      expect(getTotalLoggerCalls(mockLogger)).toBe(4);
    });

    it("should ignore all log levels when unconfigured", () => {
      expect(getGlobalLogger()).toBeNull();

      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");

      expectNoLoggerCalls(mockLogger);
      expect(getTotalLoggerCalls(mockLogger)).toBe(0);
    });

    it("should switch all levels simultaneously with configuration changes", () => {
      // All should be no-op initially
      logger.debug("1");
      logger.info("1");
      logger.warn("1");
      logger.error("1");
      expectNoLoggerCalls(mockLogger);

      // Configure - all should forward
      setGlobalLogger(mockLogger);
      logger.debug("2");
      logger.info("2");
      logger.warn("2");
      logger.error("2");
      expect(getTotalLoggerCalls(mockLogger)).toBe(4);

      // Clear - all should be no-op again
      clearGlobalLogger();
      resetMockLogger(mockLogger);
      logger.debug("3");
      logger.info("3");
      logger.warn("3");
      logger.error("3");
      expectNoLoggerCalls(mockLogger);
    });
  });

  // =============================================================================
  // Performance and Edge Case Tests
  // =============================================================================

  describe("Performance Characteristics", () => {
    it("should have minimal overhead when unconfigured", () => {
      expect(getGlobalLogger()).toBeNull();

      // These calls should return immediately without any processing
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        logger.debug("performance test", i);
        logger.info("performance test", i);
        logger.warn("performance test", i);
        logger.error("performance test", i);
      }
      const end = performance.now();

      // Should complete very quickly (less than 10ms for 4000 no-op calls)
      expect(end - start).toBeLessThan(10);
      expectNoLoggerCalls(mockLogger);
    });

    it("should handle rapid logger configuration changes", () => {
      const logger1 = createMockLogger();
      const logger2 = createMockLogger();

      // Rapid switching
      setGlobalLogger(logger1);
      logger.info("msg1");

      setGlobalLogger(logger2);
      logger.info("msg2");

      clearGlobalLogger();
      logger.info("msg3"); // no-op

      setGlobalLogger(logger1);
      logger.info("msg4");

      // Verify correct routing
      expect(logger1.info).toHaveBeenCalledTimes(2);
      expect(logger1.info).toHaveBeenNthCalledWith(1, "msg1");
      expect(logger1.info).toHaveBeenNthCalledWith(2, "msg4");

      expect(logger2.info).toHaveBeenCalledTimes(1);
      expect(logger2.info).toHaveBeenCalledWith("msg2");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string arguments", () => {
      setGlobalLogger(mockLogger);

      logger.debug("");
      logger.info("", "", "");
      logger.warn("message", "", "end");
      logger.error("");

      expectLoggerCall(mockLogger, "debug", [""]);
      expectLoggerCall(mockLogger, "info", ["", "", ""]);
      expectLoggerCall(mockLogger, "warn", ["message", "", "end"]);
      expectLoggerCall(mockLogger, "error", [""]);
    });

    it("should handle very large argument lists", () => {
      setGlobalLogger(mockLogger);

      const largeArgList = Array.from({ length: 100 }, (_, i) => `arg${i}`);
      logger.info(...largeArgList);

      expectLoggerCall(mockLogger, "info", largeArgList);
    });

    it("should handle circular references in objects", () => {
      setGlobalLogger(mockLogger);

      const circularObj: { name: string; self?: unknown } = { name: "test" };
      circularObj.self = circularObj;

      // Should not throw, just pass the object as-is to the logger
      expect(() => {
        logger.warn("Circular object:", circularObj);
      }).not.toThrow();

      expectLoggerCall(mockLogger, "warn", ["Circular object:", circularObj]);
    });

    it("should preserve function references in arguments", () => {
      setGlobalLogger(mockLogger);

      const testFunction = () => "test";
      logger.debug("Function:", testFunction);

      expectLoggerCall(mockLogger, "debug", ["Function:", testFunction]);
      expect(mockLogger.debug.mock.calls[0][1]).toBe(testFunction);
    });
  });

  // =============================================================================
  // State Isolation Tests
  // =============================================================================

  describe("Test State Isolation", () => {
    it("should start each test with clean slate", () => {
      // This test verifies our beforeEach/afterEach hooks work correctly
      expect(getGlobalLogger()).toBeNull();
      expect(isLoggerConfigured()).toBe(false);
      expectNoLoggerCalls(mockLogger);
    });

    it("should not interfere with subsequent tests", () => {
      // Modify state in this test
      setGlobalLogger(mockLogger);
      logger.info("test message");

      expect(isLoggerConfigured()).toBe(true);
      expectSingleLoggerCall(mockLogger, "info");

      // State will be cleaned up by afterEach
    });

    it("should have clean state despite previous test", () => {
      // Verify the previous test didn't affect this one
      expect(getGlobalLogger()).toBeNull();
      expect(isLoggerConfigured()).toBe(false);
      expectNoLoggerCalls(mockLogger);
    });
  });

  // =============================================================================
  // Logger Interface Compatibility Tests
  // =============================================================================

  describe("Logger Interface Compatibility", () => {
    it("should maintain exact method signatures with underlying logger", () => {
      setGlobalLogger(mockLogger);

      // Test all method signatures match
      const debugResult = logger.debug("test");
      const infoResult = logger.info("test");
      const warnResult = logger.warn("test");
      const errorResult = logger.error("test");

      // All logging methods should return void
      expect(debugResult).toBeUndefined();
      expect(infoResult).toBeUndefined();
      expect(warnResult).toBeUndefined();
      expect(errorResult).toBeUndefined();
    });

    it("should work with logger implementations that return values", () => {
      // Create a mock logger that returns values (some loggers might do this)
      const returningLogger = {
        debug: vi.fn().mockReturnValue("debug-return"),
        info: vi.fn().mockReturnValue("info-return"),
        warn: vi.fn().mockReturnValue("warn-return"),
        error: vi.fn().mockReturnValue("error-return"),
      };

      setGlobalLogger(returningLogger);

      // Global logger should still return void regardless
      expect(logger.debug("test")).toBeUndefined();
      expect(logger.info("test")).toBeUndefined();
      expect(logger.warn("test")).toBeUndefined();
      expect(logger.error("test")).toBeUndefined();

      // But the underlying logger should still be called
      expect(returningLogger.debug).toHaveBeenCalledWith("test");
      expect(returningLogger.info).toHaveBeenCalledWith("test");
      expect(returningLogger.warn).toHaveBeenCalledWith("test");
      expect(returningLogger.error).toHaveBeenCalledWith("test");
    });
  });
});
