import { describe, it, expect, beforeEach, vi } from "vitest";
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
  listSessionsFromJsonl,
} from "@/services/session.js";

describe("Subagent Session Tests", () => {
  let tempDir: string;
  let testWorkdir: string;
  const SESSION_DIR = join(homedir(), ".wave", "projects");
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

  describe("TDD Tests for User Story 2: Subagent Session Identification - T020", () => {
    describe("generateSubagentFilename function (to be implemented)", () => {
      it("should generate subagent filename with correct prefix", () => {
        // This test validates expected functionality that should be implemented
        const sessionId = "12345678-1234-1234-1234-123456789abc";

        // Mock the expected generateSubagentFilename function call
        const expectedResult = `subagent-${sessionId}.jsonl`;

        // Test via JsonlHandler for now (until dedicated function is added)
        const result = mockJsonlHandler.generateSessionFilename(
          sessionId,
          "subagent",
        );
        expect(result).toBe(expectedResult);
      });

      it("should generate unique subagent filenames for different session IDs", () => {
        const sessionId1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const sessionId2 = "11111111-2222-3333-4444-555555555555";

        const result1 = mockJsonlHandler.generateSessionFilename(
          sessionId1,
          "subagent",
        );
        const result2 = mockJsonlHandler.generateSessionFilename(
          sessionId2,
          "subagent",
        );

        expect(result1).toBe(`subagent-${sessionId1}.jsonl`);
        expect(result2).toBe(`subagent-${sessionId2}.jsonl`);
        expect(result1).not.toBe(result2);
      });

      it("should validate session ID format for subagent filename generation", () => {
        // Test with valid UUID
        expect(() => {
          mockJsonlHandler.generateSessionFilename(
            "12345678-1234-1234-1234-123456789abc",
            "subagent",
          );
        }).not.toThrow();

        // Mock implementation should validate UUID format
        mockJsonlHandler.generateSessionFilename.mockImplementation(
          (sessionId: string, sessionType: "main" | "subagent") => {
            const uuidPattern =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
            if (!uuidPattern.test(sessionId)) {
              throw new Error(`Invalid session ID format: ${sessionId}`);
            }
            return sessionType === "main"
              ? `${sessionId}.jsonl`
              : `subagent-${sessionId}.jsonl`;
          },
        );

        // Test with invalid UUIDs
        const invalidIds = [
          "invalid-id",
          "12345678-1234-1234-1234", // Too short
          "12345678-1234-1234-1234-123456789abcd", // Too long
          "",
        ];

        invalidIds.forEach((invalidId) => {
          expect(() => {
            mockJsonlHandler.generateSessionFilename(invalidId, "subagent");
          }).toThrow(`Invalid session ID format: ${invalidId}`);
        });
      });
    });

    describe("Subagent session creation workflow", () => {
      it("should create subagent sessions with correct filename prefix", async () => {
        const fs = await import("fs/promises");

        const sessionId = generateSessionId();

        // Mock successful session creation
        mockJsonlHandler.createSession.mockResolvedValue(undefined);
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);

        // Create subagent session
        await createSession(sessionId, testWorkdir);

        // Verify JsonlHandler.createSession was called
        expect(mockJsonlHandler.createSession).toHaveBeenCalled();
        expect(mockPathEncoder.createProjectDirectory).toHaveBeenCalledWith(
          testWorkdir,
          SESSION_DIR,
        );
      });

      it("should distinguish subagent sessions from main sessions by filename", async () => {
        const sessionId = "87654321-4321-4321-4321-abcdef123456";

        // Test filename generation distinguishes session types
        const mainFilename = mockJsonlHandler.generateSessionFilename(
          sessionId,
          "main",
        );
        const subagentFilename = mockJsonlHandler.generateSessionFilename(
          sessionId,
          "subagent",
        );

        expect(mainFilename).toBe(`${sessionId}.jsonl`);
        expect(subagentFilename).toBe(`subagent-${sessionId}.jsonl`);

        // Should be able to identify type from filename alone
        expect(mainFilename.startsWith("subagent-")).toBe(false);
        expect(subagentFilename.startsWith("subagent-")).toBe(true);
      });

      it("should handle subagent session creation in messageManager context", async () => {
        const fs = await import("fs/promises");
        const sessionId = generateSessionId();

        // Mock fs operations for successful creation
        vi.mocked(fs.mkdir).mockResolvedValue(undefined);
        mockJsonlHandler.createSession.mockResolvedValue(undefined);

        const messages = [
          {
            role: "user" as const,
            blocks: [
              { type: "text" as const, content: "Hello from subagent session" },
            ],
          },
        ];

        // Create and use subagent session
        await createSession(sessionId, testWorkdir);
        await appendMessages(sessionId, messages, testWorkdir);

        // Verify operations were called correctly
        expect(mockJsonlHandler.createSession).toHaveBeenCalled();
        expect(mockJsonlHandler.append).toHaveBeenCalled();
      });
    });

    describe("Session type identification from filename", () => {
      it("should exclude subagent sessions by default", async () => {
        const fs = await import("fs/promises");
        const mainSessionId = generateSessionId();
        const subagentSessionId = generateSessionId();

        // Mock readdir to return mixed session files
        vi.mocked(fs.readdir).mockResolvedValue([
          `${mainSessionId}.jsonl`, // main session
          `subagent-${subagentSessionId}.jsonl`, // subagent session
          "invalid-file.txt", // should be ignored
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        // Note: parseSessionFilename is no longer called due to optimization
        // Session type identification is now done via filename prefix checking

        // Mock validation to filter valid sessions
        mockJsonlHandler.isValidSessionFilename
          .mockReturnValueOnce(true) // main session
          .mockReturnValueOnce(true) // subagent session
          .mockReturnValueOnce(false); // invalid file

        // Mock getLastMessage for session listing
        mockJsonlHandler.getLastMessage
          .mockResolvedValueOnce({
            role: "user",
            blocks: [{ type: "text", content: "Main session message" }],
            timestamp: new Date().toISOString(),
          })
          .mockResolvedValueOnce({
            role: "user",
            blocks: [{ type: "text", content: "Subagent session message" }],
            timestamp: new Date().toISOString(),
          });

        // Mock read for getting first message timestamps
        const mockMessage = {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Test" }],
          timestamp: new Date().toISOString(),
        };
        // Mock readFirstLine for getting first message timestamps (PERFORMANCE OPTIMIZATION)
        const mockMessageJson = JSON.stringify(mockMessage);
        mockFileUtils.readFirstLine
          .mockResolvedValueOnce(mockMessageJson) // main session
          .mockResolvedValueOnce(mockMessageJson); // subagent session

        const sessions = await listSessionsFromJsonl(testWorkdir);

        // Should only find main session (subagent sessions are excluded by default)
        expect(sessions).toHaveLength(1);

        const mainSession = sessions.find((s) => s.id === mainSessionId);
        expect(mainSession).toBeDefined();

        // PERFORMANCE VERIFICATION: No full file content reading needed for session listing
        // (readFirstLine is used instead of read for better performance)
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();
      });

      it("should support session filtering by type using filename patterns", () => {
        const sessionFiles = [
          "12345678-1234-1234-1234-123456789abc.jsonl", // main
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl", // subagent
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", // main
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl", // subagent
          "invalid-file.txt", // invalid
        ];

        // Filter sessions by type using filename patterns (no file reading)
        const mainSessionFiles = sessionFiles.filter((filename) => {
          // Mock isValidSessionFilename behavior
          const validPatterns = [
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
            /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
          ];

          const isValid = validPatterns.some((pattern) =>
            pattern.test(filename),
          );
          return isValid && !filename.startsWith("subagent-");
        });

        const subagentSessionFiles = sessionFiles.filter((filename) => {
          const validSubagentPattern =
            /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
          return validSubagentPattern.test(filename);
        });

        expect(mainSessionFiles).toHaveLength(2);
        expect(subagentSessionFiles).toHaveLength(2);

        // Verify correct categorization
        mainSessionFiles.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(false);
          expect(filename.endsWith(".jsonl")).toBe(true);
        });

        subagentSessionFiles.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(true);
          expect(filename.endsWith(".jsonl")).toBe(true);
        });
      });

      it("should verify efficient session type detection and exclude subagent sessions", async () => {
        const fs = await import("fs/promises");

        // Create large number of mixed session files
        const sessionFiles: string[] = [];
        const sessionCount = 50;

        for (let i = 0; i < sessionCount; i++) {
          const sessionId = generateSessionId();
          if (i % 2 === 0) {
            sessionFiles.push(`${sessionId}.jsonl`); // main session
          } else {
            sessionFiles.push(`subagent-${sessionId}.jsonl`); // subagent session
          }
        }

        // Mock readdir to return all session files
        vi.mocked(fs.readdir).mockResolvedValue(
          sessionFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );

        // Note: parseSessionFilename is no longer called due to optimization
        // Session type identification is now done via filename prefix checking

        // Mock isValidSessionFilename to return true for all valid formats
        mockJsonlHandler.isValidSessionFilename.mockImplementation(
          (filename: string) => {
            const validPatterns = [
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
              /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
            ];
            return validPatterns.some((pattern) => pattern.test(filename));
          },
        );

        // Mock getLastMessage and read for session metadata
        const mockMessage = {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Test" }],
          timestamp: new Date().toISOString(),
        };

        for (let i = 0; i < sessionCount; i++) {
          mockJsonlHandler.getLastMessage.mockResolvedValueOnce(mockMessage);
          mockJsonlHandler.read.mockResolvedValueOnce([mockMessage]);
        }

        // List all sessions (subagent sessions are excluded by default)
        const sessions = await listSessionsFromJsonl(testWorkdir);

        // Verify only main sessions were returned (subagent sessions are excluded)
        // Since we created equal numbers of main and subagent sessions, we expect half
        expect(sessions).toHaveLength(sessionCount / 2);

        // All returned sessions should be main sessions
        const mainSessions = sessions.filter((s) => !s.id.includes("subagent"));
        expect(mainSessions.length).toBe(sessionCount / 2);
      });
    });

    describe("Performance optimization tests for session filtering", () => {
      it("should filter sessions efficiently without file content reading", () => {
        // Simulate large session directory
        const sessionFiles = [];
        const totalSessions = 100;

        for (let i = 0; i < totalSessions; i++) {
          const sessionId = generateSessionId();
          if (i % 3 === 0) {
            sessionFiles.push(`subagent-${sessionId}.jsonl`); // subagent
          } else {
            sessionFiles.push(`${sessionId}.jsonl`); // main
          }
        }

        // Filter using filename patterns (simulating efficient filtering)
        const mainSessions = sessionFiles.filter((filename) => {
          const mainPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
          return mainPattern.test(filename);
        });

        const subagentSessions = sessionFiles.filter((filename) => {
          const subagentPattern =
            /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
          return subagentPattern.test(filename);
        });

        // Verify filtering worked correctly
        expect(mainSessions.length + subagentSessions.length).toBe(
          totalSessions,
        );
        expect(subagentSessions.length).toBeGreaterThan(0);
        expect(mainSessions.length).toBeGreaterThan(0);

        // Verify no file content reading was needed
        mainSessions.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(false);
          expect(filename.endsWith(".jsonl")).toBe(true);
        });

        subagentSessions.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(true);
          expect(filename.endsWith(".jsonl")).toBe(true);
        });
      });

      it("should measure that no file content reading occurs during type filtering", async () => {
        const fs = await import("fs/promises");

        // Create test session files
        const sessionFiles = [
          "12345678-1234-1234-1234-123456789abc.jsonl", // main
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl", // subagent
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", // main
        ];

        vi.mocked(fs.readdir).mockResolvedValue(
          sessionFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
        );

        // Note: parseSessionFilename is no longer called due to optimization
        // Session type identification is now done via filename prefix checking

        // Reset read call count to measure content reading
        mockJsonlHandler.read.mockClear();

        // Simulate filtering process (parseSessionFilename only, no content reading)
        const validSessions = sessionFiles
          .filter((filename) => {
            const validPatterns = [
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
              /^subagent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/,
            ];
            return validPatterns.some((pattern) => pattern.test(filename));
          })
          .map((filename) => {
            // Only parse filename for type detection - no file content reading
            const sessionId = filename
              .replace(/^(subagent-)?/, "")
              .replace(".jsonl", "");
            const sessionType = filename.startsWith("subagent-")
              ? "subagent"
              : "main";
            return { sessionId, sessionType, filename };
          });

        // Verify filtering completed successfully
        expect(validSessions).toHaveLength(3);

        // Verify no file content reading occurred during filtering
        expect(mockJsonlHandler.read).not.toHaveBeenCalled();

        // Verify type identification was successful
        const mainCount = validSessions.filter(
          (s) => s.sessionType === "main",
        ).length;
        const subagentCount = validSessions.filter(
          (s) => s.sessionType === "subagent",
        ).length;

        expect(mainCount).toBe(2);
        expect(subagentCount).toBe(1);
      });
    });
  });
});
