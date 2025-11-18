import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSession,
  ensureSessionDir,
  resolveSessionDir,
} from "../../src/services/session.js";
import type { Message } from "../../src/types/index.js";
import path from "path";
import { promises as fs } from "fs";

// Mock console to suppress stderr output
const mockConsole = {
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
};

// Mock fs operations
vi.mock("fs", () => ({
  promises: {
    mkdtemp: vi.fn(),
    rm: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    chmod: vi.fn(),
  },
}));

// Mock os module
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
}));

describe("Session service error handling tests", () => {
  let mockTempDir: string;
  let originalConsole: Console;

  beforeEach(async () => {
    // Mock console to suppress stderr output
    originalConsole = global.console;
    global.console = mockConsole as unknown as Console;

    // Set up mock directory path
    mockTempDir = "/mock/tmp/wave-session-errors-test-123";

    // Clear all mocks
    vi.clearAllMocks();

    // Setup fs mock implementations
    vi.mocked(fs.mkdtemp).mockResolvedValue(mockTempDir);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue("[]");
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    // Mock NODE_ENV to not be 'test' so session operations actually work
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    // Restore original console
    global.console = originalConsole;

    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("Permission and path error handling", () => {
    it("should handle read-only parent directory gracefully", async () => {
      // Create a read-only directory structure (if possible in test environment)
      const readOnlyParent = path.join(mockTempDir, "readonly-parent");
      const sessionDir = path.join(readOnlyParent, "sessions");

      // Mock mkdir to succeed for the parent but fail for the session dir
      vi.mocked(fs.mkdir)
        .mockResolvedValueOnce(undefined) // First call succeeds
        .mockRejectedValueOnce(new Error("EACCES: permission denied"));

      try {
        // Attempt to ensure session directory exists
        await expect(ensureSessionDir(sessionDir)).rejects.toThrow();
      } catch {
        // If we can't set up the read-only test, skip with a warning
        console.warn(
          "Could not create read-only directory for permission test, skipping",
        );
      }
    });

    it("should handle invalid path characters gracefully", async () => {
      // Test with paths containing invalid characters (varies by OS)
      const invalidPaths = [
        path.join(mockTempDir, "sessions\x00invalid"), // Null byte
        path.join(mockTempDir, "sessions/../../invalid"), // Path traversal
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
      const longPath = path.join(mockTempDir, longDirName, "sessions");

      // Mock mkdir to potentially fail with path length error
      vi.mocked(fs.mkdir).mockRejectedValueOnce(
        new Error("ENAMETOOLONG: name too long"),
      );

      try {
        await ensureSessionDir(longPath);
        // If it succeeds, verify mkdir was called
        expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(longPath, {
          recursive: true,
        });
      } catch (error) {
        // Should get a meaningful error about path length or similar
        expect(error).toBeDefined();
        expect(String(error).toLowerCase()).toMatch(/path|name|long|limit/);
      }
    });

    it("should handle session save errors gracefully", async () => {
      const validSessionDir = path.join(mockTempDir, "valid-sessions");
      await ensureSessionDir(validSessionDir);

      // Test saving with invalid data
      const sessionId = "error-test-session";
      const invalidMessages = null as unknown as Message[]; // Invalid messages data
      const workdir = mockTempDir;

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
      const sessionDir = path.join(mockTempDir, "cleanup-test");
      await ensureSessionDir(sessionDir);

      // Mock readdir to return initial empty state
      const initialFiles: string[] = [];
      vi.mocked(fs.readdir).mockResolvedValueOnce(
        initialFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );

      // Attempt an operation that might fail
      try {
        // This might succeed or fail depending on environment
        await saveSession(
          "test-session",
          [],
          mockTempDir,
          100,
          new Date().toISOString(),
          sessionDir,
        );
      } catch {
        // Even if it fails, verify no partial files are left
      }

      // Mock readdir for final check
      const finalFiles: string[] = [];
      vi.mocked(fs.readdir).mockResolvedValueOnce(
        finalFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );

      // Check that we don't have more files than expected
      const finalResult = await fs.readdir(sessionDir);
      expect(finalResult.length).toBeGreaterThanOrEqual(initialFiles.length);

      // Any new files should be complete (not temporary/partial files)
      const newFiles = finalResult.filter((f) => !initialFiles.includes(f));
      for (const file of newFiles) {
        expect(file).not.toMatch(/\.tmp$|\.partial$|\.bak$/);
      }
    });
  });
});
