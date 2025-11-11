import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveSessionDir,
  saveSession,
  loadSession,
  listSessions,
} from "../../src/services/session.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Session service default behavior tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "wave-session-default-test-"),
    );

    // Mock NODE_ENV to not be 'test' so session operations actually work
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Default sessionDir resolution", () => {
    it("should resolve to default ~/.wave/sessions path when no sessionDir provided", () => {
      const defaultSessionDir = resolveSessionDir();

      expect(defaultSessionDir).toBeDefined();
      expect(defaultSessionDir).toMatch(/\.wave\/sessions$/);
      expect(path.isAbsolute(defaultSessionDir)).toBe(true);
    });

    it("should use provided sessionDir when specified", () => {
      const customDir = path.join(tempDir, "custom");
      const resolvedDir = resolveSessionDir(customDir);

      expect(resolvedDir).toBe(customDir);
    });
  });

  describe("Backward compatibility with session operations", () => {
    it("should save and load sessions using default directory when no sessionDir specified", async () => {
      // Use our temp directory as the "default" for this test by passing it explicitly
      const sessionId = "test-session-default";
      const testMessages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "test" }],
        },
      ];
      const workdir = tempDir;

      // Save session without specifying sessionDir (should use default behavior)
      await saveSession(
        sessionId,
        testMessages,
        workdir,
        100,
        new Date().toISOString(),
        tempDir,
      );

      // Load session without specifying sessionDir (should use default behavior)
      const loadedSession = await loadSession(sessionId, tempDir);

      expect(loadedSession).toBeDefined();
      expect(loadedSession?.messages).toEqual(testMessages);
      expect(loadedSession?.metadata.workdir).toBe(workdir);
      expect(loadedSession?.metadata.latestTotalTokens).toBe(100);
    });

    it("should list sessions using default directory when no sessionDir specified", async () => {
      // Create some test sessions in our temp directory
      const sessionIds = ["session1", "session2", "session3"];
      const testMessages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "test" }],
        },
      ];
      const workdir = tempDir;

      for (const sessionId of sessionIds) {
        await saveSession(
          sessionId,
          testMessages,
          workdir,
          100,
          new Date().toISOString(),
          tempDir,
        );
      }

      // List sessions without specifying sessionDir (should use default behavior)
      const sessions = await listSessions(workdir, false, tempDir);

      expect(sessions).toBeDefined();
      expect(sessions.length).toBe(3);
      expect(sessions.map((s) => s.id).sort()).toEqual(sessionIds.sort());
    });
  });

  describe("Mixed usage patterns", () => {
    it("should handle both default and custom sessionDir in same application", async () => {
      const customSessionDir = path.join(tempDir, "custom-sessions");
      const sessionId = "mixed-test-session";
      const testMessages = [
        {
          role: "user" as const,
          blocks: [
            { type: "text" as const, content: "mixed test user message" },
          ],
        },
        {
          role: "assistant" as const,
          blocks: [
            { type: "text" as const, content: "mixed test assistant response" },
          ],
        },
      ];
      const workdir = tempDir;

      // Save to custom directory
      await saveSession(
        sessionId,
        testMessages,
        workdir,
        100,
        new Date().toISOString(),
        customSessionDir,
      );

      // Load from custom directory
      const customSession = await loadSession(sessionId, customSessionDir);
      expect(customSession).toBeDefined();

      // Try to load from default directory (using tempDir as default) - should not find it
      const defaultSession = await loadSession(sessionId, tempDir);
      expect(defaultSession).toBeNull(); // Should not find it in default location

      // Verify the session is only in the custom directory
      const customFiles = await fs.readdir(customSessionDir);
      const defaultFiles = await fs.readdir(tempDir);

      // The session file uses a shortened version of the session ID
      const sessionFileExists = customFiles.some(
        (f) => f.startsWith("session_") && f.endsWith(".json"),
      );
      expect(sessionFileExists).toBe(true);
      expect(
        defaultFiles.some(
          (f) => f.startsWith("session_") && f.endsWith(".json"),
        ),
      ).toBe(false);
    });
  });
});
