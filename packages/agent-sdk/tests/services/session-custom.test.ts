import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { saveSession, loadSession } from "../../src/services/session.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Session service custom directory tests", () => {
  let tempDir: string;
  let customSessionDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "wave-session-service-test-"),
    );
    customSessionDir = path.join(tempDir, "custom-sessions");

    // Mock NODE_ENV to not be 'test' so saveSession actually works
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("saveSession with custom directory", () => {
    it("should save session to custom directory", async () => {
      const sessionId = "test-session-123";
      const messages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Hello" }],
        },
      ];

      await saveSession(
        sessionId,
        messages,
        process.cwd(),
        0,
        undefined,
        customSessionDir,
      );

      // Verify session file exists in custom directory
      const sessionPath = path.join(
        customSessionDir,
        `session_${sessionId.slice(-8)}.json`,
      );
      const fileExists = await fs
        .access(sessionPath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe("loadSession with custom directory", () => {
    it("should load session from custom directory", async () => {
      const sessionId = "test-session-456";
      const messages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Test message" }],
        },
      ];

      // Save session first
      await saveSession(
        sessionId,
        messages,
        process.cwd(),
        10,
        undefined,
        customSessionDir,
      );

      // Load session from custom directory
      const loadedSession = await loadSession(sessionId, customSessionDir);

      expect(loadedSession).toBeDefined();
      expect(loadedSession?.id).toBe(sessionId);
      expect(loadedSession?.messages).toHaveLength(1);
      const firstBlock = loadedSession?.messages[0].blocks[0];
      expect(firstBlock?.type).toBe("text");
      if (firstBlock?.type === "text") {
        expect(firstBlock.content).toBe("Test message");
      }
    });

    it("should return null for non-existent session", async () => {
      const result = await loadSession(
        "non-existent-session",
        customSessionDir,
      );
      expect(result).toBeNull();
    });
  });
});
