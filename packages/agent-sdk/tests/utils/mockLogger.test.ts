/**
 * Test suite for Mock Logger Utilities
 */

import { describe, it, expect } from "vitest";
import {
  createMockLogger,
  resetMockLogger,
  clearMockLogger,
  expectNoLoggerCalls,
  expectLoggerCall,
  expectSingleLoggerCall,
  getTotalLoggerCalls,
} from "./mockLogger.js";

describe("mockLogger utilities", () => {
  describe("createMockLogger", () => {
    it("should create a mock logger with all required methods", () => {
      const mockLogger = createMockLogger();

      expect(mockLogger.debug).toBeDefined();
      expect(mockLogger.info).toBeDefined();
      expect(mockLogger.warn).toBeDefined();
      expect(mockLogger.error).toBeDefined();

      // Verify all methods are mock functions
      expect(mockLogger.debug).toBeTypeOf("function");
      expect(mockLogger.info).toBeTypeOf("function");
      expect(mockLogger.warn).toBeTypeOf("function");
      expect(mockLogger.error).toBeTypeOf("function");
    });

    it("should allow calling logger methods without errors", () => {
      const mockLogger = createMockLogger();

      expect(() => {
        mockLogger.debug("test debug message");
        mockLogger.info("test info message");
        mockLogger.warn("test warn message");
        mockLogger.error("test error message");
      }).not.toThrow();
    });
  });

  describe("resetMockLogger", () => {
    it("should reset all mock functions", () => {
      const mockLogger = createMockLogger();

      // Call some methods
      mockLogger.debug("test");
      mockLogger.info("test");

      // Reset the mocks
      resetMockLogger(mockLogger);

      // Verify calls are reset
      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe("clearMockLogger", () => {
    it("should clear all mock calls", () => {
      const mockLogger = createMockLogger();

      // Call some methods
      mockLogger.debug("test");
      mockLogger.warn("test");

      // Clear the mocks
      clearMockLogger(mockLogger);

      // Verify calls are cleared
      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("expectNoLoggerCalls", () => {
    it("should pass when no logger methods were called", () => {
      const mockLogger = createMockLogger();

      expect(() => {
        expectNoLoggerCalls(mockLogger);
      }).not.toThrow();
    });

    it("should fail when logger methods were called", () => {
      const mockLogger = createMockLogger();
      mockLogger.debug("test");

      expect(() => {
        expectNoLoggerCalls(mockLogger);
      }).toThrow();
    });
  });

  describe("expectLoggerCall", () => {
    it("should verify specific logger method calls with arguments", () => {
      const mockLogger = createMockLogger();
      const testMessage = "test message";
      const testError = new Error("test error");

      mockLogger.error(testMessage, testError);

      expect(() => {
        expectLoggerCall(mockLogger, "error", [testMessage, testError]);
      }).not.toThrow();
    });
  });

  describe("expectSingleLoggerCall", () => {
    it("should verify a method was called exactly once", () => {
      const mockLogger = createMockLogger();

      mockLogger.info("test");

      expect(() => {
        expectSingleLoggerCall(mockLogger, "info");
      }).not.toThrow();
    });

    it("should fail when method was called multiple times", () => {
      const mockLogger = createMockLogger();

      mockLogger.info("test1");
      mockLogger.info("test2");

      expect(() => {
        expectSingleLoggerCall(mockLogger, "info");
      }).toThrow();
    });
  });

  describe("getTotalLoggerCalls", () => {
    it("should return total number of calls across all log levels", () => {
      const mockLogger = createMockLogger();

      expect(getTotalLoggerCalls(mockLogger)).toBe(0);

      mockLogger.debug("debug");
      mockLogger.info("info");
      mockLogger.warn("warn");
      mockLogger.error("error");

      expect(getTotalLoggerCalls(mockLogger)).toBe(4);

      mockLogger.info("another info");
      expect(getTotalLoggerCalls(mockLogger)).toBe(5);
    });
  });
});
