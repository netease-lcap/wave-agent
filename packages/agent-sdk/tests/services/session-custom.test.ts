import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { saveSession, loadSession } from "../../src/services/session.js";
import path from "path";
import { readdir, stat } from "fs/promises";

// Mock fs operations - import as the module structure expected
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
  },
}));

// Mock os module
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
}));

describe("Session service custom directory tests", () => {
  let mockTempDir: string;
  let customSessionDir: string;

  beforeEach(async () => {
    // Set up mock directory paths
    mockTempDir = "/mock/tmp/wave-session-service-test-123";
    customSessionDir = path.join(mockTempDir, "custom-sessions");
    
    // Clear all mocks
    vi.clearAllMocks();
    
    // Setup fs mock implementations using imported module
    const { promises: fsPromises } = await import("fs");
    vi.mocked(fsPromises.mkdtemp).mockResolvedValue(mockTempDir);
    vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue('[]');
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

    // Mock NODE_ENV to not be 'test' so saveSession actually works
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

      // Verify session file would be written to custom directory
      const { promises: fsPromises } = await import("fs");
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
      const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
      const sessionPath = writeCall[0] as string;
      expect(sessionPath).toContain(customSessionDir);
      expect(sessionPath).toMatch(/session_.*\.json$/);
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

      // Mock readFile to return the session data for loading
      const sessionData = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        version: "1.0",
        messages,
        metadata: {
          workdir: process.cwd(),
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 10,
        },
      };
      const { promises: fsPromises } = await import("fs");
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify(sessionData));
      
      // Mock readdir to return the session file
      const sessionFileName = `session_${sessionId.slice(-8)}.json`;
      vi.mocked(fsPromises.readdir).mockResolvedValueOnce([sessionFileName] as unknown as Awaited<ReturnType<typeof readdir>>);
      
      // Save session first (this will be mocked)
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
      // Mock readdir to return empty array (no sessions)
      const { promises: fsPromises } = await import("fs");
      // Mock readFile to throw ENOENT error to simulate file not found
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce({ code: "ENOENT" });
      
      const result = await loadSession(
        "non-existent-session",
        customSessionDir,
      );
      expect(result).toBeNull();
    });
  });
});
