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
  },
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
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
    parseSessionFilename: vi.fn(),
    generateSessionFilename: vi.fn(),
    getLastMessage: vi.fn(),
    createSession: vi.fn(),
  })),
}));

// Mock PathEncoder
vi.mock("@/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn(() => ({
    createProjectDirectory: vi.fn(),
    decode: vi.fn(),
  })),
}));

import {
  generateSessionId,
  listSessionsFromJsonl,
} from "@/services/session.js";

describe("Session Performance Optimization", () => {
  let tempDir: string;
  let testWorkdir: string;
  let mockJsonlHandler: {
    read: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    isValidSessionFilename: ReturnType<typeof vi.fn>;
    parseSessionFilename: ReturnType<typeof vi.fn>;
    generateSessionFilename: ReturnType<typeof vi.fn>;
    getLastMessage: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
  };
  let mockPathEncoder: {
    createProjectDirectory: ReturnType<typeof vi.fn>;
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
      parseSessionFilename: vi.fn(),
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
  });

  describe("T026: Performance Optimized Session Listing Tests", () => {
    describe("listSessionsFromJsonl performance optimization", () => {
      it("should list sessions without reading full message content", async () => {
        const fs = await import("fs/promises");
        const session1Id = generateSessionId();
        const session2Id = generateSessionId();

        // Mock readdir to return session files
        vi.mocked(fs.readdir).mockResolvedValue([
          `${session1Id}.jsonl`,
          `${session2Id}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        // Mock parseSessionFilename to return session metadata from filenames
        mockJsonlHandler.parseSessionFilename
          .mockReturnValueOnce({
            sessionId: session1Id,
            sessionType: "main" as const,
          })
          .mockReturnValueOnce({
            sessionId: session2Id,
            sessionType: "main" as const,
          });

        // Mock getLastMessage for timestamps and tokens (this should be the ONLY file read per session)
        const lastMessage = {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response" }],
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        mockJsonlHandler.getLastMessage
          .mockResolvedValueOnce(lastMessage)
          .mockResolvedValueOnce(lastMessage);

        // Mock readFirstLine for efficient first message reading
        const firstMessageJson = JSON.stringify({
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "First message" }],
          timestamp: new Date(Date.now() - 1000).toISOString(),
        });

        mockFileUtils.readFirstLine
          .mockResolvedValueOnce(firstMessageJson)
          .mockResolvedValueOnce(firstMessageJson);

        // Mock file stats for empty sessions (fallback timing)
        vi.mocked(fs.stat).mockResolvedValue({
          birthtime: new Date(),
          mtime: new Date(),
          isFile: () => true,
        } as unknown as Awaited<ReturnType<typeof fs.stat>>);

        const sessions = await listSessionsFromJsonl(testWorkdir, false);

        expect(sessions).toHaveLength(2);

        // CRITICAL: Verify that parseSessionFilename was called (filename parsing)
        expect(mockJsonlHandler.parseSessionFilename).toHaveBeenCalledTimes(2);

        // CRITICAL: Verify that getLastMessage was called for each session (only for timestamps/tokens)
        expect(mockJsonlHandler.getLastMessage).toHaveBeenCalledTimes(2);

        // PERFORMANCE CRITICAL: Verify that full file read (.read()) was NOT called
        // This is the key optimization - we should not read full message content
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();
      });

      it("should handle empty session files efficiently", async () => {
        const fs = await import("fs/promises");
        const sessionId = generateSessionId();

        vi.mocked(fs.readdir).mockResolvedValue([
          `${sessionId}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
          sessionId: sessionId,
          sessionType: "main" as const,
        });

        // Mock empty session (no messages yet)
        mockJsonlHandler.getLastMessage.mockResolvedValueOnce(null);

        // Mock file stats for fallback timing
        const now = new Date();
        vi.mocked(fs.stat).mockResolvedValue({
          birthtime: now,
          mtime: now,
          isFile: () => true,
        } as unknown as Awaited<ReturnType<typeof fs.stat>>);

        const sessions = await listSessionsFromJsonl(testWorkdir, false);

        expect(sessions).toHaveLength(1);
        expect(sessions[0].id).toBe(sessionId);
        expect(sessions[0].latestTotalTokens).toBe(0);

        // Should use file stats for timing when no messages exist
        expect(vi.mocked(fs.stat)).toHaveBeenCalled();

        // Should NOT read full file content
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();
      });

      it("should measure performance improvement vs full file reading", async () => {
        const fs = await import("fs/promises");

        // Create a larger number of session files to test performance
        const sessionCount = 20;
        const sessionFiles: string[] = [];
        const sessionIds: string[] = [];

        for (let i = 0; i < sessionCount; i++) {
          const sessionId = generateSessionId();
          sessionIds.push(sessionId);
          sessionFiles.push(`${sessionId}.jsonl`);
        }

        vi.mocked(fs.readdir).mockResolvedValue(
          sessionFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );

        // Mock parseSessionFilename for all sessions
        sessionIds.forEach((sessionId) => {
          mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
            sessionId,
            sessionType: "main" as const,
          });
        });

        // Mock getLastMessage for all sessions
        const lastMessage = {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response" }],
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        for (let i = 0; i < sessionCount; i++) {
          mockJsonlHandler.getLastMessage.mockResolvedValueOnce(lastMessage);
        }

        // Mock readFirstLine for efficient first message reading
        const firstMessageJson = JSON.stringify({
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "First message" }],
          timestamp: new Date(Date.now() - 1000).toISOString(),
        });

        for (let i = 0; i < sessionCount; i++) {
          mockFileUtils.readFirstLine.mockResolvedValueOnce(firstMessageJson);
        }

        const startTime = Date.now();
        const sessions = await listSessionsFromJsonl(testWorkdir, false);
        const endTime = Date.now();

        expect(sessions).toHaveLength(sessionCount);

        // Verify optimized approach was used
        expect(mockJsonlHandler.parseSessionFilename).toHaveBeenCalledTimes(
          sessionCount,
        );
        expect(mockJsonlHandler.getLastMessage).toHaveBeenCalledTimes(
          sessionCount,
        );

        // CRITICAL: Should NOT read full file content for any session
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();

        // Performance should be fast (this is a mock test, but validates the approach)
        const executionTime = endTime - startTime;
        expect(executionTime).toBeLessThan(1000); // Should be very fast with mocks
      });

      it("should return simplified session metadata objects", async () => {
        const fs = await import("fs/promises");
        const sessionId = generateSessionId();

        vi.mocked(fs.readdir).mockResolvedValue([
          `${sessionId}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
          sessionId: sessionId,
          sessionType: "main" as const,
        });

        const lastMessage = {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response" }],
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        mockJsonlHandler.getLastMessage.mockResolvedValueOnce(lastMessage);

        // Mock readFirstLine for efficient first message reading
        const firstMessageJson = JSON.stringify({
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "First message" }],
          timestamp: new Date(Date.now() - 1000).toISOString(),
        });

        mockFileUtils.readFirstLine.mockResolvedValueOnce(firstMessageJson);

        const sessions = await listSessionsFromJsonl(testWorkdir, false);

        expect(sessions).toHaveLength(1);

        // Verify the session object has the expected inline structure
        const session = sessions[0];
        expect(session).toHaveProperty("id", sessionId);
        expect(session).toHaveProperty("sessionType", "main");
        expect(session).toHaveProperty("workdir", testWorkdir);
        expect(session).toHaveProperty("lastActiveAt");
        expect(session).toHaveProperty("latestTotalTokens", 15);

        // Should be a plain object, not a class instance
        expect(Object.getPrototypeOf(session)).toBe(Object.prototype);
      });

      it("should handle subagent sessions with filename parsing only", async () => {
        const fs = await import("fs/promises");
        const mainSessionId = generateSessionId();
        const subagentSessionId = generateSessionId();

        vi.mocked(fs.readdir).mockResolvedValue([
          `${mainSessionId}.jsonl`,
          `subagent-${subagentSessionId}.jsonl`,
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        // Mock parseSessionFilename to identify session types from filenames
        mockJsonlHandler.parseSessionFilename
          .mockReturnValueOnce({
            sessionId: mainSessionId,
            sessionType: "main" as const,
          })
          .mockReturnValueOnce({
            sessionId: subagentSessionId,
            sessionType: "subagent" as const,
          });

        const lastMessage = {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response" }],
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        mockJsonlHandler.getLastMessage
          .mockResolvedValueOnce(lastMessage)
          .mockResolvedValueOnce(lastMessage);

        // Mock readFirstLine for efficient first message reading
        const firstMessageJson = JSON.stringify({
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "First message" }],
          timestamp: new Date(Date.now() - 1000).toISOString(),
        });

        mockFileUtils.readFirstLine
          .mockResolvedValueOnce(firstMessageJson)
          .mockResolvedValueOnce(firstMessageJson);

        // Include subagent sessions in listing
        const sessions = await listSessionsFromJsonl(testWorkdir, false, true);

        expect(sessions).toHaveLength(2);

        const mainSession = sessions.find((s) => s.sessionType === "main");
        const subagentSession = sessions.find(
          (s) => s.sessionType === "subagent",
        );

        expect(mainSession?.id).toBe(mainSessionId);
        expect(subagentSession?.id).toBe(subagentSessionId);

        // CRITICAL: Type identification should be filename-based only
        expect(mockJsonlHandler.parseSessionFilename).toHaveBeenCalledTimes(2);
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();
      });

      it("should verify file operation count matches optimization target", async () => {
        const fs = await import("fs/promises");
        const sessionCount = 10;
        const sessionFiles: string[] = [];
        const sessionIds: string[] = [];

        for (let i = 0; i < sessionCount; i++) {
          const sessionId = generateSessionId();
          sessionIds.push(sessionId);
          sessionFiles.push(`${sessionId}.jsonl`);
        }

        vi.mocked(fs.readdir).mockResolvedValue(
          sessionFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );

        // Mock all required operations
        sessionIds.forEach((sessionId) => {
          mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
            sessionId,
            sessionType: "main" as const,
          });
        });

        const lastMessage = {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response" }],
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        for (let i = 0; i < sessionCount; i++) {
          mockJsonlHandler.getLastMessage.mockResolvedValueOnce(lastMessage);
        }

        // Mock readFirstLine for efficient first message reading
        const firstMessageJson = JSON.stringify({
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "First message" }],
          timestamp: new Date(Date.now() - 1000).toISOString(),
        });

        for (let i = 0; i < sessionCount; i++) {
          mockFileUtils.readFirstLine.mockResolvedValueOnce(firstMessageJson);
        }

        await listSessionsFromJsonl(testWorkdir, false);

        // Performance target verification:
        // BEFORE optimization: O(n*2) operations (readMetadata + getLastMessage per session)
        // AFTER optimization: O(n) operations (only getLastMessage per session)

        // Should call parseSessionFilename once per session (filename parsing)
        expect(mockJsonlHandler.parseSessionFilename).toHaveBeenCalledTimes(
          sessionCount,
        );

        // Should call getLastMessage once per session (for timestamps/tokens)
        expect(mockJsonlHandler.getLastMessage).toHaveBeenCalledTimes(
          sessionCount,
        );

        // Should NOT call read (full file content reading)
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();

        // Total file operations should be exactly N (one per session)
        // vs the old 2*N operations (metadata + last message)
        const totalFileOps = mockJsonlHandler.getLastMessage.mock.calls.length;
        expect(totalFileOps).toBe(sessionCount); // O(n) instead of O(n*2)
      });
    });
  });
});
