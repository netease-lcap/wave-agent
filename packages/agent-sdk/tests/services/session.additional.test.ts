import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleSessionRestoration,
  truncateContent,
} from "../../src/services/session.js";
import { promises as fs } from "fs";
import { logger } from "../../src/utils/globalLogger.js";

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

describe("session service additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV for each test if needed, but many functions check for "test"
    process.env.NODE_ENV = "development";
  });

  describe("truncateContent", () => {
    it("should truncate long content", () => {
      expect(truncateContent("1234567890", 5)).toBe("12345...");
    });

    it("should not truncate short content", () => {
      expect(truncateContent("123", 5)).toBe("123");
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

    it("should throw when restoreSessionId is not found (no silent fresh session)", async () => {
      vi.mocked(fs.access).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      await expect(
        handleSessionRestoration(validSessionId, false, workdir),
      ).rejects.toThrow(`Session ${validSessionId} not found on disk`);

      // loadSessionFromJsonl scans all project dirs as a fallback — reaching
      // the throw means the session truly does not exist anywhere.
      expect(fs.readdir).toHaveBeenCalled();
    });

    it("reports the restore through the logger, never through stdout", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      mockJsonlRead.mockResolvedValue([
        {
          id: "msg-1",
          role: "user",
          timestamp: "2026-07-27T10:00:00.000Z",
          blocks: [],
        },
      ]);
      // stdout is the `wave --stdio` JSON-RPC channel: one stray line there
      // makes the host skip that line and log a parse failure for the whole
      // payload (the restore diagnostic used to be a plain console.log).
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const restored = await handleSessionRestoration(
        validSessionId,
        false,
        workdir,
      );

      expect(restored?.id).toBe(validSessionId);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        `Restoring session: ${validSessionId}`,
      );

      consoleLog.mockRestore();
      stdout.mockRestore();
    });
  });
});
