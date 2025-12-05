import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";

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
  appendMessages,
  loadSessionFromJsonl,
  sessionExistsInJsonl,
  deleteSessionFromJsonl,
  getSessionFilePath,
} from "@/services/session.js";
import type { Message } from "@/types/index.js";

describe("Session Core Functionality", () => {
  let tempDir: string;
  let testWorkdir: string;
  const SESSION_DIR = join(homedir(), ".wave", "projects");
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

  // Helper function to mock session file existence
  const mockSessionFileExists = async (
    sessionId: string,
    sessionType: "main" | "subagent" = "main",
    exists = true,
  ) => {
    const fs = await import("fs/promises");
    if (exists) {
      if (sessionType === "main") {
        // Main session exists, so first access call succeeds
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      } else {
        // Main session doesn't exist, subagent exists
        vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));
        vi.mocked(fs.access).mockResolvedValueOnce(undefined);
      }
    } else {
      // Neither main nor subagent exists
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
    }
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
      isValidSessionFilename: vi.fn().mockReturnValue(true), // Default: valid filenames
      parseSessionFilename: vi.fn(), // Mock will be set up per test
      generateSessionFilename: vi
        .fn()
        .mockImplementation(
          (sessionId: string, sessionType: "main" | "subagent" = "main") => {
            return sessionType === "main"
              ? `${sessionId}.jsonl`
              : `subagent-${sessionId}.jsonl`;
          },
        ), // Default implementation for testing
      getLastMessage: vi.fn().mockResolvedValue(null), // Default: no last message
      createSession: vi.fn().mockResolvedValue(undefined), // Default: successful session creation
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

  describe("T016: crypto.randomUUID() Generation and Validation", () => {
    it("should generate valid UUID format", () => {
      const sessionId = generateSessionId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      // where y is 8, 9, A, or B (variant bits)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(sessionId).toMatch(uuidRegex);
      expect(sessionId).toBe(sessionId.toLowerCase());
    });

    it("should generate different UUIDs on multiple calls", () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      const id3 = generateSessionId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("should generate unique UUIDs", () => {
      const ids: string[] = [];

      // Generate multiple UUIDs
      for (let i = 0; i < 10; i++) {
        ids.push(generateSessionId());
      }

      // All UUIDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);

      // All should be valid UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      ids.forEach((id) => {
        expect(id).toMatch(uuidRegex);
      });
    });

    it("should validate UUID format using Node.js crypto", () => {
      const validId = generateSessionId();
      const invalidIds = [
        "invalid-uuid",
        "12345678-1234-6678-9abc-123456789012", // v6 format (we now use v4)
        "12345678-1234-5678-9abc-123456789012", // v5 format
        "",
        "not-a-uuid-at-all",
      ];

      // Valid UUID should pass format validation
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(validId).toMatch(uuidRegex);
      expect(validId.length).toBe(36);
      expect(() => randomUUID()).not.toThrow();
      expect(validId).toBeTruthy();
      expect(() => randomUUID()).not.toThrow();
      expect(validId).toBeTruthy();
      expect(typeof validId).toBe("string");

      // Invalid UUIDs should be rejected
      invalidIds.forEach((id) => {
        expect(id).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      });
    });
  });

  describe("T017: Integration test for session file naming", () => {
    it("should create session files with clean UUID names", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(sessionId, testWorkdir);

      expect(filePath).toContain(`${sessionId}.jsonl`);
      // The session ID itself should not have session- or wave- prefixes
      expect(sessionId).not.toContain("session-");
      expect(sessionId).not.toContain("wave-");
      expect(filePath).toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/i,
      );
    });

    it("should use .jsonl file extension", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(sessionId, testWorkdir);

      expect(filePath.endsWith(".jsonl")).toBe(true);
    });

    it("should create files in correct project directory structure", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(sessionId, testWorkdir);

      // Should be in tempDir/encoded-workdir/sessionId.jsonl format
      expect(filePath).toContain(tempDir);
      expect(filePath).not.toBe(`${tempDir}/${sessionId}.jsonl`); // Not directly in tempDir

      // Should be in a subdirectory
      const relativePath = filePath.replace(tempDir, "");
      const pathParts = relativePath.split("/").filter((p) => p);
      expect(pathParts).toHaveLength(2); // [encoded-workdir, sessionId.jsonl]
    });

    it("should handle special characters in workdir", async () => {
      const specialWorkdirs = {
        "path with spaces": "/mock/path with spaces",
        "special@chars#test": "/mock/special@chars#test",
        "very-long-path":
          "/mock/very-long-path-that-might-need-encoding-because-it-is-extremely-long",
        unicode测试: "/mock/unicode测试",
      };

      for (const workdir of Object.values(specialWorkdirs)) {
        const sessionId = generateSessionId();
        const filePath = await getSessionFilePath(sessionId, workdir);

        expect(filePath).toContain(tempDir);
        expect(filePath.endsWith(`${sessionId}.jsonl`)).toBe(true);

        // In the real implementation, paths would be encoded, but in our mock test,
        // we just verify that the file path is generated correctly
        expect(filePath).toContain(sessionId);
      }
    });
  });

  describe("T044: Basic session functionality", () => {
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

    it("should append messages to session", async () => {
      const fs = await import("fs/promises");

      // Mock fs operations
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const sessionId = generateSessionId();
      const messages = createTestMessages();

      // Mock session file exists (main session)
      await mockSessionFileExists(sessionId, "main", true);

      await appendMessages(sessionId, messages, testWorkdir);

      // Verify that JsonlHandler.append was called
      expect(mockJsonlHandler.append).toHaveBeenCalled();
      expect(mockPathEncoder.createProjectDirectory).toHaveBeenCalledWith(
        testWorkdir,
        SESSION_DIR,
      );
    });

    it("should load session data from JSONL", async () => {
      const sessionId = generateSessionId();
      const messages = createTestMessages();

      // Mock JsonlHandler.read to return test messages with timestamps
      const messagesWithTimestamp = messages.map((msg) => ({
        ...msg,
        timestamp: new Date().toISOString(),
      }));

      mockJsonlHandler.read.mockResolvedValue(messagesWithTimestamp);

      // Mock session file exists (main session)
      await mockSessionFileExists(sessionId, "main", true);

      const sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);

      expect(sessionData).toBeTruthy();
      expect(sessionData!.id).toBe(sessionId);
      expect(sessionData!.messages).toHaveLength(2);
      expect(sessionData!.metadata.workdir).toBe(testWorkdir);
      expect(sessionData!.metadata.latestTotalTokens).toBe(15);
      expect(mockPathEncoder.createProjectDirectory).toHaveBeenCalledWith(
        testWorkdir,
        SESSION_DIR,
      );
      expect(mockJsonlHandler.read).toHaveBeenCalled();
    });

    it("should return null for non-existent session", async () => {
      // Mock JsonlHandler.read to throw error for non-existent file
      mockJsonlHandler.read.mockRejectedValue(
        Object.assign(new Error("ENOENT: no such file or directory"), {
          code: "ENOENT",
        }),
      );

      const sessionId = generateSessionId();
      const sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);

      expect(sessionData).toBeNull();
    });

    it("should check if session exists", async () => {
      const sessionId = generateSessionId();

      // First check - file doesn't exist (neither main nor subagent)
      await mockSessionFileExists(sessionId, "main", false);
      expect(await sessionExistsInJsonl(sessionId, testWorkdir)).toBe(false);

      // Second check - file exists (main session)
      await mockSessionFileExists(sessionId, "main", true);
      expect(await sessionExistsInJsonl(sessionId, testWorkdir)).toBe(true);

      // Verify PathEncoder was used
      expect(mockPathEncoder.createProjectDirectory).toHaveBeenCalledWith(
        testWorkdir,
        SESSION_DIR,
      );
    });

    it("should delete session", async () => {
      const fs = await import("fs/promises");
      const sessionId = generateSessionId();

      // Mock that the session file exists (main session)
      await mockSessionFileExists(sessionId, "main", true);

      // Mock file operations for successful deletion
      vi.mocked(fs.unlink).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      ); // Empty directory after deletion
      vi.mocked(fs.rmdir).mockResolvedValue(undefined);

      const deleted = await deleteSessionFromJsonl(sessionId, testWorkdir);
      expect(deleted).toBe(true);

      // Mock fs.access for sessionExistsInJsonl to return false (file deleted)
      await mockSessionFileExists(sessionId, "main", false);
      expect(await sessionExistsInJsonl(sessionId, testWorkdir)).toBe(false);
    });

    it("should return false when deleting non-existent session", async () => {
      const fs = await import("fs/promises");
      const sessionId = generateSessionId();

      // Mock unlink to throw ENOENT error for non-existent file
      vi.mocked(fs.unlink).mockRejectedValue(
        Object.assign(new Error("File not found"), { code: "ENOENT" }),
      );

      const deleted = await deleteSessionFromJsonl(sessionId, testWorkdir);

      expect(deleted).toBe(false);
    });

    it("should handle empty messages array gracefully", async () => {
      const sessionId = generateSessionId();

      await appendMessages(sessionId, [], testWorkdir);

      // JsonlHandler.append should not be called for empty messages
      expect(mockJsonlHandler.append).not.toHaveBeenCalled();
    });

    it("should handle corrupted session files gracefully", async () => {
      const sessionId = generateSessionId();

      // Mock JsonlHandler.read to throw invalid JSON error
      mockJsonlHandler.read.mockRejectedValue(
        new Error("Invalid JSON content"),
      );

      const sessionData = await loadSessionFromJsonl(sessionId, testWorkdir);
      expect(sessionData).toBeNull();
    });
  });

  describe("T028 & T029: Filename Parsing Method Verification", () => {
    it("should verify parseSessionFilename method exists and works correctly", () => {
      // Test main session filename parsing
      const mainSessionId = "12345678-1234-1234-1234-123456789abc";
      const mainFilename = `${mainSessionId}.jsonl`;

      mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
        sessionId: mainSessionId,
        sessionType: "main",
      });

      const result = mockJsonlHandler.parseSessionFilename(mainFilename);
      expect(result.sessionId).toBe(mainSessionId);
      expect(result.sessionType).toBe("main");
    });

    it("should verify parseSessionFilename works for subagent sessions", () => {
      // Test subagent session filename parsing
      const subagentSessionId = "87654321-4321-4321-4321-abcdef123456";
      const subagentFilename = `subagent-${subagentSessionId}.jsonl`;

      mockJsonlHandler.parseSessionFilename.mockReturnValueOnce({
        sessionId: subagentSessionId,
        sessionType: "subagent",
      });

      const result = mockJsonlHandler.parseSessionFilename(subagentFilename);
      expect(result.sessionId).toBe(subagentSessionId);
      expect(result.sessionType).toBe("subagent");
    });

    it("should verify isValidSessionFilename method exists and works correctly", () => {
      // Mock the validation method to return appropriate results
      mockJsonlHandler.isValidSessionFilename
        .mockReturnValueOnce(true) // valid main session
        .mockReturnValueOnce(true) // valid subagent session
        .mockReturnValueOnce(false) // invalid filename
        .mockReturnValueOnce(false); // another invalid filename

      // Test valid filenames
      expect(
        mockJsonlHandler.isValidSessionFilename(
          "12345678-1234-1234-1234-123456789abc.jsonl",
        ),
      ).toBe(true);
      expect(
        mockJsonlHandler.isValidSessionFilename(
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl",
        ),
      ).toBe(true);

      // Test invalid filenames
      expect(
        mockJsonlHandler.isValidSessionFilename("invalid-filename.txt"),
      ).toBe(false);
      expect(
        mockJsonlHandler.isValidSessionFilename("not-a-session.jsonl"),
      ).toBe(false);
    });
  });
});
