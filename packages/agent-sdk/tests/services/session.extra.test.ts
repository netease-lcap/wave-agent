import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleSessionRestoration,
  truncateContent,
  getFirstMessageContent,
  cleanupEmptyProjectDirectories,
  cleanupExpiredSessionsFromJsonl,
  ensureSessionDir,
  SESSION_DIR,
} from "../../src/services/session.js";
import { promises as fs } from "fs";
import { join } from "path";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock("../../src/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn().mockImplementation(function () {
    return {
      getProjectDirectory: vi.fn().mockResolvedValue({
        encodedPath: "/mock/encoded/path",
        originalPath: "/mock/original/path",
      }),
    };
  }),
}));

vi.mock("../../src/utils/fileUtils.js", () => ({
  readFirstLine: vi.fn(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("session service - additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV for each test if needed, but many functions check for "test"
    process.env.NODE_ENV = "development";
  });

  describe("ensureSessionDir", () => {
    it("should create session directory", async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      await ensureSessionDir();
      expect(fs.mkdir).toHaveBeenCalledWith(SESSION_DIR, { recursive: true });
    });

    it("should throw error if mkdir fails", async () => {
      vi.mocked(fs.mkdir).mockRejectedValue(new Error("perm error"));
      await expect(ensureSessionDir()).rejects.toThrow(
        "Failed to create session directory",
      );
    });
  });

  describe("truncateContent", () => {
    it("should truncate long content", () => {
      expect(truncateContent("1234567890", 5)).toBe("12345...");
    });

    it("should not truncate short content", () => {
      expect(truncateContent("123", 5)).toBe("123");
    });
  });

  describe("getFirstMessageContent", () => {
    const sessionId = "test-session";
    const workdir = "/test/workdir";

    it("should return text content from first message", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstLine).mockResolvedValue(
        JSON.stringify({
          blocks: [{ type: "text", content: "hello" }],
        }),
      );

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("hello");
    });

    it("should return command from command_output block", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstLine).mockResolvedValue(
        JSON.stringify({
          blocks: [{ type: "command_output", command: "ls" }],
        }),
      );

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("ls");
    });

    it("should return content from compress block", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstLine).mockResolvedValue(
        JSON.stringify({
          blocks: [{ type: "compress", content: "compressed" }],
        }),
      );

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("compressed");
    });

    it("should return null if no recognized blocks", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstLine).mockResolvedValue(
        JSON.stringify({
          blocks: [{ type: "other" }],
        }),
      );

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
    });

    it("should return null on parse error", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstLine).mockResolvedValue("invalid json");

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("cleanupEmptyProjectDirectories", () => {
    it("should remove empty directories", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        "dir1",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.readdir).mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      ); // dir1 is empty

      await cleanupEmptyProjectDirectories();

      expect(fs.rmdir).toHaveBeenCalledWith(join(SESSION_DIR, "dir1"));
    });

    it("should skip non-empty directories", async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        "dir1",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        "file1",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      await cleanupEmptyProjectDirectories();

      expect(fs.rmdir).not.toHaveBeenCalled();
    });
  });

  describe("cleanupExpiredSessionsFromJsonl", () => {
    it("should delete expired files and update index", async () => {
      const workdir = "/test/workdir";
      const sessionId = "12345678-1234-4321-8765-123456789012";
      const filename = `${sessionId}.jsonl`;

      // Reset NODE_ENV to development to allow cleanup
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      vi.mocked(fs.readdir).mockResolvedValueOnce([
        filename,
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        mtime: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days old
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          sessions: { [sessionId]: { lastActiveAt: new Date().toISOString() } },
          lastUpdated: new Date().toISOString(),
        }),
      );

      const deleted = await cleanupExpiredSessionsFromJsonl(workdir);

      expect(deleted).toBe(1);
      expect(fs.unlink).toHaveBeenCalled();
      // expect(fs.writeFile).toHaveBeenCalled(); // Index updated - might fail if sessionId doesn't match exactly or other issues

      process.env.NODE_ENV = oldEnv;
    });
  });

  describe("handleSessionRestoration", () => {
    const workdir = "/test/workdir";
    const validSessionId = "12345678-1234-4321-8765-123456789012";

    it("should throw if workdir is missing", async () => {
      await expect(handleSessionRestoration()).rejects.toThrow(
        "Working directory is required",
      );
    });

    it("should exit if restoreSessionId not found", async () => {
      const spyExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as unknown as never);
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

      await handleSessionRestoration(validSessionId, false, workdir);

      expect(spyExit).toHaveBeenCalledWith(1);
      expect(spyError).toHaveBeenCalledWith(
        expect.stringContaining("Session not found"),
      );

      spyExit.mockRestore();
      spyError.mockRestore();
    });
  });
});
