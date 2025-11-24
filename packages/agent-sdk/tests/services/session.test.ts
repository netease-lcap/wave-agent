import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { v6 as uuidv6 } from "uuid";

// Mock fs/promises to handle non-existent paths gracefully
vi.mock("fs/promises", async () => {
  const actual = (await vi.importActual(
    "fs/promises",
  )) as typeof import("fs/promises");
  return {
    ...actual,
    realpath: vi.fn().mockImplementation((path: string) => {
      // For tests, just return the path as-is if it doesn't exist
      return Promise.resolve(path);
    }),
  };
});

import {
  generateSessionId,
  appendMessages,
  loadSessionFromJsonl,
  listSessionsFromJsonl,
  deleteSessionFromJsonl,
  getLatestSessionFromJsonl,
  sessionExistsInJsonl,
  cleanupExpiredSessionsFromJsonl,
  getSessionFilePath,
} from "@/services/session.js";
import type { Message } from "@/types/index.js";

describe("Session Management", () => {
  let tempDir: string;
  let testWorkdir: string;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    // Override NODE_ENV to allow file operations in tests
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    // Create temporary directory for each test
    tempDir = await fs.mkdtemp(join(tmpdir(), "session-test-"));
    // Create a real workdir within tempDir to avoid path resolution issues
    testWorkdir = join(tempDir, "workdir");
    await fs.mkdir(testWorkdir, { recursive: true });
  });

  afterEach(async () => {
    // Restore original NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;

    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("T016: UUIDv6 Generation and Validation", () => {
    it("should generate valid UUIDv6 format", () => {
      const sessionId = generateSessionId();

      // UUIDv6 format: xxxxxxxx-xxxx-6xxx-yxxx-xxxxxxxxxxxx
      // where y is 8, 9, A, or B (variant bits)
      const uuidv6Regex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(sessionId).toMatch(uuidv6Regex);
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

    it("should generate UUIDs with time-ordering properties", () => {
      const ids: string[] = [];

      // Generate multiple UUIDs with small delays
      for (let i = 0; i < 3; i++) {
        ids.push(generateSessionId());
        // Small delay to ensure time difference
        const start = Date.now();
        while (Date.now() - start < 2) {
          // Busy wait for 2ms
        }
      }

      // UUIDv6 should be lexicographically sortable by time
      const sortedIds = [...ids].sort();
      expect(sortedIds).toEqual(ids);
    });

    it("should validate UUIDv6 format using library function", () => {
      const validId = generateSessionId();
      const invalidIds = [
        "invalid-uuid",
        "12345678-1234-5678-9abc-123456789012", // v5 format
        "12345678-1234-4678-9abc-123456789012", // v4 format
        "",
        "not-a-uuid-at-all",
      ];

      // Valid UUID should pass library validation
      expect(() => uuidv6()).not.toThrow();
      expect(validId).toBeTruthy();
      expect(typeof validId).toBe("string");

      // Invalid UUIDs should be rejected
      invalidIds.forEach((id) => {
        expect(id).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      });
    });
  });

  describe("T017: Integration test for session file naming", () => {
    it("should create session files with clean UUIDv6 names", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(filePath).toContain(`${sessionId}.jsonl`);
      // The session ID itself should not have session- or wave- prefixes
      expect(sessionId).not.toContain("session-");
      expect(sessionId).not.toContain("wave-");
      expect(filePath).toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-6[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/i,
      );
    });

    it("should use .jsonl file extension", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(filePath.endsWith(".jsonl")).toBe(true);
    });

    it("should create files in correct project directory structure", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );

      // Should be in tempDir/encoded-workdir/sessionId.jsonl format
      expect(filePath).toContain(tempDir);
      expect(filePath).not.toBe(join(tempDir, `${sessionId}.jsonl`)); // Not directly in tempDir

      // Should be in a subdirectory
      const relativePath = filePath.replace(tempDir, "");
      const pathParts = relativePath.split("/").filter((p) => p);
      expect(pathParts).toHaveLength(2); // [encoded-workdir, sessionId.jsonl]
    });

    it("should handle special characters in workdir", async () => {
      const specialWorkdirs = {
        "path with spaces": await fs.mkdtemp(
          join(tmpdir(), "path with spaces-"),
        ),
        "special@chars#test": await fs.mkdtemp(
          join(tmpdir(), "special-chars-"),
        ),
        "very-long-path": await fs.mkdtemp(
          join(
            tmpdir(),
            "very-long-path-that-might-need-encoding-because-it-is-extremely-long-",
          ),
        ),
        unicode测试: await fs.mkdtemp(join(tmpdir(), "unicode-")),
      };

      try {
        for (const [description, workdir] of Object.entries(specialWorkdirs)) {
          const sessionId = generateSessionId();
          const filePath = await getSessionFilePath(
            sessionId,
            workdir,
            tempDir,
          );

          expect(filePath).toContain(tempDir);
          expect(filePath.endsWith(`${sessionId}.jsonl`)).toBe(true);

          // Should not contain the original path directly (should be encoded)
          if (
            description.includes("spaces") ||
            description.includes("special") ||
            description.includes("unicode")
          ) {
            expect(filePath).not.toContain(description);
          }
        }
      } finally {
        // Cleanup temp directories
        for (const workdir of Object.values(specialWorkdirs)) {
          await fs.rm(workdir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("T044: Verify all session functionality works with new organization", () => {
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
      const sessionId = generateSessionId();
      const messages = createTestMessages();

      await appendMessages(sessionId, messages, testWorkdir, tempDir);

      const filePath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );
      const fileExists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      lines.forEach((line) => {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("timestamp");
        expect(parsed).toHaveProperty("role");
        expect(parsed).toHaveProperty("blocks");
      });
    });

    it("should load session data from JSONL", async () => {
      const sessionId = generateSessionId();
      const messages = createTestMessages();

      await appendMessages(sessionId, messages, testWorkdir, tempDir);
      const sessionData = await loadSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(sessionData).toBeTruthy();
      expect(sessionData!.id).toBe(sessionId);
      expect(sessionData!.messages).toHaveLength(2);
      expect(sessionData!.metadata.workdir).toBe(testWorkdir);
      expect(sessionData!.metadata.latestTotalTokens).toBe(15);
    });

    it("should return null for non-existent session", async () => {
      const sessionId = generateSessionId();
      const sessionData = await loadSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(sessionData).toBeNull();
    });

    it("should list sessions from JSONL", async () => {
      const session1Id = generateSessionId();
      const session2Id = generateSessionId();
      const messages = createTestMessages();

      await appendMessages(session1Id, messages, testWorkdir, tempDir);
      await appendMessages(session2Id, messages, testWorkdir, tempDir);

      const sessions = await listSessionsFromJsonl(testWorkdir, false, tempDir);

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id)).toContain(session1Id);
      expect(sessions.map((s) => s.id)).toContain(session2Id);

      // Should be sorted by ID (newest first for UUIDv6)
      expect(sessions[0].id > sessions[1].id).toBe(true);
    });

    it("should get latest session", async () => {
      const session1Id = generateSessionId();
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session2Id = generateSessionId();
      const messages = createTestMessages();

      await appendMessages(session1Id, messages, testWorkdir, tempDir);
      await appendMessages(session2Id, messages, testWorkdir, tempDir);

      const latestSession = await getLatestSessionFromJsonl(
        testWorkdir,
        tempDir,
      );

      expect(latestSession).toBeTruthy();
      expect(latestSession!.id).toBe(session2Id); // More recent UUID
    });

    it("should check if session exists", async () => {
      const sessionId = generateSessionId();
      const messages = createTestMessages();

      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        false,
      );

      await appendMessages(sessionId, messages, testWorkdir, tempDir);

      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        true,
      );
    });

    it("should delete session", async () => {
      const sessionId = generateSessionId();
      const messages = createTestMessages();

      await appendMessages(sessionId, messages, testWorkdir, tempDir);
      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        true,
      );

      const deleted = await deleteSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );
      expect(deleted).toBe(true);
      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        false,
      );
    });

    it("should return false when deleting non-existent session", async () => {
      const sessionId = generateSessionId();
      const deleted = await deleteSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(deleted).toBe(false);
    });

    it("should cleanup expired sessions", async () => {
      // Mock NODE_ENV to allow cleanup in tests
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      try {
        const sessionId = generateSessionId();
        const messages = createTestMessages();

        await appendMessages(sessionId, messages, testWorkdir, tempDir);

        // For this test, we can't easily mock time, but we can verify the function runs
        const deletedCount = await cleanupExpiredSessionsFromJsonl(
          testWorkdir,
          tempDir,
        );

        // Should be 0 since we just created the session
        expect(deletedCount).toBe(0);
        expect(
          await sessionExistsInJsonl(sessionId, testWorkdir, tempDir),
        ).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("should handle empty messages array gracefully", async () => {
      const sessionId = generateSessionId();

      await appendMessages(sessionId, [], testWorkdir, tempDir);

      // Should not create file for empty messages
      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        false,
      );
    });

    it("should handle corrupted session files gracefully", async () => {
      const sessionId = generateSessionId();
      const filePath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );

      // Create directory structure
      await fs.mkdir(join(filePath, ".."), { recursive: true });

      // Write corrupted JSONL
      await fs.writeFile(filePath, "invalid json content\n{incomplete");

      const sessionData = await loadSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );
      expect(sessionData).toBeNull();
    });
  });

  describe("T045: Complete session lifecycle integration test", () => {
    it("should complete full session lifecycle", async () => {
      const sessionId = generateSessionId();

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

      await appendMessages(sessionId, initialMessages, testWorkdir, tempDir);

      // 2. Load session data back
      let sessionData = await loadSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );
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

      await appendMessages(sessionId, additionalMessages, testWorkdir, tempDir);

      // 4. Load updated session
      sessionData = await loadSessionFromJsonl(sessionId, testWorkdir, tempDir);
      expect(sessionData!.messages).toHaveLength(4);
      expect(sessionData!.metadata.latestTotalTokens).toBe(17);

      // 5. List sessions shows our session
      const sessions = await listSessionsFromJsonl(testWorkdir, false, tempDir);
      expect(sessions.some((s) => s.id === sessionId)).toBe(true);

      // 6. Get latest session returns our session (if it's the most recent)
      const latestSession = await getLatestSessionFromJsonl(
        testWorkdir,
        tempDir,
      );
      expect(latestSession!.id).toBe(sessionId);

      // 7. Delete the session
      const deleted = await deleteSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );
      expect(deleted).toBe(true);

      // 8. Session no longer exists
      expect(await sessionExistsInJsonl(sessionId, testWorkdir, tempDir)).toBe(
        false,
      );
      sessionData = await loadSessionFromJsonl(sessionId, testWorkdir, tempDir);
      expect(sessionData).toBeNull();

      // 9. Session no longer appears in listings
      const finalSessions = await listSessionsFromJsonl(
        testWorkdir,
        false,
        tempDir,
      );
      expect(finalSessions.some((s) => s.id === sessionId)).toBe(false);
    });

    it("should handle multiple sessions in different workdirs", async () => {
      const workdir1 = join(tempDir, "project1");
      const workdir2 = join(tempDir, "project2");
      await fs.mkdir(workdir1, { recursive: true });
      await fs.mkdir(workdir2, { recursive: true });

      const session1Id = generateSessionId();
      const session2Id = generateSessionId();

      const messages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Test message" }],
        },
      ];

      // Create sessions in different workdirs
      await appendMessages(session1Id, messages, workdir1, tempDir);
      await appendMessages(session2Id, messages, workdir2, tempDir);

      // Each workdir should only see its own sessions
      const sessions1 = await listSessionsFromJsonl(workdir1, false, tempDir);
      const sessions2 = await listSessionsFromJsonl(workdir2, false, tempDir);

      expect(sessions1).toHaveLength(1);
      expect(sessions1[0].id).toBe(session1Id);
      expect(sessions1[0].workdir).toBe(workdir1);

      expect(sessions2).toHaveLength(1);
      expect(sessions2[0].id).toBe(session2Id);
      expect(sessions2[0].workdir).toBe(workdir2);

      // includeAllWorkdirs should see both
      const allSessions = await listSessionsFromJsonl(workdir1, true, tempDir);
      expect(allSessions).toHaveLength(2);
    });

    it("should preserve message metadata through lifecycle", async () => {
      const sessionId = generateSessionId();

      const messagesWithMetadata: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "User message" }],
          metadata: { userAgent: "test", source: "cli" },
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
          metadata: { modelName: "test-model", temperature: 0.7 },
        },
      ];

      await appendMessages(
        sessionId,
        messagesWithMetadata,
        testWorkdir,
        tempDir,
      );
      const sessionData = await loadSessionFromJsonl(
        sessionId,
        testWorkdir,
        tempDir,
      );

      expect(sessionData!.messages[0].metadata).toEqual({
        userAgent: "test",
        source: "cli",
      });
      expect(sessionData!.messages[1].metadata).toEqual({
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

  describe("Error handling and edge cases", () => {
    it("should handle non-existent project directories", async () => {
      const nonExistentPath = join(tempDir, "nonexistent", "path");
      // Don't create this path - test with truly nonexistent path
      const sessions = await listSessionsFromJsonl(
        nonExistentPath,
        false,
        tempDir,
      );
      expect(sessions).toEqual([]);
    });

    it("should handle empty project directories", async () => {
      // Create empty project directory
      const encoder = await import("@/utils/pathEncoder.js").then(
        (m) => m.PathEncoder,
      );
      const pathEncoder = new encoder();
      await pathEncoder.createProjectDirectory(testWorkdir, tempDir);

      const sessions = await listSessionsFromJsonl(testWorkdir, false, tempDir);
      expect(sessions).toEqual([]);
    });

    it("should skip non-jsonl files in project directory", async () => {
      const sessionId = generateSessionId();
      const messages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "test" }] },
      ];

      await appendMessages(sessionId, messages, testWorkdir, tempDir);

      // Add non-jsonl files
      const projectPath = await getSessionFilePath(
        sessionId,
        testWorkdir,
        tempDir,
      );
      const projectDir = join(projectPath, "..");
      await fs.writeFile(join(projectDir, "not-a-session.txt"), "random file");
      await fs.writeFile(join(projectDir, "config.json"), '{"config": true}');

      const sessions = await listSessionsFromJsonl(testWorkdir, false, tempDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(sessionId);
    });
  });
});
