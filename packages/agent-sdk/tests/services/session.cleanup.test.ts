import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cleanupEmptyProjectDirectories,
  cleanupMetaOnlySessions,
  ensureSessionDir,
  SESSION_DIR,
} from "../../src/services/session.js";
import { promises as fs } from "fs";
import { join } from "path";

const { mockGetLastMessage, mockJsonlRead } = vi.hoisted(() => ({
  mockGetLastMessage: vi.fn(),
  mockJsonlRead: vi.fn(),
}));

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
  readFirstNLines: vi.fn(),
}));

// JsonlHandler reads via fs/promises, which the fs mock above doesn't cover.
// Override only getLastMessage/getLatestTotalTokens/read on real instances so
// cleanupMetaOnlySessions' decision logic can be tested in isolation.
vi.mock("../../src/services/jsonlHandler.js", async (importOriginal) => {
  const actual = (await importOriginal()) as {
    JsonlHandler: new () => {
      getLastMessage: (filePath: string) => Promise<unknown>;
      read: (filePath: string) => Promise<unknown>;
      [key: string]: unknown;
    };
  };
  return {
    ...actual,
    JsonlHandler: vi.fn().mockImplementation(function () {
      const instance = new actual.JsonlHandler();
      instance.getLastMessage = mockGetLastMessage;
      instance.getLatestTotalTokens = async () => 0;
      instance.read = mockJsonlRead;
      return instance;
    }),
  };
});

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("session service cleanup", () => {
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

  describe("cleanupMetaOnlySessions", () => {
    const metaMessage = {
      role: "user",
      isMeta: true,
      timestamp: new Date().toISOString(),
      blocks: [
        {
          type: "text",
          content: "<system-reminder>SessionStart context</system-reminder>",
        },
      ],
    } as const;
    const realMessage = {
      role: "user",
      timestamp: new Date().toISOString(),
      blocks: [{ type: "text", content: "Hello" }],
    } as const;

    it("should delete session files that contain only meta messages", async () => {
      const filePath = join(SESSION_DIR, "project1", "session1.jsonl");

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["project1"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >)
        .mockResolvedValueOnce([
          "session1.jsonl",
          "readme.txt",
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      mockGetLastMessage.mockResolvedValue(metaMessage);
      mockJsonlRead.mockResolvedValue([metaMessage, metaMessage]);

      const deleted = await cleanupMetaOnlySessions();

      expect(deleted).toBe(1);
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(fs.unlink).toHaveBeenCalledWith(filePath);
      // Non-jsonl files are skipped
      expect(fs.unlink).not.toHaveBeenCalledWith(
        join(SESSION_DIR, "project1", "readme.txt"),
      );
    });

    it("should keep files whose last message is a real message (fast path)", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["project1"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >)
        .mockResolvedValueOnce(["session1.jsonl"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >);
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      // Fast path: last message is NOT meta -> full read is skipped
      mockGetLastMessage.mockResolvedValue(realMessage);

      const deleted = await cleanupMetaOnlySessions();

      expect(deleted).toBe(0);
      expect(mockJsonlRead).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it("should keep files that mix meta and real messages", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["project1"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >)
        .mockResolvedValueOnce(["session1.jsonl"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >);
      vi.mocked(fs.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.stat>>);
      // Last message is meta (e.g. a plan-mode reminder appended after a real
      // conversation), but the file contains a real message earlier.
      mockGetLastMessage.mockResolvedValue(metaMessage);
      mockJsonlRead.mockResolvedValue([realMessage, metaMessage]);

      const deleted = await cleanupMetaOnlySessions();

      expect(deleted).toBe(0);
      expect(mockJsonlRead).toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it("should skip non-directory entries and unreadable files", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["file.txt"] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >)
        .mockResolvedValueOnce(
          [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );
      vi.mocked(fs.stat)
        // First stat: the top-level "file.txt" is not a directory
        .mockResolvedValueOnce({
          isDirectory: () => false,
        } as unknown as Awaited<ReturnType<typeof fs.stat>>)
        // Second stat: inner dir stat fails -> skipped
        .mockRejectedValueOnce(new Error("ENOENT"));

      const deleted = await cleanupMetaOnlySessions();

      expect(deleted).toBe(0);
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it("should return 0 without touching disk in test environment", async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";

      const deleted = await cleanupMetaOnlySessions();

      expect(deleted).toBe(0);
      expect(fs.readdir).not.toHaveBeenCalled();

      process.env.NODE_ENV = oldEnv;
    });
  });
});
