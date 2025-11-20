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
  getSessionFilePath,
  type SessionData,
} from "@/services/session.js";
import type { Message } from "@/types/index.js";

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
    messages: mockMessages,
    metadata: {
      workdir: mockWorkdir,
      startedAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T00:00:00.000Z",
      latestTotalTokens: 100,
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

      await saveSession(mockSessionId, mockMessages, mockWorkdir, 100);

      expect(mockFs.mkdir).toHaveBeenCalledWith(mockSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        mockSessionFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );
    });

    it("should save session data with custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      const customSessionFilePath = `${customSessionDir}/session_${mockShortId}.json`;
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await saveSession(
        mockSessionId,
        mockMessages,
        mockWorkdir,
        100,
        undefined,
        customSessionDir,
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(customSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        customSessionFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );
    });

    it("should save session data with custom prefix", async () => {
      const customPrefix = "subagent_session";
      const customPrefixFilePath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await saveSession(
        mockSessionId,
        mockMessages,
        mockWorkdir,
        100,
        undefined,
        undefined,
        customPrefix,
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(mockSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        customPrefixFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );
    });

    it("should save session data with custom sessionDir and custom prefix", async () => {
      const customSessionDir = "/custom/sessions";
      const customPrefix = "subagent_session";
      const customFilePath = `${customSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await saveSession(
        mockSessionId,
        mockMessages,
        mockWorkdir,
        100,
        undefined,
        customSessionDir,
        customPrefix,
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(customSessionDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        customFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );
    });

    it("should verify saved data contains correct session information with custom prefix", async () => {
      const customPrefix = "test_prefix";
      const customPrefixFilePath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const startTime = "2024-01-01T10:00:00.000Z";
      const tokens = 150;

      await saveSession(
        mockSessionId,
        mockMessages,
        mockWorkdir,
        tokens,
        startTime,
        undefined,
        customPrefix,
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        customPrefixFilePath,
        expect.stringContaining(mockSessionId),
        "utf-8",
      );

      // Verify the saved data structure
      const writeFileMock = mockFs.writeFile as ReturnType<typeof vi.fn>;
      const savedDataString = writeFileMock.mock.calls[0][1] as string;
      const savedData = JSON.parse(savedDataString) as SessionData;

      expect(savedData.id).toBe(mockSessionId);
      expect(savedData.messages).toEqual(mockMessages);
      expect(savedData.metadata.workdir).toBe(mockWorkdir);
      expect(savedData.metadata.startedAt).toBe(startTime);
      expect(savedData.metadata.latestTotalTokens).toBe(tokens);
    });

    it("should handle different prefix formats when saving", async () => {
      const testCases = [
        {
          prefix: "agent",
          expectedFile: `${mockSessionDir}/agent_${mockShortId}.json`,
        },
        {
          prefix: "my_custom_session",
          expectedFile: `${mockSessionDir}/my_custom_session_${mockShortId}.json`,
        },
        {
          prefix: "workflow-123",
          expectedFile: `${mockSessionDir}/workflow-123_${mockShortId}.json`,
        },
      ];

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      for (const { prefix, expectedFile } of testCases) {
        vi.clearAllMocks();

        await saveSession(
          mockSessionId,
          mockMessages,
          mockWorkdir,
          100,
          undefined,
          undefined,
          prefix,
        );

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expectedFile,
          expect.stringContaining(mockSessionId),
          "utf-8",
        );
      }
    });

    it("should filter out diff blocks when saving", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const messagesWithDiff: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Hello" }],
        },
        {
          role: "assistant",
          blocks: [
            { type: "text", content: "Hi there!" },
            {
              type: "diff",
              path: "/test/file.js",
              diffResult: [
                { value: "line 1", added: false, removed: false },
                { value: "line 2", added: true, removed: false },
              ],
            },
          ],
        },
      ];

      await saveSession(mockSessionId, messagesWithDiff, mockWorkdir, 100);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeFileMock = mockFs.writeFile as ReturnType<typeof vi.fn>;
      const savedData = JSON.parse(
        writeFileMock.mock.calls[0][1] as string,
      ) as SessionData;

      // Check that diff blocks are filtered out
      expect(savedData.messages).toHaveLength(2);
      expect(savedData.messages[0].blocks).toHaveLength(1);
      expect(savedData.messages[0].blocks[0].type).toBe("text");
      expect(savedData.messages[1].blocks).toHaveLength(1);
      expect(savedData.messages[1].blocks[0].type).toBe("text");

      // Ensure no diff blocks are present
      const allBlocks = savedData.messages.flatMap((msg) => msg.blocks);
      expect(allBlocks.every((block) => block.type !== "diff")).toBe(true);
    });

    it("should filter out messages with only diff blocks", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const messagesWithOnlyDiff: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Hello" }],
        },
        {
          role: "assistant",
          blocks: [
            {
              type: "diff",
              path: "/test/file.js",
              diffResult: [{ value: "line 1", added: false, removed: false }],
            },
          ],
        },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Done!" }],
        },
      ];

      await saveSession(mockSessionId, messagesWithOnlyDiff, mockWorkdir, 100);

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeFileMock = mockFs.writeFile as ReturnType<typeof vi.fn>;
      const savedData = JSON.parse(
        writeFileMock.mock.calls[0][1] as string,
      ) as SessionData;

      // Check that messages with only diff blocks are filtered out
      expect(savedData.messages).toHaveLength(2);
      expect(
        (savedData.messages[0].blocks[0] as { content: string }).content,
      ).toBe("Hello");
      expect(
        (savedData.messages[1].blocks[0] as { content: string }).content,
      ).toBe("Done!");
    });

    it("should not save session when messages array is empty", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await saveSession(mockSessionId, [], mockWorkdir, 100);

      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should not save session in test environment", async () => {
      process.env.NODE_ENV = "test";

      await saveSession(mockSessionId, mockMessages, mockWorkdir, 100);

      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should handle mkdir error", async () => {
      const error = new Error("Permission denied");
      mockFs.mkdir.mockRejectedValue(error);

      await expect(
        saveSession(mockSessionId, mockMessages, mockWorkdir),
      ).rejects.toThrow(
        "Failed to create session directory: Error: Permission denied",
      );
    });

    it("should handle writeFile error", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Disk full");
      mockFs.writeFile.mockRejectedValue(error);

      await expect(
        saveSession(mockSessionId, mockMessages, mockWorkdir),
      ).rejects.toThrow(
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

    it("should load session data from custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      const customSessionFilePath = `${customSessionDir}/session_${mockShortId}.json`;
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockSessionData));

      const result = await loadSession(mockSessionId, customSessionDir);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        customSessionFilePath,
        "utf-8",
      );
      expect(result).toEqual(mockSessionData);
    });

    it("should load session data with custom prefix", async () => {
      const customPrefix = "subagent_session";
      const customPrefixFilePath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockSessionData));

      const result = await loadSession(mockSessionId, undefined, customPrefix);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        customPrefixFilePath,
        "utf-8",
      );
      expect(result).toEqual(mockSessionData);
    });

    it("should load session data from custom sessionDir with custom prefix", async () => {
      const customSessionDir = "/custom/sessions";
      const customPrefix = "subagent_session";
      const customFilePath = `${customSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockSessionData));

      const result = await loadSession(
        mockSessionId,
        customSessionDir,
        customPrefix,
      );

      expect(mockFs.readFile).toHaveBeenCalledWith(customFilePath, "utf-8");
      expect(result).toEqual(mockSessionData);
    });

    it("should return null for non-existent session with custom prefix", async () => {
      const customPrefix = "nonexistent_prefix";
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.readFile.mockRejectedValue(error);

      const result = await loadSession(mockSessionId, undefined, customPrefix);

      expect(result).toBeNull();
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

      const result = await getLatestSession(mockWorkdir);

      expect(result?.id).toBe("session_2");
    });

    it("should return the most recent session from custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      mockFs.mkdir.mockResolvedValue(undefined);
      mockJoin.mockReturnValueOnce(`${customSessionDir}/session_1.json`);
      mockJoin.mockReturnValueOnce(`${customSessionDir}/session_2.json`);
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

      const result = await getLatestSession(mockWorkdir, customSessionDir);

      expect(mockFs.readdir).toHaveBeenCalledWith(customSessionDir);
      expect(result?.id).toBe("session_2");
    });

    it("should return null when no sessions exist", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as never);

      const result = await getLatestSession(mockWorkdir);

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

      const result = await listSessions(mockWorkdir);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_1");
      expect(result[0].workdir).toBe(mockWorkdir);
    });

    it("should list sessions from custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
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

      const result = await listSessions(mockWorkdir, false, customSessionDir);

      expect(mockFs.readdir).toHaveBeenCalledWith(customSessionDir);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_1");
      expect(result[0].workdir).toBe(mockWorkdir);
    });

    it("should list sessions with specific prefix parameter", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "subagent_session_2.json",
        "other_prefix_3.json",
        "not_a_session.txt",
      ] as never);

      const sessionData1 = { ...mockSessionData, id: "session_1" };
      const subagentSessionData = {
        ...mockSessionData,
        id: "subagent_session_2",
      };

      // Test listing with "session" prefix only
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(sessionData1));

      const sessionResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      expect(sessionResult).toHaveLength(1);
      expect(sessionResult[0].id).toBe("session_1");

      // Reset mocks for next test
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "subagent_session_2.json",
        "other_prefix_3.json",
        "not_a_session.txt",
      ] as never);

      // Test listing with "subagent_session" prefix only
      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify(subagentSessionData),
      );

      const subagentResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "subagent_session",
      );

      expect(subagentResult).toHaveLength(1);
      expect(subagentResult[0].id).toBe("subagent_session_2");
    });

    it("should handle mixed session files with session_ and subagent_session_ prefixes", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "subagent_session_3.json",
        "subagent_session_4.json",
        "other_file.txt",
        "workflow_session_5.json", // Should not be included with session prefix
      ] as never);

      const sessionData1 = { ...mockSessionData, id: "session_1" };
      const sessionData2 = { ...mockSessionData, id: "session_2" };
      const subagentData3 = { ...mockSessionData, id: "subagent_session_3" };
      const subagentData4 = { ...mockSessionData, id: "subagent_session_4" };

      // When listing with default "session" prefix, only session_ files should be returned
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2));

      const sessionResult = await listSessions(mockWorkdir);

      expect(sessionResult).toHaveLength(2);
      expect(sessionResult.map((s) => s.id)).toEqual([
        "session_1",
        "session_2",
      ]);

      // Reset mocks for subagent test
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "subagent_session_3.json",
        "subagent_session_4.json",
        "other_file.txt",
      ] as never);

      // When listing with "subagent_session" prefix, only subagent_session_ files should be returned
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(subagentData3))
        .mockResolvedValueOnce(JSON.stringify(subagentData4));

      const subagentResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "subagent_session",
      );

      expect(subagentResult).toHaveLength(2);
      expect(subagentResult.map((s) => s.id)).toEqual([
        "subagent_session_3",
        "subagent_session_4",
      ]);
    });

    it("should handle mixed session files from different workdirs", async () => {
      const workdir1 = "/test/workdir1";
      const workdir2 = "/test/workdir2";

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "subagent_session_2.json",
      ] as never);

      const sessionData1 = {
        ...mockSessionData,
        id: "session_1",
        metadata: { ...mockSessionData.metadata, workdir: workdir1 },
      };
      const subagentData2 = {
        ...mockSessionData,
        id: "subagent_session_2",
        metadata: { ...mockSessionData.metadata, workdir: workdir2 },
      };

      // Test filtering by workdir with session prefix
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(sessionData1));

      const result1 = await listSessions(workdir1, false, undefined, "session");
      expect(result1).toHaveLength(1);
      expect(result1[0].id).toBe("session_1");
      expect(result1[0].workdir).toBe(workdir1);

      // Reset and test with subagent prefix for different workdir
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "subagent_session_2.json",
      ] as never);

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(subagentData2));

      const result2 = await listSessions(
        workdir2,
        false,
        undefined,
        "subagent_session",
      );
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe("subagent_session_2");
      expect(result2[0].workdir).toBe(workdir2);
    });

    it("should handle includeAllWorkdirs with mixed session types", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
      ] as never);

      const sessionData1 = {
        ...mockSessionData,
        id: "session_1",
        metadata: { ...mockSessionData.metadata, workdir: "/workdir1" },
      };
      const sessionData2 = {
        ...mockSessionData,
        id: "session_2",
        metadata: { ...mockSessionData.metadata, workdir: "/workdir2" },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2));

      // With includeAllWorkdirs=true, should return sessions from all workdirs
      const result = await listSessions(
        "/some/workdir",
        true,
        undefined,
        "session",
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.workdir)).toEqual(["/workdir1", "/workdir2"]);
    });

    it("should handle empty directory", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([] as never);

      const result = await listSessions(mockWorkdir);

      expect(result).toHaveLength(0);
    });

    it("should handle directory with no matching files", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "not_a_session.txt",
        "random_file.json",
        "workflow_other.json",
      ] as never);

      const result = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      expect(result).toHaveLength(0);
    });

    it("should handle corrupted session files with different prefixes", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_valid.json",
        "session_corrupted.json",
        "subagent_session_valid.json",
        "subagent_session_corrupted.json",
      ] as never);

      const validSessionData = { ...mockSessionData, id: "session_valid" };

      // Test with session prefix - should skip corrupted session files
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(validSessionData))
        .mockRejectedValueOnce(new Error("Corrupted file"));

      const sessionResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      expect(sessionResult).toHaveLength(1);
      expect(sessionResult[0].id).toBe("session_valid");

      // Reset mocks for subagent test
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_valid.json",
        "session_corrupted.json",
        "subagent_session_valid.json",
        "subagent_session_corrupted.json",
      ] as never);

      const validSubagentData = {
        ...mockSessionData,
        id: "subagent_session_valid",
      };

      // Test with subagent_session prefix - should skip corrupted subagent files
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(validSubagentData))
        .mockRejectedValueOnce(new Error("Corrupted file"));

      const subagentResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "subagent_session",
      );

      expect(subagentResult).toHaveLength(1);
      expect(subagentResult[0].id).toBe("subagent_session_valid");
    });

    it("should skip non-JSON files with matching prefix", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_backup.txt", // Should be skipped
        "session_log", // Should be skipped (no .json extension)
        "subagent_session_2.json",
        "subagent_session_backup.txt", // Should be skipped
      ] as never);

      const sessionData1 = { ...mockSessionData, id: "session_1" };

      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(sessionData1));

      const result = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_1");
    });

    it("should sort sessions by lastActiveAt timestamp in descending order", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "session_3.json",
      ] as never);

      const sessionData1 = {
        ...mockSessionData,
        id: "session_1",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T10:00:00.000Z",
        },
      };
      const sessionData2 = {
        ...mockSessionData,
        id: "session_2",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T15:00:00.000Z",
        }, // Most recent
      };
      const sessionData3 = {
        ...mockSessionData,
        id: "session_3",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T12:00:00.000Z",
        },
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2))
        .mockResolvedValueOnce(JSON.stringify(sessionData3));

      const result = await listSessions(mockWorkdir);

      expect(result).toHaveLength(3);
      expect(result.map((s) => s.id)).toEqual([
        "session_2",
        "session_3",
        "session_1",
      ]);
      expect(result[0].lastActiveAt).toBe("2024-01-01T15:00:00.000Z");
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

      const result = await listSessions(mockWorkdir);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("session_valid");
      // Corrupted files are silently skipped, no console.warn expected
    });

    it("should handle readdir error", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      const error = new Error("Permission denied");
      mockFs.readdir.mockRejectedValue(error);

      await expect(listSessions(mockWorkdir)).rejects.toThrow(
        "Failed to list sessions: Error: Permission denied",
      );
    });
  });

  describe("listSessions - Advanced Mixed Prefix Scenarios", () => {
    it("should demonstrate limitation: cannot list all session types with current API", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "subagent_session_3.json",
        "subagent_session_4.json",
        "workflow_session_5.json", // Different prefix type
        "other_file.txt",
      ] as never);

      const sessionData1 = { ...mockSessionData, id: "session_1" };
      const sessionData2 = { ...mockSessionData, id: "session_2" };
      const subagentData3 = { ...mockSessionData, id: "subagent_session_3" };
      const subagentData4 = { ...mockSessionData, id: "subagent_session_4" };

      // Current API limitation: Can only list one prefix type at a time
      // To get session_ files:
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2));

      const sessionResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );
      expect(sessionResult).toHaveLength(2);
      expect(sessionResult.map((s) => s.id)).toEqual([
        "session_1",
        "session_2",
      ]);

      // Reset mocks to get subagent_ files:
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_1.json",
        "session_2.json",
        "subagent_session_3.json",
        "subagent_session_4.json",
        "workflow_session_5.json",
        "other_file.txt",
      ] as never);

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(subagentData3))
        .mockResolvedValueOnce(JSON.stringify(subagentData4));

      const subagentResult = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "subagent_session",
      );
      expect(subagentResult).toHaveLength(2);
      expect(subagentResult.map((s) => s.id)).toEqual([
        "subagent_session_3",
        "subagent_session_4",
      ]);

      // Note: Currently there's no way to get both session_ and subagent_session_ files in one call
      // This is a limitation that could be addressed in future API improvements
    });

    it("should handle debugging scenario: manually combining results from multiple prefixes", async () => {
      // This test demonstrates how a developer might work around the current limitation
      // by calling listSessions multiple times with different prefixes

      mockFs.mkdir.mockResolvedValue(undefined);
      const mixedFiles = [
        "session_1.json",
        "subagent_session_2.json",
        "session_3.json",
        "subagent_session_4.json",
      ];

      const sessionData1 = {
        ...mockSessionData,
        id: "session_1",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T10:00:00.000Z",
        },
      };
      const sessionData3 = {
        ...mockSessionData,
        id: "session_3",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T14:00:00.000Z",
        },
      };
      const subagentData2 = {
        ...mockSessionData,
        id: "subagent_session_2",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T12:00:00.000Z",
        },
      };
      const subagentData4 = {
        ...mockSessionData,
        id: "subagent_session_4",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2024-01-01T16:00:00.000Z",
        },
      };

      // First call: get session_ files
      mockFs.readdir.mockResolvedValue(mixedFiles as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData3));

      const sessionResults = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      // Reset for second call: get subagent_session_ files
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(mixedFiles as never);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(subagentData2))
        .mockResolvedValueOnce(JSON.stringify(subagentData4));

      const subagentResults = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "subagent_session",
      );

      // Manually combine and sort results (what debugging tools might need to do)
      const allResults = [...sessionResults, ...subagentResults];
      allResults.sort(
        (a, b) =>
          new Date(b.lastActiveAt).getTime() -
          new Date(a.lastActiveAt).getTime(),
      );

      expect(allResults).toHaveLength(4);
      expect(allResults.map((s) => s.id)).toEqual([
        "subagent_session_4", // 16:00 (most recent)
        "session_3", // 14:00
        "subagent_session_2", // 12:00
        "session_1", // 10:00 (oldest)
      ]);
    });

    it("should handle prefix variations and edge cases in mixed environments", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_normal.json",
        "subagent_session_normal.json",
        "agent_session_variant.json", // Different prefix pattern
        "session_123.json", // Numeric suffix
        "subagent_session_xyz.json", // Alpha suffix
        "session_.json", // Edge case: empty suffix after underscore
        "session.json", // Edge case: no underscore
        "sessionfile.json", // Edge case: no underscore, different name
      ] as never);

      const normalSessionData = { ...mockSessionData, id: "session_normal" };
      const numericSessionData = { ...mockSessionData, id: "session_123" };

      // Test that exact prefix matching works correctly
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(normalSessionData))
        .mockResolvedValueOnce(JSON.stringify(numericSessionData));

      const result = await listSessions(
        mockWorkdir,
        false,
        undefined,
        "session",
      );

      // Should only get files that start with "session_" followed by something
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toContain("session_normal");
      expect(result.map((s) => s.id)).toContain("session_123");

      // Files like "session_.json", "session.json", "sessionfile.json" should not be included
      // because they don't match the expected pattern "session_*.json"
    });

    it("should handle workdir filtering with mixed session types consistently", async () => {
      const workdir1 = "/project/app1";
      const workdir2 = "/project/app2";

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_app1.json",
        "subagent_session_app1.json",
        "session_app2.json",
        "subagent_session_app2.json",
      ] as never);

      const sessionApp1 = {
        ...mockSessionData,
        id: "session_app1",
        metadata: { ...mockSessionData.metadata, workdir: workdir1 },
      };
      const subagentApp1 = {
        ...mockSessionData,
        id: "subagent_session_app1",
        metadata: { ...mockSessionData.metadata, workdir: workdir1 },
      };
      const sessionApp2 = {
        ...mockSessionData,
        id: "session_app2",
        metadata: { ...mockSessionData.metadata, workdir: workdir2 },
      };
      const subagentApp2 = {
        ...mockSessionData,
        id: "subagent_session_app2",
        metadata: { ...mockSessionData.metadata, workdir: workdir2 },
      };

      // Test that workdir filtering works consistently across different prefix types

      // Test 1: Get session_ files for workdir1
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(sessionApp1))
        .mockResolvedValueOnce(JSON.stringify(sessionApp2)); // This should be filtered out

      const sessionApp1Results = await listSessions(
        workdir1,
        false,
        undefined,
        "session",
      );
      expect(sessionApp1Results).toHaveLength(1);
      expect(sessionApp1Results[0].id).toBe("session_app1");
      expect(sessionApp1Results[0].workdir).toBe(workdir1);

      // Reset mocks for next test
      vi.clearAllMocks();
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        "session_app1.json",
        "subagent_session_app1.json",
        "session_app2.json",
        "subagent_session_app2.json",
      ] as never);

      // Test 2: Get subagent_session_ files for workdir2
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(subagentApp1)) // This should be filtered out
        .mockResolvedValueOnce(JSON.stringify(subagentApp2));

      const subagentApp2Results = await listSessions(
        workdir2,
        false,
        undefined,
        "subagent_session",
      );
      expect(subagentApp2Results).toHaveLength(1);
      expect(subagentApp2Results[0].id).toBe("subagent_session_app2");
      expect(subagentApp2Results[0].workdir).toBe(workdir2);
    });
  });

  describe("deleteSession", () => {
    it("should delete session successfully", async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await deleteSession(mockSessionId);

      expect(mockFs.unlink).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should delete session from custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      const customSessionFilePath = `${customSessionDir}/session_${mockShortId}.json`;
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await deleteSession(mockSessionId, customSessionDir);

      expect(mockFs.unlink).toHaveBeenCalledWith(customSessionFilePath);
      expect(result).toBe(true);
    });

    it("should delete session with custom prefix", async () => {
      const customPrefix = "subagent_session";
      const customPrefixFilePath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await deleteSession(
        mockSessionId,
        undefined,
        customPrefix,
      );

      expect(mockFs.unlink).toHaveBeenCalledWith(customPrefixFilePath);
      expect(result).toBe(true);
    });

    it("should delete session from custom sessionDir with custom prefix", async () => {
      const customSessionDir = "/custom/sessions";
      const customPrefix = "subagent_session";
      const customFilePath = `${customSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await deleteSession(
        mockSessionId,
        customSessionDir,
        customPrefix,
      );

      expect(mockFs.unlink).toHaveBeenCalledWith(customFilePath);
      expect(result).toBe(true);
    });

    it("should return false for non-existent session with custom prefix", async () => {
      const customPrefix = "nonexistent_prefix";
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      mockFs.unlink.mockRejectedValue(error);

      const result = await deleteSession(
        mockSessionId,
        undefined,
        customPrefix,
      );

      expect(result).toBe(false);
    });

    it("should handle deletion errors with custom prefix", async () => {
      const customPrefix = "test_prefix";
      const error = new Error("Permission denied");
      mockFs.unlink.mockRejectedValue(error);

      await expect(
        deleteSession(mockSessionId, undefined, customPrefix),
      ).rejects.toThrow(
        `Failed to delete session ${mockSessionId}: Error: Permission denied`,
      );
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

      const result = await cleanupExpiredSessions(mockWorkdir);

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

      const result = await cleanupExpiredSessions(mockWorkdir);

      expect(result).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should cleanup expired sessions from custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      const now = new Date("2024-02-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const expiredSession = {
        ...mockSessionData,
        id: "expired_session",
        metadata: {
          ...mockSessionData.metadata,
          lastActiveAt: "2023-12-01T00:00:00.000Z", // 62 days old
        },
      };

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(["session_expired.json"] as never);
      mockFs.readFile.mockResolvedValue(JSON.stringify(expiredSession));
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(
        mockWorkdir,
        customSessionDir,
      );

      expect(mockFs.readdir).toHaveBeenCalledWith(customSessionDir);
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

      const result = await cleanupExpiredSessions(mockWorkdir);

      expect(result).toBe(0);
      // Failed deletions are silently handled, no console.warn expected

      vi.useRealTimers();
    });
  });

  describe("getSessionFilePath", () => {
    it("should generate file path with default prefix", () => {
      const result = getSessionFilePath(mockSessionId);

      expect(result).toBe(mockSessionFilePath);
    });

    it("should generate file path with custom sessionDir and default prefix", () => {
      const customSessionDir = "/custom/sessions";
      const expectedPath = `${customSessionDir}/session_${mockShortId}.json`;

      const result = getSessionFilePath(mockSessionId, customSessionDir);

      expect(result).toBe(expectedPath);
    });

    it("should generate file path with custom prefix", () => {
      const customPrefix = "subagent_session";
      const expectedPath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;

      const result = getSessionFilePath(mockSessionId, undefined, customPrefix);

      expect(result).toBe(expectedPath);
    });

    it("should generate file path with custom sessionDir and custom prefix", () => {
      const customSessionDir = "/custom/sessions";
      const customPrefix = "subagent_session";
      const expectedPath = `${customSessionDir}/${customPrefix}_${mockShortId}.json`;

      const result = getSessionFilePath(
        mockSessionId,
        customSessionDir,
        customPrefix,
      );

      expect(result).toBe(expectedPath);
    });

    it("should handle different prefix formats", () => {
      const testCases = [
        {
          prefix: "test",
          expected: `${mockSessionDir}/test_${mockShortId}.json`,
        },
        {
          prefix: "my_custom_prefix",
          expected: `${mockSessionDir}/my_custom_prefix_${mockShortId}.json`,
        },
        {
          prefix: "agent-123",
          expected: `${mockSessionDir}/agent-123_${mockShortId}.json`,
        },
      ];

      testCases.forEach(({ prefix, expected }) => {
        const result = getSessionFilePath(mockSessionId, undefined, prefix);
        expect(result).toBe(expected);
      });
    });

    it("should extract correct short ID from full sessionId", () => {
      const fullSessionId = "test_session_87654321";
      const expectedShortId = "87654321";
      const expectedPath = `${mockSessionDir}/session_${expectedShortId}.json`;

      const result = getSessionFilePath(fullSessionId);

      expect(result).toBe(expectedPath);
    });

    it("should handle sessionId without underscores by taking last 8 characters", () => {
      const shortSessionId = "abcdef123456";
      const expectedShortId = "ef123456";
      const expectedPath = `${mockSessionDir}/session_${expectedShortId}.json`;

      const result = getSessionFilePath(shortSessionId);

      expect(result).toBe(expectedPath);
    });
  });

  describe("sessionExists", () => {
    it("should return true for existing session", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await sessionExists(mockSessionId);

      expect(mockFs.access).toHaveBeenCalledWith(mockSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return true for existing session in custom sessionDir", async () => {
      const customSessionDir = "/custom/sessions";
      const customSessionFilePath = `${customSessionDir}/session_${mockShortId}.json`;
      mockFs.access.mockResolvedValue(undefined);

      const result = await sessionExists(mockSessionId, customSessionDir);

      expect(mockFs.access).toHaveBeenCalledWith(customSessionFilePath);
      expect(result).toBe(true);
    });

    it("should return true for existing session with custom prefix", async () => {
      const customPrefix = "subagent_session";
      const customPrefixFilePath = `${mockSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.access.mockResolvedValue(undefined);

      const result = await sessionExists(
        mockSessionId,
        undefined,
        customPrefix,
      );

      expect(mockFs.access).toHaveBeenCalledWith(customPrefixFilePath);
      expect(result).toBe(true);
    });

    it("should return true for existing session with custom sessionDir and custom prefix", async () => {
      const customSessionDir = "/custom/sessions";
      const customPrefix = "subagent_session";
      const customFilePath = `${customSessionDir}/${customPrefix}_${mockShortId}.json`;
      mockFs.access.mockResolvedValue(undefined);

      const result = await sessionExists(
        mockSessionId,
        customSessionDir,
        customPrefix,
      );

      expect(mockFs.access).toHaveBeenCalledWith(customFilePath);
      expect(result).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      mockFs.access.mockRejectedValue(new Error("File not found"));

      const result = await sessionExists(mockSessionId);

      expect(result).toBe(false);
    });
  });
});
