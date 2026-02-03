import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fs/promises (used by session.ts)
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

// Mock fileUtils (used by optimized session.ts)
vi.mock("@/utils/fileUtils.js", () => ({
  readFirstLine: vi.fn(),
  getLastLine: vi.fn(),
}));

// Mock JsonlHandler (used by session.ts)
vi.mock("@/services/jsonlHandler.js", () => ({
  JsonlHandler: vi.fn(() => ({
    read: vi.fn(),
    append: vi.fn(),
    isValidSessionFilename: vi.fn(),
    generateSessionFilename: vi.fn(),
    getLastMessage: vi.fn(),
    createSession: vi.fn(),
  })),
}));

// Mock PathEncoder
vi.mock("@/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn(() => ({
    createProjectDirectory: vi.fn(),
    getProjectDirectory: vi.fn(),
    decode: vi.fn(),
  })),
}));

import {
  generateSessionId,
  createSession,
  appendMessages,
  loadSessionFromJsonl,
  listSessionsFromJsonl,
  getLatestSessionFromJsonl,
  cleanupExpiredSessionsFromJsonl,
} from "@/services/session.js";
import type { Message } from "@/types/index.js";

describe("Session Integration Tests", () => {
  let tempDir: string;
  let testWorkdir: string;
  let mockJsonlHandler: {
    read: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    isValidSessionFilename: ReturnType<typeof vi.fn>;
    generateSessionFilename: ReturnType<typeof vi.fn>;
    getLastMessage: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
  };
  let mockPathEncoder: {
    createProjectDirectory: ReturnType<typeof vi.fn>;
    getProjectDirectory: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
  };
  let mockFileUtils: {
    readFirstLine: ReturnType<typeof vi.fn>;
    getLastLine: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Override NODE_ENV to allow file operations in tests
    process.env.NODE_ENV = "development";

    // Use mock directory paths instead of creating real directories
    tempDir = "/mock/temp/session-test";
    testWorkdir = "/mock/temp/session-test/workdir";

    vi.clearAllMocks();

    // Create fresh mock instances for each test
    mockJsonlHandler = {
      read: vi.fn(),
      append: vi.fn(),
      isValidSessionFilename: vi.fn().mockReturnValue(true),
      generateSessionFilename: vi
        .fn()
        .mockImplementation(
          (sessionId: string, sessionType: "main" | "subagent" = "main") => {
            return sessionType === "main"
              ? `${sessionId}.jsonl`
              : `subagent-${sessionId}.jsonl`;
          },
        ),
      getLastMessage: vi.fn().mockResolvedValue(null),
      createSession: vi.fn().mockResolvedValue(undefined),
    };

    mockPathEncoder = {
      createProjectDirectory: vi.fn(),
      getProjectDirectory: vi.fn(),
      decode: vi.fn(),
    };

    mockFileUtils = {
      readFirstLine: vi.fn(),
      getLastLine: vi.fn(),
    };

    // Configure the mocked constructors to return our mock instances
    const { JsonlHandler } = await import("@/services/jsonlHandler.js");
    const { PathEncoder } = await import("@/utils/pathEncoder.js");
    const fileUtilsModule = await import("@/utils/fileUtils.js");

    vi.mocked(JsonlHandler).mockImplementation(
      () => mockJsonlHandler as unknown as InstanceType<typeof JsonlHandler>,
    );
    vi.mocked(PathEncoder).mockImplementation(
      () => mockPathEncoder as unknown as InstanceType<typeof PathEncoder>,
    );

    // Mock fileUtils methods
    vi.mocked(fileUtilsModule.readFirstLine).mockImplementation(
      mockFileUtils.readFirstLine,
    );
    vi.mocked(fileUtilsModule.getLastLine).mockImplementation(
      mockFileUtils.getLastLine,
    );

    // Set up default mock behavior for PathEncoder
    mockPathEncoder.createProjectDirectory.mockResolvedValue({
      originalPath: testWorkdir,
      encodedName: "encoded-workdir",
      encodedPath: `${tempDir}/encoded-workdir`,
      pathHash: undefined,
      isSymbolicLink: false,
    });

    mockPathEncoder.getProjectDirectory.mockResolvedValue({
      originalPath: testWorkdir,
      encodedName: "encoded-workdir",
      encodedPath: `${tempDir}/encoded-workdir`,
      pathHash: undefined,
      isSymbolicLink: false,
    });

    // Get fs from both locations and sync their mocks
    const fs = await import("fs");
    const fsPromises = await import("fs/promises");

    // Sync the mocks between fs.promises and fs/promises
    vi.mocked(fs.promises.access).mockImplementation(
      vi.mocked(fsPromises.access),
    );
    vi.mocked(fs.promises.mkdir).mockImplementation(
      vi.mocked(fsPromises.mkdir),
    );
    vi.mocked(fs.promises.readdir).mockImplementation(
      vi.mocked(fsPromises.readdir),
    );
    vi.mocked(fs.promises.stat).mockImplementation(vi.mocked(fsPromises.stat));
    vi.mocked(fs.promises.unlink).mockImplementation(
      vi.mocked(fsPromises.unlink),
    );
    vi.mocked(fs.promises.rmdir).mockImplementation(
      vi.mocked(fsPromises.rmdir),
    );
    vi.mocked(fs.promises.readFile).mockImplementation(
      vi.mocked(fsPromises.readFile),
    );
    vi.mocked(fs.promises.writeFile).mockImplementation(
      vi.mocked(fsPromises.writeFile),
    );
  });

  describe("T044: Advanced session functionality", () => {
    const createTestMessages = (): Message[] => [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello, world!" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
    ];

    it("should list sessions from JSONL", async () => {
      const fs = await import("fs/promises");
      const session1Id = generateSessionId();
      const session2Id = generateSessionId();
      const messages = createTestMessages();

      // Mock readdir to return session files
      vi.mocked(fs.readdir).mockResolvedValue([
        `${session1Id}.jsonl`,
        `${session2Id}.jsonl`,
        "not-a-session.txt", // Should be ignored
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Create messages with timestamps
      const messagesWithTimestamp = messages.map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));

      // Note: parseSessionFilename is no longer called due to optimization
      // Session type identification is now done via filename prefix checking

      // Mock getLastMessage for getting last messages
      mockJsonlHandler.getLastMessage
        .mockResolvedValueOnce(
          messagesWithTimestamp[messagesWithTimestamp.length - 1],
        ) // First session - last message
        .mockResolvedValueOnce(
          messagesWithTimestamp[messagesWithTimestamp.length - 1],
        ); // Second session - last message

      // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
      const firstMessageJson = JSON.stringify(messagesWithTimestamp[0]);
      mockFileUtils.readFirstLine
        .mockResolvedValueOnce(firstMessageJson) // First session - first message
        .mockResolvedValueOnce(firstMessageJson); // Second session - first message

      const sessions = await listSessionsFromJsonl(testWorkdir);

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id)).toContain(session1Id);
      expect(sessions.map((s) => s.id)).toContain(session2Id);

      // Should be sorted by last active time (most recently active first)
      expect(
        sessions[0].lastActiveAt.getTime() >=
          sessions[1].lastActiveAt.getTime(),
      ).toBe(true);

      // Note: parseSessionFilename is no longer called due to optimization
      // Verify that getLastMessage was called for session metadata
      expect(mockJsonlHandler.getLastMessage).toHaveBeenCalled();
    });

    it("should get latest session based on last active time", async () => {
      const fs = await import("fs/promises");
      const session1Id = generateSessionId();
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session2Id = generateSessionId();
      const messages = createTestMessages();

      // Mock readdir to return session files
      vi.mocked(fs.readdir).mockResolvedValue([
        `${session1Id}.jsonl`,
        `${session2Id}.jsonl`,
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Create different timestamps - session1 more recently active despite older UUID
      const olderTimestamp = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const newerTimestamp = new Date().toISOString(); // now

      const session1LastMessage = {
        ...messages[messages.length - 1],
        timestamp: newerTimestamp, // session1 is more recently active
      };

      const session2LastMessage = {
        ...messages[messages.length - 1],
        timestamp: olderTimestamp, // session2 is older despite newer UUID
      };

      // Note: parseSessionFilename is no longer called due to optimization
      // Session type identification is now done via filename prefix checking

      // Mock getLastMessage for last messages with different timestamps
      mockJsonlHandler.getLastMessage
        .mockResolvedValueOnce(session1LastMessage) // First session - more recent last message
        .mockResolvedValueOnce(session2LastMessage); // Second session - older last message

      // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
      const firstMessageJson = JSON.stringify({
        ...messages[0],
        timestamp: newerTimestamp,
      });
      mockFileUtils.readFirstLine
        .mockResolvedValueOnce(firstMessageJson) // First session - first message
        .mockResolvedValueOnce(firstMessageJson); // Second session - first message

      // Mock read for loadSessionFromJsonl (this is still needed for full session loading)
      const messagesWithTimestamp = messages.map((msg) => ({
        ...msg,
        timestamp: newerTimestamp,
      }));
      mockJsonlHandler.read.mockResolvedValueOnce(messagesWithTimestamp); // Load full session data for latest (session1)

      const latestSession = await getLatestSessionFromJsonl(testWorkdir);

      expect(latestSession).toBeTruthy();
      expect(latestSession!.id).toBe(session1Id); // Session1 has more recent activity
    });

    it("should cleanup expired sessions", async () => {
      // Since cleanup is disabled in test environment, it should return 0
      const deletedCount = await cleanupExpiredSessionsFromJsonl(testWorkdir);

      // Should be 0 since cleanup is disabled in test environment
      expect(deletedCount).toBe(0);
    });
  });

  describe("T045: Complete session lifecycle integration test", () => {
    it("should complete full session lifecycle", async () => {
      const fs = await import("fs/promises");
      const sessionId = generateSessionId();
      const mockFileSystem = new Map<string, string>();

      // Mock fs.access to track session existence
      const deletedFiles = new Set<string>();
      vi.mocked(fs.access).mockImplementation(async (path) => {
        const pathStr = path.toString();
        if (deletedFiles.has(pathStr)) {
          throw new Error("ENOENT: no such file or directory");
        }
        return Promise.resolve();
      });

      // Mock fs.unlink to track deleted files
      vi.mocked(fs.unlink).mockImplementation(async (path) => {
        const pathStr = path.toString();
        deletedFiles.add(pathStr);
        mockFileSystem.delete(pathStr);
        return Promise.resolve();
      });

      // Mock fs.readdir
      vi.mocked(fs.readdir).mockImplementation(async () => {
        const files = Array.from(mockFileSystem.keys())
          .filter((path) => path.endsWith(".jsonl"))
          .map((path) => path.split("/").pop()!)
          .filter(Boolean);
        return Promise.resolve(
          files as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );
      });

      vi.mocked(fs.readdir).mockResolvedValue([]);
      vi.mocked(fs.rmdir).mockResolvedValue(undefined);

      // 1. Create new session with messages
      const initialMessages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Start of session" }],
        },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Session started" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        },
      ];

      // Create the session first
      await createSession(sessionId, testWorkdir);
      await appendMessages(sessionId, initialMessages, testWorkdir);
      expect(mockJsonlHandler.append).toHaveBeenCalledTimes(1);

      // 2. Load session data back
      const messagesWithTimestamp = initialMessages.map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));
      mockJsonlHandler.read.mockResolvedValueOnce(messagesWithTimestamp);

      let sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);
      expect(sessionData).toBeTruthy();
      expect(sessionData!.messages).toHaveLength(2);
      expect(sessionData!.metadata.latestTotalTokens).toBe(8);

      // 3. Append more messages
      const additionalMessages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Continue session" }],
        },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Session continues" }],
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
        },
      ];

      await appendMessages(sessionId, additionalMessages, testWorkdir);
      expect(mockJsonlHandler.append).toHaveBeenCalledTimes(2);

      // 4. Load updated session
      const allMessagesWithTimestamp = [
        ...initialMessages,
        ...additionalMessages,
      ].map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));
      mockJsonlHandler.read.mockResolvedValueOnce(allMessagesWithTimestamp);

      sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);
      expect(sessionData!.messages).toHaveLength(4);
      expect(sessionData!.metadata.latestTotalTokens).toBe(17);

      // 5. List sessions shows our session
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        `${sessionId}.jsonl`,
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Note: parseSessionFilename is no longer called due to optimization
      // Session type identification is now done via filename prefix checking

      // Mock getLastMessage for last message
      mockJsonlHandler.getLastMessage.mockResolvedValueOnce(
        allMessagesWithTimestamp[allMessagesWithTimestamp.length - 1],
      );

      // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
      const firstMessageJson = JSON.stringify(allMessagesWithTimestamp[0]);
      mockFileUtils.readFirstLine.mockResolvedValueOnce(firstMessageJson);

      const sessions = await listSessionsFromJsonl(testWorkdir);
      expect(sessions.some((s) => s.id === sessionId)).toBe(true);

      // 6. Get latest session returns our session (if it's the most recent)
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        `${sessionId}.jsonl`,
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      // Note: parseSessionFilename is no longer called due to optimization
      // Session type identification is now done via filename prefix checking

      // Mock getLastMessage for last message
      mockJsonlHandler.getLastMessage.mockResolvedValueOnce(
        allMessagesWithTimestamp[allMessagesWithTimestamp.length - 1],
      );

      // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
      mockFileUtils.readFirstLine.mockResolvedValueOnce(firstMessageJson);

      // Mock read for loadSessionFromJsonl (used by getLatestSessionFromJsonl)
      mockJsonlHandler.read.mockResolvedValueOnce(allMessagesWithTimestamp); // For loadSessionFromJsonl

      const latestSession = await getLatestSessionFromJsonl(testWorkdir);
      expect(latestSession!.id).toBe(sessionId);
    });

    it("should handle multiple sessions in different workdirs", async () => {
      const fs = await import("fs/promises");
      const workdir1 = "/mock/temp/session-test/project1";
      const workdir2 = "/mock/temp/session-test/project2";

      const session1Id = generateSessionId();
      const session2Id = generateSessionId();

      const messages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Test message" }],
        },
      ];

      // Mock fs.access to always succeed (session files exist after creation)
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // Set up different PathEncoder responses for different workdirs
      // We need both createProjectDirectory (for createSession) and getProjectDirectory (for listSessionsFromJsonl)
      const pathEncoderImpl = async (workdir: string, baseDir: string) => ({
        originalPath: workdir,
        encodedName:
          workdir === workdir1 ? "encoded-project1" : "encoded-project2",
        encodedPath: `${baseDir}/${workdir === workdir1 ? "encoded-project1" : "encoded-project2"}`,
        pathHash: undefined,
        isSymbolicLink: false,
      });

      mockPathEncoder.createProjectDirectory.mockImplementation(
        pathEncoderImpl,
      );
      mockPathEncoder.getProjectDirectory.mockImplementation(pathEncoderImpl);

      // Create sessions in different workdirs
      await createSession(session1Id, workdir1);
      await createSession(session2Id, workdir2);
      await appendMessages(session1Id, messages, workdir1);
      await appendMessages(session2Id, messages, workdir2);

      // Mock readdir to return files based on the requested directory path
      vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
        const dirPathStr = dirPath.toString();
        if (dirPathStr.includes("encoded-project1")) {
          return Promise.resolve([`${session1Id}.jsonl`] as unknown as Awaited<
            ReturnType<typeof fs.readdir>
          >);
        } else if (dirPathStr.includes("encoded-project2")) {
          return Promise.resolve([`${session2Id}.jsonl`] as unknown as Awaited<
            ReturnType<typeof fs.readdir>
          >);
        }
        return Promise.resolve(
          [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );
      });

      // Mock JsonlHandler.read calls for each session
      const messagesWithTimestamp = messages.map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));

      // Note: parseSessionFilename is no longer called due to optimization
      // Session type identification is now done via filename prefix checking

      // Mock getLastMessage for last messages
      mockJsonlHandler.getLastMessage
        .mockResolvedValueOnce(
          messagesWithTimestamp[messagesWithTimestamp.length - 1],
        ) // session1, last message
        .mockResolvedValueOnce(
          messagesWithTimestamp[messagesWithTimestamp.length - 1],
        ); // session2, last message

      // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
      const firstMessageJson = JSON.stringify(messagesWithTimestamp[0]);
      mockFileUtils.readFirstLine
        .mockResolvedValueOnce(firstMessageJson) // session1, first message
        .mockResolvedValueOnce(firstMessageJson); // session2, first message

      // Each workdir should only see its own sessions
      const sessions1 = await listSessionsFromJsonl(workdir1);
      const sessions2 = await listSessionsFromJsonl(workdir2);

      expect(sessions1).toHaveLength(1);
      expect(sessions1[0].id).toBe(session1Id);
      expect(sessions1[0].workdir).toBe(workdir1);

      expect(sessions2).toHaveLength(1);
      expect(sessions2[0].id).toBe(session2Id);
      expect(sessions2[0].workdir).toBe(workdir2);
    });

    it("should preserve message additionalFields through lifecycle", async () => {
      const fs = await import("fs/promises");
      const sessionId = generateSessionId();

      // Mock fs.access to always succeed (session files exist after creation)
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const messagesWithAdditionalFields: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "User message" }],
          additionalFields: { userAgent: "test", source: "cli" },
        },
        {
          role: "assistant",
          blocks: [
            { type: "text", content: "Assistant response" },
            {
              type: "tool",
              stage: "end",
              name: "test-tool",
              result: "success",
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
          additionalFields: { modelName: "test-model", temperature: 0.7 },
        },
      ];

      await createSession(sessionId, testWorkdir);
      await appendMessages(
        sessionId,
        messagesWithAdditionalFields,
        testWorkdir,
      );

      // Mock JsonlHandler.read to return messages with additionalFields and timestamps
      const messagesWithTimestamp = messagesWithAdditionalFields.map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));

      mockJsonlHandler.read.mockResolvedValue(messagesWithTimestamp);

      const sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);

      expect(sessionData!.messages[0].additionalFields).toEqual({
        userAgent: "test",
        source: "cli",
      });
      expect(sessionData!.messages[1].additionalFields).toEqual({
        modelName: "test-model",
        temperature: 0.7,
      });
      expect(sessionData!.messages[1].blocks).toHaveLength(2);
      expect(sessionData!.messages[1].blocks[1]).toMatchObject({
        type: "tool",
        stage: "end",
        name: "test-tool",
        result: "success",
      });
    });
  });
});
