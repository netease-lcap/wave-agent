import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

const {
  mockAppend,
  mockAppendCustomTitle,
  mockReadCustomTitle,
  mockReadMessagesAndCustomTitle,
  mockHandlerCreateSession,
  mockGetLastMessage,
} = vi.hoisted(() => ({
  mockAppend: vi.fn(),
  mockAppendCustomTitle: vi.fn(),
  mockReadCustomTitle: vi.fn(),
  mockReadMessagesAndCustomTitle: vi.fn(),
  mockHandlerCreateSession: vi.fn(),
  mockGetLastMessage: vi.fn(),
}));

vi.mock("fs", () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("child_process", () => ({
  // getGitBranch() promisifies execFile; a bare vi.fn() never invokes the
  // callback, so the promise would hang until the test times out.
  execFile: vi.fn(
    (_f: string, _a: string[], _o: unknown, cb: (e: Error) => void) =>
      cb(new Error("git unavailable")),
  ),
}));

vi.mock("@/utils/fileUtils.js", () => ({
  readFirstLine: vi.fn(),
  readFirstNLines: vi.fn().mockResolvedValue([]),
  getLastLine: vi.fn(),
  readTailLines: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn().mockImplementation(function () {
    return {
      createProjectDirectory: vi.fn().mockResolvedValue({
        encodedPath: "/mock/projects/repo",
        originalPath: "/repo",
      }),
      getProjectDirectory: vi.fn().mockResolvedValue({
        encodedPath: "/mock/projects/repo",
        originalPath: "/repo",
      }),
      decodeSync: vi.fn().mockReturnValue("/repo"),
    };
  }),
}));

vi.mock("@/services/jsonlHandler.js", () => ({
  JsonlHandler: vi.fn().mockImplementation(function () {
    return {
      read: vi.fn().mockResolvedValue([]),
      readMessagesAndCustomTitle: mockReadMessagesAndCustomTitle,
      append: mockAppend,
      appendCustomTitle: mockAppendCustomTitle,
      readCustomTitle: mockReadCustomTitle,
      getLastMessage: mockGetLastMessage,
      getLatestTotalTokens: vi.fn().mockResolvedValue(0),
      createSession: mockHandlerCreateSession,
      readMetadata: vi.fn().mockResolvedValue(null),
      generateSessionFilename: vi.fn(
        (sessionId: string) => `${sessionId}.jsonl`,
      ),
      validateMessages: vi.fn(),
    };
  }),
}));

vi.mock("@/utils/globalLogger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  appendMessages,
  listSessionsFromJsonl,
  loadSessionFromJsonl,
  reAppendSessionMetadata,
  setSessionCustomTitle,
} from "@/services/session.js";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
// session.ts 用 path.join 拼路径，Windows 上分隔符是 `\`，断言必须同样用 join。
const SESSION_FILE = join("/mock/projects/repo", `${SESSION_ID}.jsonl`);
/** The listing only accepts `UUID.jsonl` filenames as session files. */
const UUID_FILE = `${SESSION_ID}.jsonl`;

describe("session custom title", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "development";

    const fsPromises = (await import("fs")).promises;
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readdir).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>,
    );

    mockReadCustomTitle.mockResolvedValue(undefined);
    mockReadMessagesAndCustomTitle.mockResolvedValue({ messages: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setSessionCustomTitle()", () => {
    it("appends a custom-title entry to the existing session file", async () => {
      await setSessionCustomTitle(SESSION_ID, "/repo", "  我的标题  ");

      expect(mockAppendCustomTitle).toHaveBeenCalledWith(
        SESSION_FILE,
        "我的标题",
        SESSION_ID,
      );
    });

    it("does nothing for a blank title (not a signal to clear)", async () => {
      await setSessionCustomTitle(SESSION_ID, "/repo", "   ");

      expect(mockAppendCustomTitle).not.toHaveBeenCalled();
      expect(mockHandlerCreateSession).not.toHaveBeenCalled();
    });

    it("materializes the transcript so a title can be set before the first message", async () => {
      const fsPromises = (await import("fs")).promises;
      vi.mocked(fsPromises.access).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      await setSessionCustomTitle(SESSION_ID, "/repo", "过早命名");

      expect(mockHandlerCreateSession).toHaveBeenCalledWith(
        SESSION_FILE,
        expect.objectContaining({ workdir: "/repo" }),
      );
      expect(mockAppendCustomTitle).toHaveBeenCalledWith(
        SESSION_FILE,
        "过早命名",
        SESSION_ID,
      );
    });
  });

  describe("appendMessages()", () => {
    it("writes only the batch — saving never re-appends the title", async () => {
      mockReadCustomTitle.mockResolvedValue("我的标题");

      await appendMessages(
        SESSION_ID,
        [
          {
            id: "m-1",
            role: "user",
            blocks: [{ type: "text", content: "hi" }],
            timestamp: "2024-05-05T00:00:00.000Z",
          },
        ],
        "/repo",
      );

      expect(mockAppend).toHaveBeenCalledWith(SESSION_FILE, expect.any(Array), {
        atomic: false,
      });
      // Keeping the title inside the tail window is the job of
      // reAppendSessionMetadata(), which runs at the sparse flush points; doing
      // it here would cost a tail read plus a line on every single save.
      expect(mockReadCustomTitle).not.toHaveBeenCalled();
      expect(mockAppendCustomTitle).not.toHaveBeenCalled();
    });
  });

  describe("reAppendSessionMetadata()", () => {
    it("writes the title back at EOF", async () => {
      mockReadCustomTitle.mockResolvedValue(undefined);

      await reAppendSessionMetadata(SESSION_ID, "/repo", "我的标题");

      expect(mockReadCustomTitle).toHaveBeenCalledWith(SESSION_FILE);
      expect(mockAppendCustomTitle).toHaveBeenCalledWith(
        SESSION_FILE,
        "我的标题",
        SESSION_ID,
      );
    });

    it("prefers a fresher title written by another process", async () => {
      mockReadCustomTitle.mockResolvedValue("别处改的");

      await reAppendSessionMetadata(SESSION_ID, "/repo", "我的标题");

      expect(mockAppendCustomTitle).toHaveBeenCalledWith(
        SESSION_FILE,
        "别处改的",
        SESSION_ID,
      );
    });

    it("does nothing when there is no title in memory and none in the file", async () => {
      mockReadCustomTitle.mockResolvedValue(undefined);

      await reAppendSessionMetadata(SESSION_ID, "/repo", undefined);

      expect(mockAppendCustomTitle).not.toHaveBeenCalled();
    });

    it("never materializes a transcript that does not exist", async () => {
      const fsPromises = (await import("fs")).promises;
      vi.mocked(fsPromises.access).mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      await reAppendSessionMetadata(SESSION_ID, "/repo", "我的标题");

      expect(mockHandlerCreateSession).not.toHaveBeenCalled();
      expect(mockAppendCustomTitle).not.toHaveBeenCalled();
    });
  });

  describe("loadSessionFromJsonl()", () => {
    it("recovers the title from the transcript", async () => {
      mockReadMessagesAndCustomTitle.mockResolvedValue({
        messages: [
          {
            id: "m-1",
            role: "user",
            blocks: [{ type: "text", content: "hi" }],
            timestamp: "2024-05-05T00:00:00.000Z",
          },
        ],
        customTitle: "登录重构",
      });

      const sessionData = await loadSessionFromJsonl(SESSION_ID, "/repo");

      expect(sessionData?.metadata.customTitle).toBe("登录重构");
    });
  });

  describe("listing", () => {
    it("surfaces the custom title alongside the first-message fallback", async () => {
      const fsPromises = (await import("fs")).promises;
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        UUID_FILE,
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      vi.mocked(fileUtils.readFirstNLines).mockResolvedValue([
        JSON.stringify({
          id: "m-1",
          role: "user",
          blocks: [{ type: "text", content: "帮我重构一下登录逻辑" }],
          timestamp: "2024-05-05T00:00:00.000Z",
        }),
      ]);
      mockGetLastMessage.mockResolvedValue({
        id: "m-1",
        role: "user",
        blocks: [{ type: "text", content: "帮我重构一下登录逻辑" }],
        timestamp: "2024-05-05T00:00:00.000Z",
      });
      mockReadCustomTitle.mockResolvedValue("登录重构");

      const sessions = await listSessionsFromJsonl("/repo");

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.customTitle).toBe("登录重构");
      expect(sessions[0]!.firstMessage).toContain("帮我重构");
    });

    it("leaves customTitle undefined for a never-renamed session", async () => {
      const fsPromises = (await import("fs")).promises;
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        UUID_FILE,
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      mockGetLastMessage.mockResolvedValue({
        id: "m-1",
        role: "user",
        blocks: [{ type: "text", content: "hi" }],
        timestamp: "2024-05-05T00:00:00.000Z",
      });

      const sessions = await listSessionsFromJsonl("/repo");

      expect(sessions[0]!.customTitle).toBeUndefined();
    });
  });
});
