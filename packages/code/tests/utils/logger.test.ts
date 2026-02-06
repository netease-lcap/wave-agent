import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import {
  logger,
  LogLevel,
  getLogConfig,
  getLogFile,
  cleanupLogs,
} from "../../src/utils/logger.js";
import { DATA_DIRECTORY } from "../../src/utils/constants.js";

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe("Logger Utility", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    // Default to disabling IO to avoid side effects unless testing IO
    process.env.DISABLE_LOGGER_IO = "true";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Log Level and Keyword Parsing", () => {
    it("should parse log level from environment variables", () => {
      const config = getLogConfig();
      expect(config).toBeDefined();
      expect(Object.values(LogLevel)).toContain(config.level);
    });

    it("should have correct log level names", () => {
      // We can verify this by logging and checking the output
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const appendSpy = vi.mocked(fs.appendFileSync);

      logger.debug("test debug");
      logger.info("test info");
      logger.warn("test warn");
      logger.error("test error");

      const calls = appendSpy.mock.calls.map((call) => call[1] as string);

      // Depending on the initial log level, some might not be called.
      // But we can check the ones that are.
      calls.forEach((msg) => {
        if (msg.includes("test debug")) expect(msg).toContain("[DEBUG]");
        if (msg.includes("test info")) expect(msg).toContain("[INFO]");
        if (msg.includes("test warn")) expect(msg).toContain("[WARN]");
        if (msg.includes("test error")) expect(msg).toContain("[ERROR]");
      });
    });
  });

  describe("formatArg", () => {
    // We can't directly access formatArg as it's not exported,
    // but we can test it through logger.info
    it("should format different types correctly", () => {
      const appendSpy = vi.mocked(fs.appendFileSync);
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);

      logger.info(null);
      expect(appendSpy.mock.calls[0][1]).toContain("null");

      logger.info(undefined);
      expect(appendSpy.mock.calls[1][1]).toContain("undefined");

      const err = new Error("test error");
      err.stack = "stack trace";
      logger.info(err);
      expect(appendSpy.mock.calls[2][1]).toContain("stack trace");

      const obj = { a: 1, b: { c: 2 } };
      logger.info(obj);
      expect(appendSpy.mock.calls[3][1]).toContain(
        JSON.stringify(obj, null, 2),
      );

      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      logger.info(circular);
      expect(appendSpy.mock.calls[4][1]).toContain("[object Object]");

      logger.info("hello", 123, true);
      expect(appendSpy.mock.calls[5][1]).toContain("hello 123 true");
    });
  });

  describe("shouldLog logic", () => {
    it("should respect log level", () => {
      const appendSpy = vi.mocked(fs.appendFileSync);
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // We need to know the current log level to test this.
      // Default is INFO (1).
      const config = getLogConfig();

      if (config.level <= LogLevel.INFO) {
        logger.debug("debug message");
        // If level is INFO, debug should not be logged.
        if (config.level === LogLevel.INFO) {
          expect(appendSpy).not.toHaveBeenCalled();
        }

        logger.info("info message");
        expect(appendSpy).toHaveBeenCalled();
      }
    });
  });

  describe("logMessage behavior", () => {
    it("should write to file when enabled", () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);

      logger.info("test message");

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        getLogFile(),
        expect.stringContaining("[INFO] test message"),
      );
    });

    it("should respect DISABLE_LOGGER_IO", () => {
      process.env.DISABLE_LOGGER_IO = "true";
      vi.mocked(fs.existsSync).mockReturnValue(true);

      logger.info("test message");

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it("should handle directory creation", () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      logger.info("test message");

      expect(fs.mkdirSync).toHaveBeenCalledWith(DATA_DIRECTORY, {
        recursive: true,
      });
      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    it("should fallback to stderr on write failure", () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error("write error");
      });

      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      logger.info("test message");

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write to log file"),
      );
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("[INFO] test message"),
      );

      stderrSpy.mockRestore();
    });
  });

  describe("cleanupLogs and truncateLogFileIfNeeded", () => {
    it("should truncate file when it exceeds maxFileSize", async () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ size: 2000 } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        "line1\nline2\nline3\nline4\nline5",
      );

      await cleanupLogs({ maxFileSize: 1000, keepLines: 3 });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        getLogFile(),
        "line3\nline4\nline5",
      );
    });

    it("should respect DISABLE_LOGGER_IO in cleanup", async () => {
      process.env.DISABLE_LOGGER_IO = "true";

      await cleanupLogs();

      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it("should handle missing log file in cleanup", async () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await cleanupLogs();

      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it("should handle errors during truncation", async () => {
      process.env.DISABLE_LOGGER_IO = "false";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error("stat error");
      });

      // Should not throw
      await expect(cleanupLogs()).resolves.not.toThrow();
    });
  });
});
