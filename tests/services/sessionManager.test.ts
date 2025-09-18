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
  SessionManager,
  type SessionData,
  type SessionMetadata,
} from "@/services/sessionManager";
import type { Message } from "@/types";

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

describe("SessionManager", () => {
  const mockSessionDir = "/.lcap-code/sessions";
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

  const mockInputHistory = ["hello", "how are you"];

  const mockSessionData: SessionData = {
    id: mockSessionId,
    timestamp: "2024-01-01T00:00:00.000Z",
    version: "1.0.0",
    metadata: {
      workdir: mockWorkdir,
      startedAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T00:00:00.000Z",
      totalTokens: 100,
    },
    state: {
      messages: mockMessages,
      inputHistory: mockInputHistory,
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

      const fixedDate = new Date("2024-01-01T00:00:00.000Z");
      vi.setSystemTime(fixedDate);

      await SessionManager.saveSession(
        mockSessionId,
        mockMessages,
        mockInputHistory,
        mockWorkdir,
        100,
        "2024-01-01T00:00:00.000Z",
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(mockSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        mockSessionFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );

      const writeCall = mockFs.writeFile.mock.calls[0];
      const sessionData = JSON.parse(writeCall[1] as string);
      expect(sessionData.id).toBe(mockSessionId);
      expect(sessionData.metadata.workdir).toBe(mockWorkdir);
      expect(sessionData.metadata.totalTokens).toBe(100);
      expect(sessionData.state.messages).toEqual(mockMessages);
      expect(sessionData.state.inputHistory).toEqual(mockInputHistory);

      vi.useRealTimers();
    });

    it("should not save in test environment", async () => {
      process.env.NODE_ENV = "test";

      await SessionManager.saveSession(
        mockSessionId,
        mockMessages,
        mockInputHistory,
        mockWorkdir,
      );

      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should not save when inputHistory is empty", async () => {
      // Temporarily remove test environment
      delete process.env.NODE_ENV;
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await SessionManager.saveSession(
        mockSessionId,
        mockMessages,
        [], // empty inputHistory
        mockWorkdir,
      );

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });

    it("should use current time for startedAt if not provided", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const fixedDate = new Date("2024-01-01T12:00:00.000Z");
      vi.setSystemTime(fixedDate);

      await SessionManager.saveSession(
        mockSessionId,
        mockMessages,
        mockInputHistory,
        mockWorkdir,
      );

      const writeCall = mockFs.writeFile.mock.calls[0];
      const sessionData = JSON.parse(writeCall[1] as string);
      expect(sessionData.metadata.startedAt).toBe("2024-01-01T12:00:00.000Z");
      expect(sessionData.metadata.lastActiveAt).toBe(
        "2024-01-01T12:00:00.000Z",
      );

      vi.useRealTimers();
    });

    it("should throw error if mkdir fails", async () => {
      const error = new Error("Permission denied");
      mockFs.mkdir.mockRejectedValue(error);

      await expect(
        SessionManager.saveSession(
          mockSessionId,
          mockMessages,
          mockInputHistory,
          mockWorkdir,
        ),
      ).rejects.toThrow(
        "Failed to create session directory: Error: Permission denied",
      );
    });

    it("should throw error if writeFile fails", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Disk full");
      mockFs.writeFile.mockRejectedValue(error);

      await expect(
        SessionManager.saveSession(
          mockSessionId,
          mockMessages,
          mockInputHistory,
          mockWorkdir,
        ),
      ).rejects.toThrow(
        `Failed to save session ${mockSessionId}: Error: Disk full`,
      );
    });

    it("should handle session ID with underscores correctly", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const sessionIdWithUnderscores = "prefix_middle_87654321";
      await SessionManager.saveSession(
        sessionIdWithUnderscores,
        mockMessages,
        mockInputHistory,
        mockWorkdir,
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${mockSessionDir}/session_87654321.json`,
        expect.any(String),
        "utf-8",
      );
    });

    it("should handle short session ID correctly", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const shortSessionId = "short";
      await SessionManager.saveSession(
        shortSessionId,
        mockMessages,
        mockInputHistory,
        mockWorkdir,
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${mockSessionDir}/session_short.json`,
        expect.any(String),
        "utf-8",
      );
    });
  });

  describe("loadSession", () => {
    it("should load session data successfully", async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockSessionData));

      const result = await SessionManager.loadSession(mockSessionId);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        mockSessionFilePath,
        "utf-8",
      );
      expect(result).toEqual(mockSessionData);
    });

    it("should return null if session file does not exist", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.readFile.mockRejectedValue(error);

      const result = await SessionManager.loadSession(mockSessionId);

      expect(result).toBeNull();
    });

    it("should throw error for invalid session data format", async () => {
      const invalidSessionData = {
        id: mockSessionId,
        // missing state and metadata
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidSessionData));

      await expect(SessionManager.loadSession(mockSessionId)).rejects.toThrow(
        "Invalid session data format",
      );
    });

    it("should throw error for malformed JSON", async () => {
      mockFs.readFile.mockResolvedValue("invalid json");

      await expect(SessionManager.loadSession(mockSessionId)).rejects.toThrow(
        `Failed to load session ${mockSessionId}`,
      );
    });

    it("should throw error for other file system errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      mockFs.readFile.mockRejectedValue(error);

      await expect(SessionManager.loadSession(mockSessionId)).rejects.toThrow(
        `Failed to load session ${mockSessionId}: Error: Permission denied`,
      );
    });
  });

  describe("getLatestSession", () => {
    it("should return the most recent session", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session1",
          timestamp: "2024-01-01T00:00:00.000Z",
          workdir: mockWorkdir,
          startedAt: "2024-01-01T00:00:00.000Z",
          lastActiveAt: "2024-01-01T10:00:00.000Z",
          totalTokens: 50,
        },
        {
          id: "session2",
          timestamp: "2024-01-01T00:00:00.000Z",
          workdir: mockWorkdir,
          startedAt: "2024-01-01T00:00:00.000Z",
          lastActiveAt: "2024-01-01T12:00:00.000Z", // Most recent
          totalTokens: 75,
        },
      ];

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue(sessions);
      vi.spyOn(SessionManager, "loadSession").mockResolvedValue(
        mockSessionData,
      );

      const result = await SessionManager.getLatestSession(mockWorkdir);

      expect(SessionManager.listSessions).toHaveBeenCalledWith(mockWorkdir);
      expect(SessionManager.loadSession).toHaveBeenCalledWith("session2");
      expect(result).toEqual(mockSessionData);
    });

    it("should return null if no sessions exist", async () => {
      vi.spyOn(SessionManager, "listSessions").mockResolvedValue([]);

      const result = await SessionManager.getLatestSession(mockWorkdir);

      expect(result).toBeNull();
    });

    it("should work without workdir filter", async () => {
      const sessions: SessionMetadata[] = [
        {
          id: "session1",
          timestamp: "2024-01-01T00:00:00.000Z",
          workdir: "/different/workdir",
          startedAt: "2024-01-01T00:00:00.000Z",
          lastActiveAt: "2024-01-01T11:00:00.000Z",
          totalTokens: 25,
        },
      ];

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue(sessions);
      vi.spyOn(SessionManager, "loadSession").mockResolvedValue(
        mockSessionData,
      );

      const result = await SessionManager.getLatestSession();

      expect(SessionManager.listSessions).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockSessionData);
    });
  });

  describe("listSessions", () => {
    const mockSessionFiles = [
      "session_12345.json",
      "session_67890.json",
      "other_file.txt",
    ];
    const mockSession1Data: SessionData = {
      ...mockSessionData,
      id: "session_12345",
      metadata: {
        ...mockSessionData.metadata,
        lastActiveAt: "2024-01-01T10:00:00.000Z",
      },
    };
    const mockSession2Data: SessionData = {
      ...mockSessionData,
      id: "session_67890",
      metadata: {
        ...mockSessionData.metadata,
        workdir: "/different/workdir",
        lastActiveAt: "2024-01-01T12:00:00.000Z",
      },
    };

    it("should list all sessions sorted by last active time", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(mockSessionFiles as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockSession1Data))
        .mockResolvedValueOnce(JSON.stringify(mockSession2Data));

      const result = await SessionManager.listSessions();

      expect(mockFs.mkdir).toHaveBeenCalledWith(mockSessionDir, {
        recursive: true,
      });
      expect(mockFs.readdir).toHaveBeenCalledWith(mockSessionDir);
      expect(result).toHaveLength(2);

      // Should be sorted by lastActiveAt desc (most recent first)
      expect(result[0].id).toBe("session_67890");
      expect(result[1].id).toBe("session_12345");
      expect(result[0].workdir).toBe("/different/workdir");
      expect(result[1].workdir).toBe(mockWorkdir);
    });

    it("should filter sessions by workdir if provided", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(mockSessionFiles as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockSession1Data))
        .mockResolvedValueOnce(JSON.stringify(mockSession2Data));

      const result = await SessionManager.listSessions(mockWorkdir);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_12345");
      expect(result[0].workdir).toBe(mockWorkdir);
    });

    it("should skip non-session files", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "other_file.txt",
        "not_session.json",
      ] as never);

      const result = await SessionManager.listSessions();

      expect(result).toHaveLength(0);
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it("should skip corrupted session files with warning", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_12345.json",
        "session_corrupted.json",
      ] as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockSession1Data))
        .mockRejectedValueOnce(new Error("Invalid JSON"));

      const result = await SessionManager.listSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_12345");
      expect(consoleSpy).toHaveBeenCalledWith(
        "Skipping corrupted session file: session_corrupted.json",
      );

      consoleSpy.mockRestore();
    });

    it("should throw error if readdir fails", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Permission denied");
      mockFs.readdir.mockRejectedValue(error);

      await expect(SessionManager.listSessions()).rejects.toThrow(
        "Failed to list sessions: Error: Permission denied",
      );
    });

    it("should return empty array if session directory is empty", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as never);

      const result = await SessionManager.listSessions();

      expect(result).toHaveLength(0);
    });
  });

  describe("deleteSession", () => {
    it("should delete session successfully", async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await SessionManager.deleteSession(mockSessionId);

      expect(mockFs.unlink).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return false if session file does not exist", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.unlink.mockRejectedValue(error);

      const result = await SessionManager.deleteSession(mockSessionId);

      expect(result).toBe(false);
    });

    it("should throw error for other file system errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      mockFs.unlink.mockRejectedValue(error);

      await expect(SessionManager.deleteSession(mockSessionId)).rejects.toThrow(
        `Failed to delete session ${mockSessionId}: Error: Permission denied`,
      );
    });
  });

  describe("cleanupExpiredSessions", () => {
    const oldDate = new Date("2023-12-01T00:00:00.000Z").toISOString();
    const recentDate = new Date("2024-01-25T00:00:00.000Z").toISOString();

    const expiredSession: SessionMetadata = {
      id: "expired_session",
      timestamp: oldDate,
      workdir: mockWorkdir,
      startedAt: oldDate,
      lastActiveAt: oldDate,
      totalTokens: 50,
    };

    const recentSession: SessionMetadata = {
      id: "recent_session",
      timestamp: recentDate,
      workdir: mockWorkdir,
      startedAt: recentDate,
      lastActiveAt: recentDate,
      totalTokens: 75,
    };

    it("should clean up expired sessions", async () => {
      const fixedDate = new Date("2024-01-31T00:00:00.000Z");
      vi.setSystemTime(fixedDate);

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue([
        expiredSession,
        recentSession,
      ]);
      vi.spyOn(SessionManager, "deleteSession")
        .mockResolvedValueOnce(true) // expired session deleted
        .mockResolvedValueOnce(true); // shouldn't be called for recent session

      const result = await SessionManager.cleanupExpiredSessions(mockWorkdir);

      expect(SessionManager.listSessions).toHaveBeenCalledWith(mockWorkdir);
      expect(SessionManager.deleteSession).toHaveBeenCalledTimes(1);
      expect(SessionManager.deleteSession).toHaveBeenCalledWith(
        "expired_session",
      );
      expect(result).toBe(1);

      vi.useRealTimers();
    });

    it("should not delete recent sessions", async () => {
      const fixedDate = new Date("2024-01-31T00:00:00.000Z");
      vi.setSystemTime(fixedDate);

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue([
        recentSession,
      ]);
      vi.spyOn(SessionManager, "deleteSession");

      const result = await SessionManager.cleanupExpiredSessions(mockWorkdir);

      expect(SessionManager.deleteSession).not.toHaveBeenCalled();
      expect(result).toBe(0);

      vi.useRealTimers();
    });

    it("should return 0 in test environment", async () => {
      process.env.NODE_ENV = "test";

      const result = await SessionManager.cleanupExpiredSessions();

      expect(result).toBe(0);
    });

    it("should continue cleanup even if some deletions fail", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fixedDate = new Date("2024-01-31T00:00:00.000Z");
      vi.setSystemTime(fixedDate);

      const expiredSession2: SessionMetadata = {
        ...expiredSession,
        id: "expired_session_2",
      };

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue([
        expiredSession,
        expiredSession2,
      ]);
      vi.spyOn(SessionManager, "deleteSession")
        .mockRejectedValueOnce(new Error("Delete failed"))
        .mockResolvedValueOnce(true);

      const result = await SessionManager.cleanupExpiredSessions();

      expect(SessionManager.deleteSession).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to delete expired session expired_session: Error: Delete failed",
      );
      expect(result).toBe(1); // Only one successful deletion

      consoleSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should work without workdir filter", async () => {
      const fixedDate = new Date("2024-01-31T00:00:00.000Z");
      vi.setSystemTime(fixedDate);

      vi.spyOn(SessionManager, "listSessions").mockResolvedValue([
        expiredSession,
      ]);
      vi.spyOn(SessionManager, "deleteSession").mockResolvedValue(true);

      const result = await SessionManager.cleanupExpiredSessions();

      expect(SessionManager.listSessions).toHaveBeenCalledWith(undefined);
      expect(result).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("sessionExists", () => {
    it("should return true if session file exists", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await SessionManager.sessionExists(mockSessionId);

      expect(mockFs.access).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return false if session file does not exist", async () => {
      const error = new Error("File not found");
      mockFs.access.mockRejectedValue(error);

      const result = await SessionManager.sessionExists(mockSessionId);

      expect(result).toBe(false);
    });

    it("should return false for any access error", async () => {
      const error = new Error("Permission denied");
      mockFs.access.mockRejectedValue(error);

      const result = await SessionManager.sessionExists(mockSessionId);

      expect(result).toBe(false);
    });
  });

  describe("private method getSessionFilePath", () => {
    beforeEach(() => {
      // Clear test environment for these tests
      delete process.env.NODE_ENV;
    });

    it("should generate correct file path for session with underscores", async () => {
      // We need to test this indirectly through other methods since it's private
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await SessionManager.saveSession(
        "prefix_middle_12345678",
        [],
        ["test input"],
        "/test",
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${mockSessionDir}/session_12345678.json`,
        expect.any(String),
        "utf-8",
      );
    });

    it("should handle short session ID", async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await SessionManager.saveSession("short", [], ["test input"], "/test");

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `${mockSessionDir}/session_short.json`,
        expect.any(String),
        "utf-8",
      );
    });
  });

  describe("constants", () => {
    beforeEach(() => {
      // Clear test environment for this test
      delete process.env.NODE_ENV;
    });

    it("should use correct session directory path", async () => {
      // This is tested indirectly through other methods
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await SessionManager.saveSession(
        mockSessionId,
        [],
        ["test input"],
        "/test",
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith("/.lcap-code/sessions", {
        recursive: true,
      });
    });
  });

  describe("project-specific session handling", () => {
    it("should get latest session only from the specified project workdir", async () => {
      const projectA = "/path/to/project-a";
      const projectB = "/path/to/project-b";

      const sessionA: SessionMetadata = {
        id: "sessionA",
        timestamp: "2024-01-01T00:00:00.000Z",
        workdir: projectA,
        startedAt: "2024-01-01T00:00:00.000Z",
        lastActiveAt: "2024-01-01T12:00:00.000Z", // More recent
        totalTokens: 100,
      };

      const sessionB: SessionMetadata = {
        id: "sessionB",
        timestamp: "2024-01-01T00:00:00.000Z",
        workdir: projectB,
        startedAt: "2024-01-01T00:00:00.000Z",
        lastActiveAt: "2024-01-01T10:00:00.000Z", // Less recent
        totalTokens: 50,
      };

      const sessionAData: SessionData = {
        ...mockSessionData,
        id: "sessionA",
        metadata: {
          ...mockSessionData.metadata,
          workdir: projectA,
          lastActiveAt: "2024-01-01T12:00:00.000Z",
        },
      };

      // Mock listSessions to return sessions filtered by workdir
      vi.spyOn(SessionManager, "listSessions").mockImplementation(
        async (workdir?: string) => {
          if (workdir === projectA) {
            return [sessionA]; // Only return sessions for project A
          } else if (workdir === projectB) {
            return [sessionB]; // Only return sessions for project B
          } else {
            return [sessionA, sessionB]; // Return all if no filter
          }
        },
      );

      vi.spyOn(SessionManager, "loadSession").mockResolvedValue(sessionAData);

      // Test getting latest session for project A specifically
      const result = await SessionManager.getLatestSession(projectA);

      expect(SessionManager.listSessions).toHaveBeenCalledWith(projectA);
      expect(SessionManager.loadSession).toHaveBeenCalledWith("sessionA");
      expect(result).toEqual(sessionAData);
    });

    it("should return null when no sessions exist for the specified project", async () => {
      const projectC = "/path/to/project-c";

      // Mock listSessions to return empty array for project C
      vi.spyOn(SessionManager, "listSessions").mockImplementation(
        async (workdir?: string) => {
          if (workdir === projectC) {
            return []; // No sessions for project C
          }
          return []; // No sessions at all
        },
      );

      const result = await SessionManager.getLatestSession(projectC);

      expect(SessionManager.listSessions).toHaveBeenCalledWith(projectC);
      expect(result).toBeNull();
    });
  });
});
