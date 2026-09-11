import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFirstMessageContent } from "../../src/services/session.js";
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

describe("session service first message content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV for each test if needed, but many functions check for "test"
    process.env.NODE_ENV = "development";
  });

  describe("getFirstMessageContent", () => {
    const sessionId = "test-session";
    const workdir = "/test/workdir";

    it("should return text content from first message", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          blocks: [{ type: "text", content: "hello" }],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("hello");
    });

    it("should return command from bash-mode user message", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          blocks: [{ type: "text", content: "ls" }],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("ls");
    });

    it("should return content from compact block", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          blocks: [
            {
              type: "compact",
              content: "compacted",
              sessionId: "test-session",
            },
          ],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("compacted");
    });

    it("should return text block content", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          blocks: [
            {
              type: "text",
              content: "Hello world",
            },
          ],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("Hello world");
    });

    it("should return null if no recognized blocks", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          blocks: [{ type: "other" }],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
    });

    it("should return null on parse error", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue(["invalid json"]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should skip meta message and return second message", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          isMeta: true,
          blocks: [{ type: "text", content: "system init" }],
        }),
        JSON.stringify({
          blocks: [{ type: "text", content: "hello" }],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("hello");
    });

    it("should skip multiple consecutive meta messages", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          isMeta: true,
          blocks: [{ type: "text", content: "hook1" }],
        }),
        JSON.stringify({
          isMeta: true,
          blocks: [{ type: "text", content: "hook2" }],
        }),
        JSON.stringify({
          isMeta: true,
          blocks: [{ type: "text", content: "hook3" }],
        }),
        JSON.stringify({
          blocks: [{ type: "text", content: "real user message" }],
        }),
      ]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBe("real user message");
    });

    it("should return null if all messages are meta", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      const metaLines = Array(10)
        .fill(null)
        .map((_, i) =>
          JSON.stringify({
            isMeta: true,
            blocks: [{ type: "text", content: `meta ${i}` }],
          }),
        );
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue(metaLines);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
    });

    it("should handle empty file gracefully", async () => {
      const fileUtils = await import("../../src/utils/fileUtils.js");
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([]);

      const content = await getFirstMessageContent(sessionId, workdir);
      expect(content).toBeNull();
    });
  });
});
