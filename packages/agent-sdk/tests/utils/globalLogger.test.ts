/**
 * 全局 logger 注册表：谁被装上、日志会不会被转发、没装的时候是不是真的什么都不做。
 *
 * `logger.*` 只是转发层 —— 参数原样交给被装上的实现，返回值一律 void。所以这里
 * 只钉四件事（装/卸、转发、不转发、换实例改投），不去测「转发器怎么转发」的
 * 每一种参数形状。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setGlobalLogger,
  clearGlobalLogger,
  isLoggerConfigured,
  logger,
  logError,
  logWarn,
} from "../../src/utils/globalLogger.js";
import {
  createMockLogger,
  resetMockLogger,
  expectNoLoggerCalls,
  expectLoggerCall,
  type MockLogger,
} from "./mockLogger.js";

describe("global logger registry", () => {
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    clearGlobalLogger();
  });

  afterEach(() => {
    clearGlobalLogger();
    resetMockLogger(mockLogger);
  });

  it("装上之后 isLoggerConfigured 为真，卸掉之后为假", () => {
    expect(isLoggerConfigured()).toBe(false);

    setGlobalLogger(mockLogger);
    expect(isLoggerConfigured()).toBe(true);

    clearGlobalLogger();
    expect(isLoggerConfigured()).toBe(false);
  });

  it("把每个级别连同参数原样转给被装上的 logger", () => {
    setGlobalLogger(mockLogger);
    const error = new Error("bad");

    logger.debug("d", 1, { k: "v" });
    logger.info("i");
    logger.warn("w", error);
    logger.error("e");

    expectLoggerCall(mockLogger, "debug", ["d", 1, { k: "v" }]);
    expectLoggerCall(mockLogger, "info", ["i"]);
    expectLoggerCall(mockLogger, "warn", ["w", error]);
    expectLoggerCall(mockLogger, "error", ["e"]);
  });

  it("没有装上时四个级别都是空操作", () => {
    expect(isLoggerConfigured()).toBe(false);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expectNoLoggerCalls(mockLogger);
  });

  it("换一个 logger 之后日志改投新实例，不再投旧的", () => {
    const next = createMockLogger();

    setGlobalLogger(mockLogger);
    logger.info("first");
    setGlobalLogger(next);
    logger.info("second");

    expectLoggerCall(mockLogger, "info", ["first"]);
    expectLoggerCall(next, "info", ["second"]);
  });

  describe("logError/logWarn 的落点（TTY × 是否装了 logger）", () => {
    const originalIsTTY = process.stdout.isTTY;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("should route to the global logger on a TTY with a configured logger", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      setGlobalLogger(mockLogger);

      const error = new Error("bad");
      logError("boom", error);
      logWarn("heads up");

      expectLoggerCall(mockLogger, "error", ["boom", error]);
      expectLoggerCall(mockLogger, "warn", ["heads up"]);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should fall back to stderr on a TTY without a configured logger", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      clearGlobalLogger();

      logError("boom");
      logWarn("heads up");

      expect(consoleErrorSpy).toHaveBeenCalledWith("boom");
      expect(consoleWarnSpy).toHaveBeenCalledWith("heads up");
      expectNoLoggerCalls(mockLogger);
    });

    it("should use stderr on a non-TTY even with a configured logger", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });
      setGlobalLogger(mockLogger);

      logError("boom");
      logWarn("heads up");

      expect(consoleErrorSpy).toHaveBeenCalledWith("boom");
      expect(consoleWarnSpy).toHaveBeenCalledWith("heads up");
      expectNoLoggerCalls(mockLogger);
    });

    it("should use stderr on a non-TTY without a configured logger", () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        configurable: true,
      });
      clearGlobalLogger();

      logError("boom");
      logWarn("heads up");

      expect(consoleErrorSpy).toHaveBeenCalledWith("boom");
      expect(consoleWarnSpy).toHaveBeenCalledWith("heads up");
      expectNoLoggerCalls(mockLogger);
    });
  });
});
