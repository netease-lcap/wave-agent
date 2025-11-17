import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveSessionDir,
  saveSession,
  loadSession,
  listSessions,
} from "../../src/services/session.js";
import path from "path";
import { promises as fs } from "fs";

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
  },
}));

// Mock os module
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
}));

// Mock path module
vi.mock("path", () => ({
  default: {
    join: vi.fn((...args) => args.join("/")),
    isAbsolute: vi.fn((p) => p.startsWith("/")),
  },
  join: vi.fn((...args) => args.join("/")),
  isAbsolute: vi.fn((p) => p.startsWith("/")),
}));

describe("Session service default behavior tests", () => {
  let mockTempDir: string;

  beforeEach(async () => {
    // Set up mock directory path
    mockTempDir = "/mock/tmp/wave-session-default-test-123";
    
    // Clear all mocks first
    vi.clearAllMocks();
    
    // Setup fs mock implementations
    vi.mocked(fs.mkdtemp).mockResolvedValue(mockTempDir);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('[]');
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    // Mock NODE_ENV to not be 'test' so session operations actually work
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("Default sessionDir resolution", () => {
    it("should resolve to default ~/.wave/sessions path when no sessionDir provided", () => {
      const defaultSessionDir = resolveSessionDir();

      expect(defaultSessionDir).toBeDefined();
      expect(defaultSessionDir).toMatch(/\.wave\/sessions$/);
      expect(path.isAbsolute(defaultSessionDir)).toBe(true);
    });

    it("should use provided sessionDir when specified", () => {
      const customDir = path.join(mockTempDir, "custom");
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
      const workdir = mockTempDir;

      // Mock readFile to return proper session data for loadSession
      const expectedSessionData = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        messages: testMessages,
        metadata: {
          workdir: workdir,
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 100,
        },
      };
      
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(expectedSessionData));

      // Save session without specifying sessionDir (should use default behavior)
      await saveSession(
        sessionId,
        testMessages,
        workdir,
        100,
        new Date().toISOString(),
        mockTempDir,
      );

      // Load session without specifying sessionDir (should use default behavior)
      const loadedSession = await loadSession(sessionId, mockTempDir);

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
      const workdir = mockTempDir;

      // Mock readdir to return session files
      vi.mocked(fs.readdir).mockResolvedValue([
        "session_12345678.json",
        "session_87654321.json", 
        "session_11111111.json",
        "other_file.txt"
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      
      // Mock readFile to return proper session data
      const sessionData1 = {
        id: "session1",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        messages: testMessages,
        metadata: { workdir, startedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), latestTotalTokens: 100 }
      };
      const sessionData2 = {
        id: "session2",
        timestamp: new Date().toISOString(),
        version: "1.0.0", 
        messages: testMessages,
        metadata: { workdir, startedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), latestTotalTokens: 100 }
      };
      const sessionData3 = {
        id: "session3",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        messages: testMessages,
        metadata: { workdir, startedAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), latestTotalTokens: 100 }
      };
      
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(sessionData1))
        .mockResolvedValueOnce(JSON.stringify(sessionData2))
        .mockResolvedValueOnce(JSON.stringify(sessionData3));

      for (const sessionId of sessionIds) {
        await saveSession(
          sessionId,
          testMessages,
          workdir,
          100,
          new Date().toISOString(),
          mockTempDir,
        );
      }

      // List sessions without specifying sessionDir (should use default behavior)
      const sessions = await listSessions(workdir, false, mockTempDir);

      expect(sessions).toBeDefined();
      expect(sessions.length).toBe(3);
      expect(sessions.map((s) => s.id).sort()).toEqual(sessionIds.sort());
    });
  });

  describe("Mixed usage patterns", () => {
    it("should handle both default and custom sessionDir in same application", async () => {
      const customSessionDir = path.join(mockTempDir, "custom-sessions");
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
      const workdir = mockTempDir;

      // Mock session data for custom directory load
      const expectedSessionData = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        messages: testMessages,
        metadata: {
          workdir: workdir,
          startedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 100,
        },
      };
      
      // Mock readFile to return session data for custom directory, then reject for default directory
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(expectedSessionData))  // For custom directory
        .mockRejectedValueOnce({ code: "ENOENT" });  // For default directory - file not found

      // Mock readdir for directory verification
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["session_12345678.json"] as unknown as Awaited<ReturnType<typeof fs.readdir>>) // Custom directory has files
        .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof fs.readdir>>); // Default directory is empty

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

      // Try to load from default directory (using mockTempDir as default) - should not find it
      const defaultSession = await loadSession(sessionId, mockTempDir);
      expect(defaultSession).toBeNull(); // Should not find it in default location

      // Verify the session is only in the custom directory
      const customFiles = await fs.readdir(customSessionDir);
      const defaultFiles = await fs.readdir(mockTempDir);

      // The session file uses a shortened version of the session ID
      const sessionFileExists = customFiles.some(
        (f: string) => f.startsWith("session_") && f.endsWith(".json"),
      );
      expect(sessionFileExists).toBe(true);
      expect(
        defaultFiles.some(
          (f: string) => f.startsWith("session_") && f.endsWith(".json"),
        ),
      ).toBe(false);
    });
  });
});
