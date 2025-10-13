import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  saveSession,
  loadSession,
  getLatestSession,
  listSessions,
  deleteSession,
  cleanupExpiredSessions,
  sessionExists,
  type SessionData,
} from "@/services/session.js";
import type { Message } from "@/types.js";

// Mock fs and os modules
vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock("os", () => ({
  homedir: vi.fn(),
}));

vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}));

const mockFs = vi.mocked(fs);
const mockHomedir = vi.mocked(homedir);
const mockJoin = vi.mocked(join);

describe("Session Service", () => {
  const mockSessionDir = "/.wave/sessions";
  const mockSessionId = "test_session_12345678";
  const mockShortId = "12345678";
  const mockSessionFilePath = `${mockSessionDir}/session_${mockShortId}.json`;
  const mockWorkdir = "/test/workdir";

  const mockMessages: Message[] = [
    {
      role: "user",
      blocks: [{ type: "text", content: "Hello" }],
    },
    {
      role: "assistant",
      blocks: [{ type: "text", content: "Hi there!" }],
    },
  ];

  const mockSessionData: SessionData = {
    id: mockSessionId,
    timestamp: "2024-01-01T00:00:00.000Z",
    version: "1.0.0",
    metadata: {
      workdir: mockWorkdir,
      startedAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T00:00:00.000Z",
      latestTotalTokens: 100,
    },
    state: {
      messages: mockMessages,
    },
  };

  beforeAll(() => {
    // Set up default mocks
    mockHomedir.mockReturnValue("/home/user");
    mockJoin.mockImplementation((...args) => args.join("/"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV for each test
    delete process.env.NODE_ENV;
    // Mock process.cwd() to return test workdir
    vi.spyOn(process, "cwd").mockReturnValue(mockWorkdir);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("saveSession", () => {
    it("should save session data successfully", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await saveSession(mockSessionId, mockMessages, 100);

      expect(mockFs.mkdir).toHaveBeenCalledWith(mockSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        mockSessionFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );
    });

    it("should not save session in test environment", async () => {
      process.env.NODE_ENV = "test";

      await saveSession(mockSessionId, mockMessages, 100);

      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle mkdir error", async () => {
      const error = new Error("Permission denied");
      mockFs.mkdir.mockRejectedValue(error);

      await expect(saveSession(mockSessionId, mockMessages)).rejects.toThrow(
        "Failed to create session directory: Error: Permission denied",
      );
    });

    it("should handle writeFile error", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Disk full");
      mockFs.writeFile.mockRejectedValue(error);

      await expect(saveSession(mockSessionId, mockMessages)).rejects.toThrow(
        `Failed to save session ${mockSessionId}: Error: Disk full`,
      );
    });
  });

  describe("loadSession", () => {
    it("should load session data successfully", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockSessionData));

      const result = await loadSession(mockSessionId);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        mockSessionFilePath,
        "utf-8",
      );
      expect(result).toEqual(mockSessionData);
    });

    it("should return null for non-existent session", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.readFile.mockRejectedValue(error);

      const result = await loadSession(mockSessionId);

      expect(result).toBeNull();
    });

    it("should handle invalid session data", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({}));

      await expect(loadSession(mockSessionId)).rejects.toThrow(
        "Invalid session data format",
      );
    });

    it("should handle JSON parse error", async () => {
      mockFs.readFile.mockResolvedValue("invalid json");

      await expect(loadSession(mockSessionId)).rejects.toThrow(
        `Failed to load session ${mockSessionId}`,
      );
    });

    it("should handle other file system errors", async () => {
      const error = new Error("Permission denied");
      mockFs.readFile.mockRejectedValue(error);

      await expect(loadSession(mockSessionId)).rejects.toThrow(
        `Failed to load session ${mockSessionId}: Error: Permission denied`,
      );
    });
  });

  describe("getLatestSession", () => {
    it("should return the most recent session", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
      ] as never);

      // Mock reading session files
      mockFs.readFile
        .mockResolvedValueOnce(
          JSON.stringify({
            ...mockSessionData,
            id: "session_1",
            metadata: {
              ...mockSessionData.metadata,
              lastActiveAt: "2024-01-01T10:00:00.000Z",
            },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            ...mockSessionData,
            id: "session_2",
            metadata: {
              ...mockSessionData.metadata,
              lastActiveAt: "2024-01-01T12:00:00.000Z",
            },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            ...mockSessionData,
            id: "session_2",
            metadata: {
              ...mockSessionData.metadata,
              lastActiveAt: "2024-01-01T12:00:00.000Z",
            },
          }),
        );

      const result = await getLatestSession();

      expect(result?.id).toBe("session_2");
    });

    it("should return null when no sessions exist", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as never);

      const result = await getLatestSession();

      expect(result).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("should list sessions for current workdir", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "other_file.txt",
      ] as never);

      const sessionData1 = { ...mockSessionData, id: "session_1" };
      const sessionData2 = {
        ...mockSessionData,
        id: "session_2",
        metadata: { ...mockSessionData.metadata, workdir: "/other/workdir" },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2));

      const result = await listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_1");
      expect(result[0].workdir).toBe(mockWorkdir);
    });

    it("should skip corrupted session files", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_valid.json",
        "session_corrupted.json",
      ] as never);

      const validSessionData = { ...mockSessionData, id: "session_valid" };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(validSessionData))
        .mockRejectedValueOnce(new Error("Corrupted file"));

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_valid");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Skipping corrupted session file: session_corrupted.json",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should handle readdir error", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Permission denied");
      mockFs.readdir.mockRejectedValue(error);

      await expect(listSessions()).rejects.toThrow(
        "Failed to list sessions: Error: Permission denied",
      );
    });
  });

  describe("deleteSession", () => {
    it("should delete session successfully", async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await deleteSession(mockSessionId);

      expect(mockFs.unlink).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.unlink.mockRejectedValue(error);

      const result = await deleteSession(mockSessionId);

      expect(result).toBe(false);
    });

    it("should handle other deletion errors", async () => {
      const error = new Error("Permission denied");
      mockFs.unlink.mockRejectedValue(error);

      await expect(deleteSession(mockSessionId)).rejects.toThrow(
        `Failed to delete session ${mockSessionId}: Error: Permission denied`,
      );
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("should not cleanup in test environment", async () => {
      process.env.NODE_ENV = "test";

      const result = await cleanupExpiredSessions();

      expect(result).toBe(0);
      expect(mockFs.readdir).not.toHaveBeenCalled();
    });

    it("should cleanup expired sessions", async () => {
      const now = new Date("2024-02-01T00:00:00.000Z");
      vi.setSystemTime(now);

      // Create sessions with different ages
      const recentSession = {
        ...mockSessionData,
        id: "recent_session",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-25T00:00:00.000Z", // 7 days old
        },
      };

      const expiredSession = {
        ...mockSessionData,
        id: "expired_session",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2023-12-01T00:00:00.000Z", // 62 days old
        },
      };

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_recent.json",
        "session_expired.json",
      ] as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(recentSession))
        .mockResolvedValueOnce(JSON.stringify(expiredSession));
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions();

      expect(result).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should handle cleanup errors gracefully", async () => {
      const now = new Date("2024-02-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const expiredSession = {
        ...mockSessionData,
        id: "expired_session",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2023-12-01T00:00:00.000Z",
        },
      };

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(["session_expired.json"] as never);
      mockFs.readFile.mockResolvedValue(JSON.stringify(expiredSession));
      mockFs.unlink.mockRejectedValue(new Error("Permission denied"));

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions();

      expect(result).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to delete expired session"),
      );

      consoleWarnSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("sessionExists", () => {
    it("should return true for existing session", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await sessionExists(mockSessionId);

      expect(mockFs.access).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      mockFs.access.mockRejectedValue(new Error("File not found"));

      const result = await sessionExists(mockSessionId);

      expect(result).toBe(false);
    });
  });
});
