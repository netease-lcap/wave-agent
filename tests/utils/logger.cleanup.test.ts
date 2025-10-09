import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanupLogs, getLogFile } from "@/utils/logger.js";

// Mock the fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock the constants
vi.mock("@/utils/constants", () => ({
  DATA_DIRECTORY: "/mock/data",
  LOG_FILE: "/mock/data/app.log",
}));

describe("Log Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console to suppress log output during tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // 在此测试中启用 logger I/O 操作，因为我们需要测试文件操作功能
    delete process.env.DISABLE_LOGGER_IO;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("cleanupLogs", () => {
    it("should truncate current log file if it exceeds size limit", async () => {
      const fs = await import("fs");
      const logContent = Array(2000).fill("log line").join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 15 * 1024 * 1024,
      } as import("fs").Stats); // 15MB
      vi.mocked(fs.readFileSync).mockReturnValue(logContent);

      await cleanupLogs();

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toBe("/mock/data/app.log");
      // Should keep only the last 1000 lines
      const truncatedContent = writeCall[1] as string;
      const lines = truncatedContent.split("\n");
      expect(lines.length).toBeLessThanOrEqual(1001); // 1000 + potential empty line
    });

    it("should not truncate if log file is within size limit", async () => {
      const fs = await import("fs");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 1024,
      } as import("fs").Stats); // 1KB - within limit

      await cleanupLogs();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it("should use custom configuration when provided", async () => {
      const fs = await import("fs");
      const customConfig = {
        maxFileSize: 5 * 1024 * 1024, // 5MB
        keepLines: 500,
      };

      const logContent = Array(1000).fill("log line").join("\n");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 6 * 1024 * 1024,
      } as import("fs").Stats); // 6MB - exceeds custom limit
      vi.mocked(fs.readFileSync).mockReturnValue(logContent);

      await cleanupLogs(customConfig);

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const truncatedContent = writeCall[1] as string;
      const lines = truncatedContent.split("\n");
      expect(lines.length).toBeLessThanOrEqual(501); // 500 + potential empty line
    });

    it("should handle errors gracefully when file does not exist", async () => {
      const fs = await import("fs");

      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Should not throw error
      await expect(cleanupLogs()).resolves.not.toThrow();

      expect(fs.statSync).not.toHaveBeenCalled();
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should handle file read errors gracefully", async () => {
      const fs = await import("fs");

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        size: 15 * 1024 * 1024,
      } as import("fs").Stats);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File read error");
      });

      // Should not throw error
      await expect(cleanupLogs()).resolves.not.toThrow();
    });
  });

  describe("getLogFile", () => {
    it("should return the log file path", () => {
      const logFile = getLogFile();
      expect(typeof logFile).toBe("string");
      expect(logFile).toBeTruthy();
    });
  });
});
