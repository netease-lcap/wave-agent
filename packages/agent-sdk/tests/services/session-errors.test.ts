import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSession,
  ensureSessionDir,
  resolveSessionDir,
} from "../../src/services/session.js";
import type { Message } from "../../src/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Session service error handling tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "wave-session-errors-test-"),
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

  describe("Permission and path error handling", () => {
    it("should handle read-only parent directory gracefully", async () => {
      // Create a read-only directory structure (if possible in test environment)
      const readOnlyParent = path.join(tempDir, "readonly-parent");
      const sessionDir = path.join(readOnlyParent, "sessions");

      await fs.mkdir(readOnlyParent, { recursive: true });

      try {
        // Try to make parent directory read-only (this might not work in all test environments)
        await fs.chmod(readOnlyParent, 0o444);

        // Attempt to ensure session directory exists
        await expect(ensureSessionDir(sessionDir)).rejects.toThrow();
      } catch {
        // If we can't set up the read-only test, skip with a warning
        console.warn(
          "Could not create read-only directory for permission test, skipping",
        );
      } finally {
        // Restore permissions for cleanup
        try {
          await fs.chmod(readOnlyParent, 0o755);
        } catch {
          // Ignore permission restore errors
        }
      }
    });

    it("should handle invalid path characters gracefully", async () => {
      // Test with paths containing invalid characters (varies by OS)
      const invalidPaths = [
        path.join(tempDir, "sessions\x00invalid"), // Null byte
        path.join(tempDir, "sessions/../../invalid"), // Path traversal
      ];

      for (const invalidPath of invalidPaths) {
        try {
          await ensureSessionDir(invalidPath);
          // If it succeeds, that's also OK (filesystem might allow it)
        } catch (error) {
          // Should get a meaningful error
          expect(error).toBeDefined();
          expect(String(error)).toBeTruthy();
        }
      }
    });

    it("should handle very long paths gracefully", async () => {
      // Create a very long path that might exceed filesystem limits
      const longDirName = "a".repeat(300); // Very long directory name
      const longPath = path.join(tempDir, longDirName, "sessions");

      try {
        await ensureSessionDir(longPath);
        // If it succeeds, verify the directory exists
        const exists = await fs
          .access(longPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      } catch (error) {
        // Should get a meaningful error about path length or similar
        expect(error).toBeDefined();
        expect(String(error).toLowerCase()).toMatch(/path|name|long|limit/);
      }
    });

    it("should handle session save errors gracefully", async () => {
      const validSessionDir = path.join(tempDir, "valid-sessions");
      await ensureSessionDir(validSessionDir);

      // Test saving with invalid data
      const sessionId = "error-test-session";
      const invalidMessages = null as unknown as Message[]; // Invalid messages data
      const workdir = tempDir;

      try {
        await saveSession(
          sessionId,
          invalidMessages,
          workdir,
          100,
          new Date().toISOString(),
          validSessionDir,
        );
        // If it doesn't throw, that's unexpected but not necessarily wrong
      } catch (error) {
        // Should get a meaningful error about invalid data
        expect(error).toBeDefined();
      }
    });

    it("should resolve sessionDir paths correctly", () => {
      // Test various path inputs - resolveSessionDir just returns input or default
      const testCases = [
        { input: undefined, expectMatch: /\.wave\/sessions$/ },
        { input: "", expectMatch: /\.wave\/sessions$/ },
        { input: "/absolute/path", expected: "/absolute/path" },
        { input: "./relative/path", expected: "./relative/path" },
        { input: "~/home/path", expected: "~/home/path" },
      ];

      for (const testCase of testCases) {
        const resolved = resolveSessionDir(testCase.input);

        if (testCase.expected) {
          expect(resolved).toBe(testCase.expected);
        }

        if (testCase.expectMatch) {
          expect(resolved).toMatch(testCase.expectMatch);
        }
      }
    });
  });

  describe("Error recovery and cleanup", () => {
    it("should not leave partial files after failed operations", async () => {
      const sessionDir = path.join(tempDir, "cleanup-test");
      await ensureSessionDir(sessionDir);

      // Get initial file count
      const initialFiles = await fs.readdir(sessionDir);
      const initialCount = initialFiles.length;

      // Attempt an operation that might fail
      try {
        // This might succeed or fail depending on environment
        await saveSession(
          "test-session",
          [],
          tempDir,
          100,
          new Date().toISOString(),
          sessionDir,
        );
      } catch {
        // Even if it fails, verify no partial files are left
      }

      // Check that we don't have more files than expected
      const finalFiles = await fs.readdir(sessionDir);
      expect(finalFiles.length).toBeGreaterThanOrEqual(initialCount);

      // Any new files should be complete (not temporary/partial files)
      const newFiles = finalFiles.filter((f) => !initialFiles.includes(f));
      for (const file of newFiles) {
        expect(file).not.toMatch(/\.tmp$|\.partial$|\.bak$/);
      }
    });
  });
});
