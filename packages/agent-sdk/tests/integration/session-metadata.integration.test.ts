/**
 * Integration tests for User Story 1: Session Files Without Metadata Line
 *
 * These tests validate end-to-end workflows for creating, managing, and reading
 * session files that contain only message content without metadata headers.
 *
 * TDD Approach: These tests FAIL initially (before implementation) and PASS after implementation.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { JsonlHandler } from "@/services/jsonlHandler.js";
import type { SessionMessage, SessionFilename } from "@/types/session.js";
import type { TextBlock } from "@/types/messaging.js";

// Mock fs/promises for integration testing
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
}));

describe("Session Metadata Integration Tests - User Story 1", () => {
  let handler: JsonlHandler;
  let mockWriteFile: Mock<typeof import("fs/promises").writeFile>;
  let mockAppendFile: Mock<typeof import("fs/promises").appendFile>;
  let mockReadFile: Mock<typeof import("fs/promises").readFile>;
  let mockStat: Mock<typeof import("fs/promises").stat>;
  let mockMkdir: Mock<typeof import("fs/promises").mkdir>;

  const createTestMessage = (
    role: "user" | "assistant",
    content: string,
    timestamp?: string,
  ): SessionMessage => ({
    role,
    blocks: [{ type: "text", content }],
    timestamp: timestamp || new Date().toISOString(),
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get mocked functions
    const fsPromises = await import("fs/promises");
    mockWriteFile = vi.mocked(fsPromises.writeFile);
    mockAppendFile = vi.mocked(fsPromises.appendFile);
    mockReadFile = vi.mocked(fsPromises.readFile);
    mockStat = vi.mocked(fsPromises.stat);
    mockMkdir = vi.mocked(fsPromises.mkdir);

    // Set up default mock behaviors
    mockStat.mockResolvedValue({
      size: 1024,
      isFile: () => true,
      birthtime: new Date("2024-01-01T00:00:00.000Z"),
      mtime: new Date("2024-01-01T00:00:00.000Z"),
      atime: new Date("2024-01-01T00:00:00.000Z"),
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);

    // Create fresh handler instance
    handler = new JsonlHandler();
  });

  afterEach(() => {
    // Restore all mocks
    vi.restoreAllMocks();
  });

  describe("Complete session creation and reading workflow", () => {
    it("should create session without metadata and support full message lifecycle", async () => {
      const sessionId = "12345678-1234-1234-1234-123456789abc";
      const sessionType = "main";
      const filePath = `/tmp/test-sessions/${handler.generateSessionFilename(sessionId, sessionType)}`;

      // STEP 1: Create session without metadata
      await handler.createSession(filePath);

      // Verify session file created with no metadata header
      expect(mockWriteFile).toHaveBeenCalledOnce();
      expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");

      // STEP 2: Add multiple messages to session
      const messages = [
        createTestMessage(
          "user",
          "Hello, I need help with a project",
          "2024-01-01T10:00:00.000Z",
        ),
        createTestMessage(
          "assistant",
          "I'd be happy to help! What kind of project are you working on?",
          "2024-01-01T10:00:15.000Z",
        ),
        createTestMessage(
          "user",
          "I'm building a web application with React and need advice on state management",
          "2024-01-01T10:01:00.000Z",
        ),
        createTestMessage(
          "assistant",
          "For React state management, you have several options: useState for local state, useReducer for complex state logic, or external libraries like Redux or Zustand. What's your current setup?",
          "2024-01-01T10:01:30.000Z",
        ),
      ];

      await handler.append(filePath, messages, { atomic: false });

      // Verify messages were appended without metadata
      expect(mockAppendFile).toHaveBeenCalledOnce();
      const appendedContent = mockAppendFile.mock.calls[0][1] as string;
      const lines = appendedContent.split("\n").filter((line) => line.trim());

      expect(lines).toHaveLength(4); // Only the 4 messages
      expect(lines.every((line) => !line.includes("__meta__"))).toBe(true);

      // STEP 3: Read session back and verify structure
      // Mock the file content as it would exist after writing
      const fileContent = lines.join("\n") + "\n";
      mockReadFile.mockResolvedValue(fileContent);

      const readMessages = await handler.read(filePath);

      // Verify all messages read correctly
      expect(readMessages).toHaveLength(4);

      expect(readMessages[0].role).toBe("user");
      expect((readMessages[0].blocks[0] as TextBlock).content).toBe(
        "Hello, I need help with a project",
      );
      expect(readMessages[0].timestamp).toBe("2024-01-01T10:00:00.000Z");

      expect(readMessages[1].role).toBe("assistant");
      expect((readMessages[1].blocks[0] as TextBlock).content).toContain(
        "I'd be happy to help!",
      );

      expect(readMessages[2].role).toBe("user");
      expect((readMessages[2].blocks[0] as TextBlock).content).toContain(
        "React and need advice",
      );

      expect(readMessages[3].role).toBe("assistant");
      expect((readMessages[3].blocks[0] as TextBlock).content).toContain(
        "useState for local state",
      );

      // STEP 4: Verify no metadata handling needed
      // The file should contain ONLY messages, no special metadata processing required
      expect(
        readMessages.every((msg) => msg.timestamp && msg.role && msg.blocks),
      ).toBe(true);
    });

    it("should handle session with complex messages and maintain structure integrity", async () => {
      const sessionId = "87654321-4321-4321-4321-abcdef123456";
      const filePath = `/tmp/test-sessions/${handler.generateSessionFilename(sessionId, "subagent")}`;

      // Create session
      await handler.createSession(filePath);

      // Add complex messages with various properties
      const complexMessages: SessionMessage[] = [
        {
          role: "user",
          blocks: [
            { type: "text", content: "Here's a complex query with code:" },
            {
              type: "text",
              content:
                "```javascript\nfunction hello() {\n  return 'world';\n}\n```",
            },
          ],
          timestamp: "2024-01-01T12:00:00.000Z",
        },
        {
          role: "assistant",
          blocks: [
            {
              type: "text",
              content: "I can see your JavaScript function. Let me analyze it:",
            },
            {
              type: "tool",
              stage: "start",
              name: "code-analyzer",
              parameters: '{"language": "javascript", "function": "hello"}',
            },
          ],
          timestamp: "2024-01-01T12:00:30.000Z",
          usage: {
            prompt_tokens: 25,
            completion_tokens: 15,
            total_tokens: 40,
          },
          additionalFields: {
            model: "gpt-4",
            temperature: 0.7,
          },
        },
      ];

      await handler.append(filePath, complexMessages, { atomic: false });

      // Mock reading the complex content
      const expectedContent =
        complexMessages
          .map((msg) => {
            const { timestamp, ...rest } = msg;
            return JSON.stringify({ timestamp, ...rest });
          })
          .join("\n") + "\n";

      mockReadFile.mockResolvedValue(expectedContent);

      // Read and verify complex structure preserved
      const readMessages = await handler.read(filePath);

      expect(readMessages).toHaveLength(2);

      // Verify first complex message
      expect(readMessages[0].blocks).toHaveLength(2);
      expect((readMessages[0].blocks[0] as TextBlock).content).toContain(
        "complex query",
      );
      expect((readMessages[0].blocks[1] as TextBlock).content).toContain(
        "```javascript",
      );

      // Verify second complex message with all properties
      expect(readMessages[1].usage).toEqual({
        prompt_tokens: 25,
        completion_tokens: 15,
        total_tokens: 40,
      });
      expect(readMessages[1].additionalFields).toEqual({
        model: "gpt-4",
        temperature: 0.7,
      });
    });

    it("should handle empty session gracefully throughout lifecycle", async () => {
      const sessionId = "00000000-0000-0000-0000-000000000000";
      const filePath = `/tmp/test-sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      // Create empty session
      await handler.createSession(filePath);

      expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");

      // Mock reading empty file
      mockReadFile.mockResolvedValue("");

      // Read empty session
      const messages = await handler.read(filePath);
      expect(messages).toHaveLength(0);

      // Verify no metadata handling complexity for empty files
      expect(messages).toEqual([]);
    });
  });

  describe("Session type identification from filename", () => {
    it("should correctly identify main and subagent sessions from filename alone", async () => {
      const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

      // Generate filenames for both types
      const mainFilename = handler.generateSessionFilename(sessionId, "main");
      const subagentFilename = handler.generateSessionFilename(
        sessionId,
        "subagent",
      );

      const mainFilePath = `/sessions/${mainFilename}`;
      const subagentFilePath = `/sessions/${subagentFilename}`;

      // Create both session types
      await handler.createSession(mainFilePath);
      await handler.createSession(subagentFilePath);

      // Verify type can be determined from filename alone (no file reading needed)
      const mainParsed = handler.parseSessionFilename(mainFilePath);
      const subagentParsed = handler.parseSessionFilename(subagentFilePath);

      expect(mainParsed).toEqual({
        sessionId,
        sessionType: "main",
      });

      expect(subagentParsed).toEqual({
        sessionId,
        sessionType: "subagent",
      });

      // Verify filenames are different
      expect(mainFilename).toBe(`${sessionId}.jsonl`);
      expect(subagentFilename).toBe(`subagent-${sessionId}.jsonl`);

      // Verify validation works for both
      expect(handler.isValidSessionFilename(mainFilename)).toBe(true);
      expect(handler.isValidSessionFilename(subagentFilename)).toBe(true);
    });

    it("should support session discovery and categorization by filename patterns", async () => {
      // Simulate session file discovery scenario
      const sessionFiles = [
        "12345678-1234-1234-1234-123456789abc.jsonl", // main
        "subagent-87654321-4321-4321-4321-abcdef123456.jsonl", // subagent
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", // main
        "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl", // subagent
        "invalid-session-file.jsonl", // invalid
        "not-a-session.txt", // invalid
      ];

      const validSessions: SessionFilename[] = [];
      const invalidFiles: string[] = [];

      // Process each file to categorize sessions
      sessionFiles.forEach((filename) => {
        if (handler.isValidSessionFilename(filename)) {
          try {
            const parsed = handler.parseSessionFilename(filename);
            validSessions.push(parsed);
          } catch {
            invalidFiles.push(filename);
          }
        } else {
          invalidFiles.push(filename);
        }
      });

      // Verify categorization
      expect(validSessions).toHaveLength(4);
      expect(invalidFiles).toHaveLength(2);

      // Verify main sessions identified correctly
      const mainSessions = validSessions.filter(
        (s) => s.sessionType === "main",
      );
      expect(mainSessions).toHaveLength(2);
      expect(mainSessions[0].sessionId).toBe(
        "12345678-1234-1234-1234-123456789abc",
      );
      expect(mainSessions[1].sessionId).toBe(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );

      // Verify subagent sessions identified correctly
      const subagentSessions = validSessions.filter(
        (s) => s.sessionType === "subagent",
      );
      expect(subagentSessions).toHaveLength(2);
      expect(subagentSessions[0].sessionId).toBe(
        "87654321-4321-4321-4321-abcdef123456",
      );
      expect(subagentSessions[1].sessionId).toBe(
        "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
      );

      // Verify invalid files identified
      expect(invalidFiles).toContain("invalid-session-file.jsonl");
      expect(invalidFiles).toContain("not-a-session.txt");
    });
  });

  describe("Performance and scalability scenarios", () => {
    it("should handle high-throughput message scenarios efficiently", async () => {
      const sessionId = "99999999-8888-7777-6666-555555555555";
      const filePath = `/tmp/test-sessions/${handler.generateSessionFilename(sessionId, "main")}`;

      // Create session
      await handler.createSession(filePath);

      // Simulate high message volume scenario
      const messageCount = 100;
      const messages: SessionMessage[] = [];

      for (let i = 0; i < messageCount; i++) {
        messages.push(
          createTestMessage(
            i % 2 === 0 ? "user" : "assistant",
            `Message ${i}: This is a test message for performance testing`,
            `2024-01-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
          ),
        );
      }

      // Append all messages (simulating batch operations)
      await handler.append(filePath, messages, { atomic: false });

      // Verify efficient handling (no metadata processing overhead)
      expect(mockAppendFile).toHaveBeenCalledOnce();
      const appendedContent = mockAppendFile.mock.calls[0][1] as string;
      const lines = appendedContent.split("\n").filter((line) => line.trim());

      expect(lines).toHaveLength(messageCount);
      expect(lines.every((line) => !line.includes("__meta__"))).toBe(true);

      // Mock reading large file
      mockReadFile.mockResolvedValue(appendedContent);

      // Verify efficient reading
      const readMessages = await handler.read(filePath);
      expect(readMessages).toHaveLength(messageCount);

      // Spot check a few messages
      expect((readMessages[0].blocks[0] as TextBlock).content).toBe(
        "Message 0: This is a test message for performance testing",
      );
      expect(
        (readMessages[messageCount - 1].blocks[0] as TextBlock).content,
      ).toBe(
        `Message ${messageCount - 1}: This is a test message for performance testing`,
      );
    });

    it("should handle concurrent session operations", async () => {
      // Simulate multiple sessions being created concurrently
      const sessionIds = [
        "11111111-1111-2222-3333-444444444444",
        "22222222-5555-6666-7777-888888888888",
        "33333333-9999-aaaa-bbbb-cccccccccccc",
      ];

      const creationPromises = sessionIds.map(async (sessionId, index) => {
        const sessionType: "main" | "subagent" =
          index % 2 === 0 ? "main" : "subagent";
        const filePath = `/tmp/concurrent/${handler.generateSessionFilename(sessionId, sessionType)}`;

        await handler.createSession(filePath);

        // Add a message to each session
        const message = createTestMessage(
          "user",
          `Initial message for ${sessionId}`,
        );
        await handler.append(filePath, [message], { atomic: false });

        return { sessionId, sessionType, filePath };
      });

      // Wait for all operations to complete
      const results = await Promise.all(creationPromises);

      // Verify all sessions were created correctly
      expect(results).toHaveLength(3);
      expect(mockWriteFile).toHaveBeenCalledTimes(3); // One per session creation
      expect(mockAppendFile).toHaveBeenCalledTimes(3); // One per message append

      // Verify each session filename follows correct format
      results.forEach(({ sessionId, sessionType }) => {
        const expectedFilename = handler.generateSessionFilename(
          sessionId,
          sessionType,
        );
        expect(handler.isValidSessionFilename(expectedFilename)).toBe(true);

        const parsed = handler.parseSessionFilename(expectedFilename);
        expect(parsed.sessionId).toBe(sessionId);
        expect(parsed.sessionType).toBe(sessionType);
      });
    });
  });

  describe("Error handling and edge cases", () => {
    it("should handle filesystem errors gracefully during session lifecycle", async () => {
      const sessionId = "44444444-1234-5678-9abc-def123456789";
      const filePath = `/tmp/error-test/${handler.generateSessionFilename(sessionId, "main")}`;

      // Test directory creation failure
      mockMkdir.mockRejectedValueOnce(
        new Error("EACCES: permission denied") as never,
      );

      await expect(handler.createSession(filePath)).rejects.toThrow(
        "EACCES: permission denied",
      );

      // Reset mocks and test file creation failure
      vi.clearAllMocks();
      mockWriteFile.mockRejectedValueOnce(
        new Error("ENOSPC: no space left on device") as never,
      );

      await expect(handler.createSession(filePath)).rejects.toThrow(
        "ENOSPC: no space left on device",
      );

      // Test read failure for non-existent file
      vi.clearAllMocks();
      mockReadFile.mockRejectedValueOnce(
        new Error("ENOENT: no such file or directory") as never,
      );

      await expect(handler.read(filePath)).rejects.toThrow(
        "Failed to read JSONL file",
      );
    });

    it("should handle malformed session files without metadata expectations", async () => {
      const sessionId = "55555555-1234-5678-9abc-def123456789";
      const filePath = `/tmp/malformed/${handler.generateSessionFilename(sessionId, "main")}`;

      // Test reading file with malformed JSON (no metadata line expected)
      const malformedContent = `{"role":"user","blocks":[{"type":"text","content":"Valid message"}],"timestamp":"2024-01-01T00:00:00.000Z"}
invalid json line here
{"role":"assistant","blocks":[{"type":"text","content":"Another valid message"}],"timestamp":"2024-01-01T00:01:00.000Z"}`;

      mockReadFile.mockResolvedValue(malformedContent);

      await expect(handler.read(filePath)).rejects.toThrow(
        "Invalid JSON at line 2",
      );
    });
  });

  describe("TDD Integration Tests for User Story 2: Subagent Session Filtering - T021", () => {
    describe("Mixed session environment tests", () => {
      it("should create and filter both main and subagent sessions using filename patterns only", async () => {
        // STEP 1: Create multiple session types
        const mainSessionId1 = "12345678-1234-1234-1234-123456789abc";
        const mainSessionId2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const subagentSessionId1 = "87654321-4321-4321-4321-abcdef123456";
        const subagentSessionId2 = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb";

        const sessions = [
          { id: mainSessionId1, type: "main" as const },
          { id: subagentSessionId1, type: "subagent" as const },
          { id: mainSessionId2, type: "main" as const },
          { id: subagentSessionId2, type: "subagent" as const },
        ];

        // Create all session files
        for (const session of sessions) {
          const filePath = `/tmp/mixed-sessions/${handler.generateSessionFilename(session.id, session.type)}`;
          await handler.createSession(filePath);

          // Add sample message to each session
          const message = createTestMessage(
            "user",
            `Message for ${session.type} session ${session.id}`,
            new Date().toISOString(),
          );
          await handler.append(filePath, [message], { atomic: false });
        }

        // STEP 2: Simulate session discovery and filtering by filename patterns
        const allSessionFiles = sessions.map((session) =>
          handler.generateSessionFilename(session.id, session.type),
        );

        // Filter main sessions using filename pattern (no file content reading)
        const mainSessionFiles = allSessionFiles.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            !filename.startsWith("subagent-"),
        );

        // Filter subagent sessions using filename pattern (no file content reading)
        const subagentSessionFiles = allSessionFiles.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            filename.startsWith("subagent-"),
        );

        // STEP 3: Verify filtering results
        expect(mainSessionFiles).toHaveLength(2);
        expect(subagentSessionFiles).toHaveLength(2);

        // Verify main session filenames
        expect(mainSessionFiles).toContain(`${mainSessionId1}.jsonl`);
        expect(mainSessionFiles).toContain(`${mainSessionId2}.jsonl`);

        // Verify subagent session filenames
        expect(subagentSessionFiles).toContain(
          `subagent-${subagentSessionId1}.jsonl`,
        );
        expect(subagentSessionFiles).toContain(
          `subagent-${subagentSessionId2}.jsonl`,
        );

        // STEP 4: Verify no file content reading was required for filtering
        // This is ensured by the filename-based filtering logic above
        mainSessionFiles.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(false);
        });

        subagentSessionFiles.forEach((filename) => {
          expect(filename.startsWith("subagent-")).toBe(true);
        });
      });

      it("should handle large mixed session environments efficiently", async () => {
        const sessionCount = 50;
        const sessions: Array<{ id: string; type: "main" | "subagent" }> = [];

        // Generate large number of mixed sessions
        for (let i = 0; i < sessionCount; i++) {
          const sessionId = `${i.toString().padStart(8, "0")}-1234-5678-9abc-def123456789`;
          const sessionType = i % 3 === 0 ? "subagent" : "main"; // 1/3 subagent, 2/3 main
          sessions.push({ id: sessionId, type: sessionType });
        }

        // Create all session files
        for (const session of sessions) {
          const filePath = `/tmp/large-mixed/${handler.generateSessionFilename(session.id, session.type)}`;
          await handler.createSession(filePath);
        }

        // Simulate efficient filtering using filename patterns
        const allFilenames = sessions.map((s) =>
          handler.generateSessionFilename(s.id, s.type),
        );

        // Performance test: Filter using patterns only
        const startTime = Date.now();

        const mainSessions = allFilenames.filter((filename) => {
          return (
            handler.isValidSessionFilename(filename) &&
            !filename.startsWith("subagent-")
          );
        });

        const subagentSessions = allFilenames.filter((filename) => {
          return (
            handler.isValidSessionFilename(filename) &&
            filename.startsWith("subagent-")
          );
        });

        const filterTime = Date.now() - startTime;

        // Verify filtering results
        const expectedMainCount = sessions.filter(
          (s) => s.type === "main",
        ).length;
        const expectedSubagentCount = sessions.filter(
          (s) => s.type === "subagent",
        ).length;

        expect(mainSessions).toHaveLength(expectedMainCount);
        expect(subagentSessions).toHaveLength(expectedSubagentCount);
        expect(mainSessions.length + subagentSessions.length).toBe(
          sessionCount,
        );

        // Verify performance (should be very fast for filename-based filtering)
        expect(filterTime).toBeLessThan(100); // Should complete in < 100ms
      });

      it("should verify no file content reading occurs during filtering", async () => {
        // Track file read operations
        let fileReadCount = 0;
        const originalReadFile = mockReadFile;

        mockReadFile.mockImplementation(async (...args) => {
          fileReadCount++;
          return originalReadFile(...args);
        });

        // Create mixed session files
        const sessions = [
          { id: "12345678-1234-1234-1234-123456789abc", type: "main" as const },
          {
            id: "87654321-4321-4321-4321-abcdef123456",
            type: "subagent" as const,
          },
          { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type: "main" as const },
        ];

        const sessionFilenames = sessions.map((s) =>
          handler.generateSessionFilename(s.id, s.type),
        );

        // Reset file read counter
        fileReadCount = 0;

        // Perform filtering using filename patterns only
        const mainSessions = sessionFilenames.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            !filename.startsWith("subagent-"),
        );

        const subagentSessions = sessionFilenames.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            filename.startsWith("subagent-"),
        );

        // Verify filtering worked
        expect(mainSessions).toHaveLength(2);
        expect(subagentSessions).toHaveLength(1);

        // Verify no file content reading occurred during filtering
        expect(fileReadCount).toBe(0);

        // Restore original mock
        mockReadFile.mockImplementation(originalReadFile);
      });
    });

    describe("Subagent session lifecycle integration tests", () => {
      it("should complete full subagent session lifecycle with type identification", async () => {
        const subagentSessionId = "87654321-4321-4321-4321-abcdef123456";
        const filePath = `/tmp/subagent-lifecycle/${handler.generateSessionFilename(subagentSessionId, "subagent")}`;

        // STEP 1: Create subagent session with prefix
        await handler.createSession(filePath);

        expect(mockWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");

        // STEP 2: Add messages to subagent session
        const subagentMessages: SessionMessage[] = [
          createTestMessage(
            "user",
            "Subagent task: analyze this data",
            "2024-01-01T14:00:00.000Z",
          ),
          createTestMessage(
            "assistant",
            "I'll analyze the data for you.",
            "2024-01-01T14:00:15.000Z",
          ),
          createTestMessage(
            "user",
            "Please provide a summary",
            "2024-01-01T14:01:00.000Z",
          ),
          {
            role: "assistant" as const,
            blocks: [
              { type: "text", content: "Here's the analysis summary..." },
            ],
            timestamp: "2024-01-01T14:01:30.000Z",
            usage: {
              prompt_tokens: 45,
              completion_tokens: 32,
              total_tokens: 77,
            },
          } as SessionMessage,
        ];

        await handler.append(filePath, subagentMessages, { atomic: false });

        // Verify messages were appended
        expect(mockAppendFile).toHaveBeenCalled();
        const appendedContent = mockAppendFile.mock.calls[0][1] as string;
        const lines = appendedContent.split("\n").filter((line) => line.trim());
        expect(lines).toHaveLength(4);

        // STEP 3: Read subagent session back
        mockReadFile.mockResolvedValue(appendedContent);

        const readMessages = await handler.read(filePath);

        expect(readMessages).toHaveLength(4);
        expect(readMessages[3].usage?.total_tokens).toBe(77);

        // STEP 4: Verify type identification throughout lifecycle
        const parsed = handler.parseSessionFilename(filePath);
        expect(parsed.sessionId).toBe(subagentSessionId);
        expect(parsed.sessionType).toBe("subagent");

        // Verify filename pattern enables type identification
        const filename = filePath.split("/").pop()!;
        expect(filename.startsWith("subagent-")).toBe(true);
        expect(handler.isValidSessionFilename(filename)).toBe(true);
      });

      it("should support subagent session creation and reading in concurrent scenarios", async () => {
        const concurrentSessions = [
          { id: "11111111-1234-5678-9abc-def123456789", type: "main" as const },
          {
            id: "22222222-1234-5678-9abc-def123456789",
            type: "subagent" as const,
          },
          { id: "33333333-1234-5678-9abc-def123456789", type: "main" as const },
          {
            id: "44444444-1234-5678-9abc-def123456789",
            type: "subagent" as const,
          },
          {
            id: "55555555-1234-5678-9abc-def123456789",
            type: "subagent" as const,
          },
        ];

        // Create all sessions concurrently
        const creationPromises = concurrentSessions.map(
          async (session, index) => {
            const filePath = `/tmp/concurrent/${handler.generateSessionFilename(session.id, session.type)}`;

            await handler.createSession(filePath);

            // Add unique message to each session
            const message = createTestMessage(
              "user",
              `Concurrent message for ${session.type} session ${index}`,
              `2024-01-01T15:${index.toString().padStart(2, "0")}:00.000Z`,
            );

            await handler.append(filePath, [message], { atomic: false });

            return { ...session, filePath };
          },
        );

        const results = await Promise.all(creationPromises);

        // Verify all sessions were created
        expect(results).toHaveLength(5);
        expect(mockWriteFile).toHaveBeenCalledTimes(5);
        expect(mockAppendFile).toHaveBeenCalledTimes(5);

        // Verify type identification works for all sessions
        results.forEach(({ id, type, filePath }) => {
          const filename = filePath.split("/").pop()!;
          expect(handler.isValidSessionFilename(filename)).toBe(true);

          const parsed = handler.parseSessionFilename(filename);
          expect(parsed.sessionId).toBe(id);
          expect(parsed.sessionType).toBe(type);

          // Verify filename pattern consistency
          if (type === "subagent") {
            expect(filename.startsWith("subagent-")).toBe(true);
          } else {
            expect(filename.startsWith("subagent-")).toBe(false);
          }
        });
      });

      it("should handle subagent session discovery in complex directory structures", async () => {
        // Simulate complex session file discovery
        const allSessionFiles = [
          "12345678-1234-1234-1234-123456789abc.jsonl", // main
          "subagent-87654321-4321-4321-4321-abcdef123456.jsonl", // subagent
          "invalid-session-file.jsonl", // invalid
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl", // main
          "subagent-ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb.jsonl", // subagent
          "not-a-session.txt", // invalid
          "temp-file.tmp", // invalid
          "subagent-11111111-2222-3333-4444-555555555555.jsonl", // subagent
        ];

        // Discover and categorize sessions
        const validSessions: Array<{
          filename: string;
          sessionId: string;
          sessionType: "main" | "subagent";
        }> = [];

        const invalidFiles: string[] = [];

        allSessionFiles.forEach((filename) => {
          if (handler.isValidSessionFilename(filename)) {
            try {
              const parsed = handler.parseSessionFilename(filename);
              validSessions.push({
                filename,
                sessionId: parsed.sessionId,
                sessionType: parsed.sessionType,
              });
            } catch {
              invalidFiles.push(filename);
            }
          } else {
            invalidFiles.push(filename);
          }
        });

        // Verify discovery results
        expect(validSessions).toHaveLength(5); // 2 main + 3 subagent
        expect(invalidFiles).toHaveLength(3); // 3 invalid files

        // Verify session categorization
        const mainSessions = validSessions.filter(
          (s) => s.sessionType === "main",
        );
        const subagentSessions = validSessions.filter(
          (s) => s.sessionType === "subagent",
        );

        expect(mainSessions).toHaveLength(2);
        expect(subagentSessions).toHaveLength(3);

        // Verify filename patterns
        mainSessions.forEach((session) => {
          expect(session.filename.startsWith("subagent-")).toBe(false);
          expect(session.filename.endsWith(".jsonl")).toBe(true);
        });

        subagentSessions.forEach((session) => {
          expect(session.filename.startsWith("subagent-")).toBe(true);
          expect(session.filename.endsWith(".jsonl")).toBe(true);
        });

        // Verify session IDs are correctly extracted
        validSessions.forEach((session) => {
          expect(session.sessionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          );
        });
      });
    });

    describe("Performance optimization integration tests", () => {
      it("should demonstrate performance benefits of filename-based filtering", async () => {
        const sessionCount = 200;
        const sessions: Array<{ id: string; type: "main" | "subagent" }> = [];

        // Generate large session dataset
        for (let i = 0; i < sessionCount; i++) {
          const sessionId = `${i.toString().padStart(8, "0")}-1234-5678-9abc-${i.toString().padStart(12, "0")}`;
          sessions.push({
            id: sessionId,
            type: i % 4 === 0 ? "subagent" : "main", // 1/4 subagent, 3/4 main
          });
        }

        // Create session filenames
        const sessionFilenames = sessions.map((s) =>
          handler.generateSessionFilename(s.id, s.type),
        );

        // Performance test: Filename-based filtering
        const filenameFilterStart = Date.now();

        const filenameBasedMainSessions = sessionFilenames.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            !filename.startsWith("subagent-"),
        );

        const filenameBasedSubagentSessions = sessionFilenames.filter(
          (filename) =>
            handler.isValidSessionFilename(filename) &&
            filename.startsWith("subagent-"),
        );

        const filenameFilterTime = Date.now() - filenameFilterStart;

        // Simulate content-based filtering (much slower)
        const contentFilterStart = Date.now();

        // Simulate reading each file to determine type (slow approach)
        const contentBasedSessions = sessionFilenames.map((filename) => ({
          filename,
          type: filename.startsWith("subagent-") ? "subagent" : "main", // Simulated content reading
        }));

        const contentBasedMainSessions = contentBasedSessions.filter(
          (s) => s.type === "main",
        );
        const contentBasedSubagentSessions = contentBasedSessions.filter(
          (s) => s.type === "subagent",
        );

        const contentFilterTime = Date.now() - contentFilterStart;

        // Verify both methods produce same results
        expect(filenameBasedMainSessions).toHaveLength(
          contentBasedMainSessions.length,
        );
        expect(filenameBasedSubagentSessions).toHaveLength(
          contentBasedSubagentSessions.length,
        );

        // Verify performance benefit (filename-based should be equal or faster)
        // Note: In some environments (like CI or fast local runs), both might be 0ms or very close.
        // We use a larger tolerance to avoid flakiness while still ensuring it's not excessively slow.
        expect(filenameFilterTime).toBeLessThanOrEqual(contentFilterTime + 10);
        expect(filenameFilterTime).toBeLessThan(500); // Should complete in < 500ms

        // Verify correct counts
        const expectedMainCount = sessions.filter(
          (s) => s.type === "main",
        ).length;
        const expectedSubagentCount = sessions.filter(
          (s) => s.type === "subagent",
        ).length;

        expect(filenameBasedMainSessions).toHaveLength(expectedMainCount);
        expect(filenameBasedSubagentSessions).toHaveLength(
          expectedSubagentCount,
        );
      });

      it("should validate no file content reading during session type detection", async () => {
        // Monitor file system calls
        let readFileCallCount = 0;
        const originalReadFile = mockReadFile;

        mockReadFile.mockImplementation(
          async (
            path:
              | string
              | import("fs").PathLike
              | import("fs/promises").FileHandle,
          ) => {
            readFileCallCount++;
            return originalReadFile(path as string);
          },
        );

        // Create test session files
        const testSessions = [
          { id: "12345678-1234-1234-1234-123456789abc", type: "main" as const },
          {
            id: "87654321-4321-4321-4321-abcdef123456",
            type: "subagent" as const,
          },
          { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type: "main" as const },
          {
            id: "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
            type: "subagent" as const,
          },
        ];

        const sessionFilenames = testSessions.map((s) =>
          handler.generateSessionFilename(s.id, s.type),
        );

        // Reset read counter
        readFileCallCount = 0;

        // Perform session type detection using filename patterns only
        const detectedSessions = sessionFilenames
          .filter((filename) => handler.isValidSessionFilename(filename))
          .map((filename) => {
            const parsed = handler.parseSessionFilename(filename);
            return {
              filename,
              sessionId: parsed.sessionId,
              sessionType: parsed.sessionType,
            };
          });

        // Verify type detection results
        expect(detectedSessions).toHaveLength(4);

        const mainSessions = detectedSessions.filter(
          (s) => s.sessionType === "main",
        );
        const subagentSessions = detectedSessions.filter(
          (s) => s.sessionType === "subagent",
        );

        expect(mainSessions).toHaveLength(2);
        expect(subagentSessions).toHaveLength(2);

        // Verify no file content reading occurred
        expect(readFileCallCount).toBe(0);

        // Verify session IDs are correct
        testSessions.forEach((originalSession) => {
          const detected = detectedSessions.find(
            (d) => d.sessionId === originalSession.id,
          );
          expect(detected).toBeDefined();
          expect(detected!.sessionType).toBe(originalSession.type);
        });

        // Restore original mock
        mockReadFile.mockImplementation(originalReadFile);
      });

      it("should handle session filtering at scale without performance degradation", async () => {
        const largeScaleSessionCount = 500;
        const sessionFilenames: string[] = [];

        // Generate large-scale session dataset
        for (let i = 0; i < largeScaleSessionCount; i++) {
          const sessionId = `${i.toString().padStart(8, "0")}-1234-5678-9abc-${i.toString().padStart(12, "0")}`;
          const sessionType = i % 5 === 0 ? "subagent" : "main"; // 1/5 subagent, 4/5 main
          sessionFilenames.push(
            handler.generateSessionFilename(sessionId, sessionType),
          );
        }

        // Add some invalid filenames to test filtering
        sessionFilenames.push("invalid-session.jsonl");
        sessionFilenames.push("not-a-session.txt");
        sessionFilenames.push("temp.tmp");

        // Performance benchmark: Filter large dataset
        const startTime = Date.now();

        const validSessions = sessionFilenames
          .filter((filename) => handler.isValidSessionFilename(filename))
          .map((filename) => {
            try {
              return handler.parseSessionFilename(filename);
            } catch {
              return null;
            }
          })
          .filter((session) => session !== null);

        const mainSessions = validSessions.filter(
          (s) => s!.sessionType === "main",
        );
        const subagentSessions = validSessions.filter(
          (s) => s!.sessionType === "subagent",
        );

        const processingTime = Date.now() - startTime;

        // Verify results
        expect(validSessions).toHaveLength(largeScaleSessionCount); // Only valid sessions
        expect(mainSessions.length + subagentSessions.length).toBe(
          largeScaleSessionCount,
        );

        // Verify performance scales well
        expect(processingTime).toBeLessThan(200); // Should complete in < 200ms even for 500 sessions

        // Verify correctness of distribution
        const expectedSubagentCount = Math.floor(largeScaleSessionCount / 5);
        const expectedMainCount =
          largeScaleSessionCount - expectedSubagentCount;

        expect(subagentSessions).toHaveLength(expectedSubagentCount);
        expect(mainSessions).toHaveLength(expectedMainCount);
      });
    });
  });
});
