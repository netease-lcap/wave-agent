import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";

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

vi.mock("../../src/utils/fileUtils.js", () => ({
  readFirstLine: vi.fn(),
  readFirstNLines: vi.fn(),
}));

vi.mock("../../src/services/jsonlHandler.js", () => ({
  JsonlHandler: vi.fn(),
}));

vi.mock("../../src/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn(),
}));

import {
  listSessionsFromJsonl,
  listAllSessions,
  loadSessionFromJsonl,
} from "../../src/services/session.js";
import type { Message } from "../../src/types/index.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";

const SESSION_DIR = join(homedir(), ".wave", "projects");

/** ENOENT error shaped like a Node fs error (code + message). */
const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });

describe("Session resume: cross-directory listing & restore", () => {
  let mockPathEncoder: {
    getProjectDirectory: ReturnType<typeof vi.fn>;
    encode: ReturnType<typeof vi.fn>;
    encodeSync: ReturnType<typeof vi.fn>;
    decodeSync: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
  };
  let mockJsonlHandler: {
    read: ReturnType<typeof vi.fn>;
    getLastMessage: ReturnType<typeof vi.fn>;
    generateSessionFilename: ReturnType<typeof vi.fn>;
  };

  const makeMessage = (timestamp: string): Message =>
    ({
      id: generateMessageId(),
      role: "assistant",
      blocks: [{ type: "text", content: "hello" }],
      timestamp,
      sessionId: randomUUID(),
    }) as Message;

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks): clears mockResolvedValueOnce queues
    // too, preventing stale Once entries from leaking across tests.
    vi.resetAllMocks();

    mockPathEncoder = {
      getProjectDirectory: vi.fn().mockResolvedValue({
        originalPath: "/mock/workdir",
        encodedName: "mock-workdir",
        encodedPath: join(SESSION_DIR, "mock-workdir"),
        pathHash: undefined,
        isSymbolicLink: false,
      }),
      encode: vi.fn().mockImplementation(async (p: string) => p),
      encodeSync: vi.fn().mockImplementation((p: string) => p),
      decodeSync: vi.fn().mockImplementation((name: string) => `/${name}`),
      decode: vi.fn(),
    };

    mockJsonlHandler = {
      read: vi.fn(),
      getLastMessage: vi.fn().mockResolvedValue(null),
      generateSessionFilename: vi
        .fn()
        .mockImplementation(
          (sessionId: string, sessionType: "main" | "subagent" = "main") =>
            sessionType === "main"
              ? `${sessionId}.jsonl`
              : `subagent-${sessionId}.jsonl`,
        ),
    };

    // Point the mocked constructors at our per-test instances
    const { PathEncoder } = await import("../../src/utils/pathEncoder.js");
    const { JsonlHandler } = await import("../../src/services/jsonlHandler.js");
    vi.mocked(PathEncoder).mockImplementation(function () {
      return mockPathEncoder as unknown as InstanceType<typeof PathEncoder>;
    });
    vi.mocked(JsonlHandler).mockImplementation(function () {
      return mockJsonlHandler as unknown as InstanceType<typeof JsonlHandler>;
    });
  });

  describe("7-day window removal", () => {
    it("listSessionsFromJsonl lists sessions last active more than 7 days ago", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();
      const eightDaysAgo = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();

      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        `${sessionId}.jsonl`,
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(
        makeMessage(eightDaysAgo),
      );

      const sessions = await listSessionsFromJsonl("/mock/workdir");

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe(sessionId);
      expect(sessions[0]!.lastActiveAt.toISOString()).toBe(eightDaysAgo);
    });

    it("listAllSessions lists empty session files whose mtime is older than 7 days", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce(["mock-workdir"] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([`${sessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >);
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(null);
      vi.mocked(fs.promises.stat).mockResolvedValueOnce({
        mtime: eightDaysAgo,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);

      const sessions = await listAllSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe(sessionId);
    });
  });

  describe("first-message preview in aggregated listing", () => {
    it("populates firstMessage so Ctrl+A/Ctrl+W rows do not fall back to No content", async () => {
      const fs = await import("fs");
      const { readFirstNLines } = await import("../../src/utils/fileUtils.js");
      const sessionId = randomUUID();

      // Meta messages are skipped; the first real content is returned.
      vi.mocked(readFirstNLines).mockResolvedValue([
        JSON.stringify({
          isMeta: true,
          blocks: [{ type: "text", content: "system init" }],
        }),
        JSON.stringify({
          blocks: [{ type: "text", content: "hello from another project" }],
        }),
      ]);

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce(["home-u-repo"] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([`${sessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >);
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(
        makeMessage(new Date().toISOString()),
      );

      const sessions = await listAllSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.firstMessage).toBe("hello from another project");
    });
  });

  describe("worktree aggregation", () => {
    it("only scans project dirs matching the given worktree paths", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();
      mockPathEncoder.encode.mockImplementation(async (p: string) =>
        p === "/home/u/repo" ? "home-u-repo" : p,
      );

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          "home-u-repo",
          "other-project",
        ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)
        .mockResolvedValueOnce([`${sessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >);
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(
        makeMessage(new Date().toISOString()),
      );

      const sessions = await listAllSessions({
        worktreePaths: ["/home/u/repo"],
        workdir: "/home/u/repo",
      });

      expect(sessions).toHaveLength(1);
      expect(fs.promises.readdir).toHaveBeenCalledWith(
        join(SESSION_DIR, "home-u-repo"),
      );
      expect(fs.promises.readdir).not.toHaveBeenCalledWith(
        join(SESSION_DIR, "other-project"),
      );
    });

    it("does not let a short worktree prefix swallow a longer directory", async () => {
      const fs = await import("fs");
      const repoSession = randomUUID();
      const repoFooSession = randomUUID();

      mockPathEncoder.encode.mockImplementation(async (p: string) =>
        p === "/home/u/repo" ? "home-u-repo" : p,
      );

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          "home-u-repo",
          "home-u-repo-foo",
        ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)
        .mockResolvedValueOnce([`${repoSession}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([
          `${repoFooSession}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(
        makeMessage(new Date().toISOString()),
      );

      // worktreePaths contains only /home/u/repo (short path → exact match only)
      const sessions = await listAllSessions({
        worktreePaths: ["/home/u/repo"],
        workdir: "/home/u/repo",
      });

      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(repoSession);
      expect(ids).not.toContain(repoFooSession);
    });

    it("decodes workdir for display and falls back to the encoded name for hashed dirs", async () => {
      const fs = await import("fs");
      const repoSessionId = randomUUID();
      const hashedSessionId = randomUUID();

      mockPathEncoder.decodeSync.mockImplementation((name: string) =>
        name === "home-u-hashed-abc12345" ? null : `/${name}`,
      );

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          "home-u-repo",
          "home-u-hashed-abc12345",
        ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>)
        .mockResolvedValueOnce([`${repoSessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([
          `${hashedSessionId}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage.mockResolvedValue(
        makeMessage(new Date().toISOString()),
      );

      const sessions = await listAllSessions();

      const workdirs = sessions.map((s) => s.workdir);
      expect(workdirs).toContain("/home-u-repo");
      expect(workdirs).toContain("home-u-hashed-abc12345");
    });
  });

  describe("deduplication", () => {
    it("keeps the newest session when the same id exists in multiple project dirs", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();
      const oldTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const newTime = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce(["dir-a", "dir-b"] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([`${sessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >)
        .mockResolvedValueOnce([`${sessionId}.jsonl`] as unknown as Awaited<
          ReturnType<typeof fs.promises.readdir>
        >);
      vi.mocked(fs.promises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as unknown as Awaited<ReturnType<typeof fs.promises.stat>>);
      mockJsonlHandler.getLastMessage
        .mockResolvedValueOnce(makeMessage(oldTime.toISOString()))
        .mockResolvedValueOnce(makeMessage(newTime.toISOString()));

      const sessions = await listAllSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe(sessionId);
      expect(sessions[0]!.lastActiveAt.getTime()).toBe(newTime.getTime());
    });
  });

  describe("cross-project restore fallback", () => {
    it("loadSessionFromJsonl scans all project dirs when the session is not in workdir", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();
      const fallbackPath = join(
        SESSION_DIR,
        "other-project",
        `${sessionId}.jsonl`,
      );

      // 1st access: current project dir → ENOENT; scan finds the fallback
      vi.mocked(fs.promises.access)
        .mockRejectedValueOnce(enoent())
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        "other-project",
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);
      mockJsonlHandler.read.mockResolvedValue([
        makeMessage(new Date().toISOString()),
      ]);

      const session = await loadSessionFromJsonl(sessionId, "/mock/workdir");

      expect(session).not.toBeNull();
      expect(mockJsonlHandler.read).toHaveBeenCalledWith(fallbackPath);
    });

    it("loadSessionFromJsonl returns null when the session exists in no project dir", async () => {
      const fs = await import("fs");
      const sessionId = randomUUID();

      vi.mocked(fs.promises.access).mockRejectedValue(enoent());
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        "other-project",
      ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

      const session = await loadSessionFromJsonl(sessionId, "/mock/workdir");

      expect(session).toBeNull();
      expect(mockJsonlHandler.read).not.toHaveBeenCalled();
    });
  });
});
