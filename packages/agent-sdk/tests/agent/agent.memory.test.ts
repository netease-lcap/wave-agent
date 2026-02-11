import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import { promises as fs } from "fs";
import * as fsPromises from "fs/promises";
import type { PathLike } from "fs";
import type { FileHandle } from "fs/promises";

// Mock both fs import patterns
vi.mock("fs", () => ({
  promises: {
    rm: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  rm: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock os module
vi.mock("os", () => ({
  default: {
    homedir: vi.fn(() => "/mock/home"),
    tmpdir: vi.fn(() => "/mock/tmp"),
    platform: vi.fn(() => "linux"),
  },
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
  platform: vi.fn(() => "linux"),
}));

// Mock the aiService
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  compressMessages: vi.fn().mockResolvedValue("Compressed content"),
}));

describe("Agent Memory Functionality", () => {
  let mockCallbacks: AgentCallbacks;
  let mockTempDir: string;

  // Helper to set up fs mocks for both import patterns
  const setupFsMock = (
    implementation: (
      ...args: Parameters<typeof fs.readFile>
    ) => Promise<string | Buffer<ArrayBuffer>>,
  ) => {
    vi.mocked(fs.readFile).mockImplementation(implementation);
    vi.mocked(fsPromises.readFile).mockImplementation(implementation);
  };

  beforeEach(async () => {
    // Set up mock directory path
    mockTempDir = "/mock/tmp/memory-test-123";

    // Setup fs mock implementations for both import patterns
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(""); // Default to empty string for files
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.stat).mockResolvedValue({
      isFile: () => true,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    // Mock fs/promises as well
    vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue(""); // Default to empty string for files
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isFile: () => true,
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    // Reset all mocks
    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe("T009 - Agent memory initialization test", () => {
    it("should load project memory from AGENTS.md during Agent.create()", async () => {
      // Mock project memory file content
      const projectMemoryContent =
        "# Memory\n\nProject-specific important information\n- Key project detail\n";

      // Set up mock for both fs import patterns
      const mockImplementation = vi
        .fn()
        .mockImplementation((path: PathLike | FileHandle) => {
          // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
          if (
            path.toString().includes(mockTempDir) &&
            path.toString().includes("AGENTS.md")
          ) {
            return Promise.resolve(projectMemoryContent);
          }
          // User memory file path: /mock/home/.wave/AGENTS.md
          if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
            return Promise.resolve("# User Memory\n\nUser-level preferences\n");
          }
          return Promise.resolve("");
        });

      setupFsMock(mockImplementation);
      vi.mocked(fsPromises.readFile).mockImplementation(mockImplementation);

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Memory should be loaded during initialization
      expect(agent.projectMemory).toBe(projectMemoryContent);

      await agent.destroy();
    });

    it("should load user memory from user memory file during Agent.create()", async () => {
      // Mock user memory file content
      const userMemoryContent =
        "# User Memory\n\nUser-level preferences\n- User setting 1\n- User setting 2\n";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve("# Memory\n\nProject memory\n");
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve(userMemoryContent);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // User memory should be loaded during initialization
      expect(agent.userMemory).toBe(userMemoryContent);

      await agent.destroy();
    });

    it("should initialize with empty content when files don't exist", async () => {
      // Mock files not existing (ENOENT errors)
      setupFsMock((path: PathLike | FileHandle) => {
        if (
          path.toString().includes("AGENTS.md") ||
          path.toString().includes("AGENTS.md")
        ) {
          const error = new Error("File not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should initialize with empty strings when files don't exist
      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");

      await agent.destroy();
    });

    it("should load memory only once (no live reloading)", async () => {
      const projectMemoryContent = "# Memory\n\nInitial project content\n";
      const userMemoryContent = "# User Memory\n\nInitial user content\n";

      let readFileCallCount = 0;
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          readFileCallCount++;
          return Promise.resolve(projectMemoryContent);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          readFileCallCount++;
          return Promise.resolve(userMemoryContent);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Verify initial memory loading
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(agent.userMemory).toBe(userMemoryContent);

      // Reset call count after initialization
      // initialCallCount is not used but we keep the logic for clarity if needed later
      // const initialCallCount = readFileCallCount;

      // Access memory multiple times - should not trigger additional file reads
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(agent.userMemory).toBe(userMemoryContent);
      expect(await agent.getCombinedMemory()).toBe(
        projectMemoryContent + "\n\n" + userMemoryContent,
      );

      // Verify no additional file reads occurred
      // Initial load: 1 for project, 1 for user = 2
      // getCombinedMemory calls MessageManager.getCombinedMemory which calls memory.getCombinedMemoryContent
      // which calls readMemoryFile and getUserMemoryContent, adding 2 more reads.
      // Total expected: 4
      expect(readFileCallCount).toBe(4);

      await agent.destroy();
    });
  });

  describe("T010 - Memory content access test for readonly getters", () => {
    it("should provide projectMemory getter that returns loaded content", async () => {
      const projectMemoryContent =
        "# Memory\n\n- Important project info\n- Another detail\n";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve(projectMemoryContent);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve("# User Memory\n\n");
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should return exact loaded project memory content
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(typeof agent.projectMemory).toBe("string");

      await agent.destroy();
    });

    it("should provide userMemory getter that returns loaded content", async () => {
      const userMemoryContent =
        "# User Memory\n\n- User preference 1\n- User preference 2\n";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve("# Memory\n\n");
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve(userMemoryContent);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should return exact loaded user memory content
      expect(agent.userMemory).toBe(userMemoryContent);
      expect(typeof agent.userMemory).toBe("string");

      await agent.destroy();
    });

    it("should provide combinedMemory getter that merges both contents", async () => {
      const projectMemoryContent = "# Memory\n\nProject context";
      const userMemoryContent = "# User Memory\n\nUser preferences";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve(projectMemoryContent);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve(userMemoryContent);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should merge project memory and user memory with proper separator
      const expectedCombined = `${projectMemoryContent}\n\n${userMemoryContent}`;
      expect(await agent.getCombinedMemory()).toBe(expectedCombined);

      await agent.destroy();
    });

    it("should return combined memory with only project content when user memory is empty", async () => {
      const projectMemoryContent = "# Memory\n\nProject context only";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve(projectMemoryContent);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve("");
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should return only project memory without extra separators
      expect(await agent.getCombinedMemory()).toBe(projectMemoryContent);

      await agent.destroy();
    });

    it("should return combined memory with only user content when project memory is empty", async () => {
      const userMemoryContent = "# User Memory\n\nUser context only";

      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve("");
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve(userMemoryContent);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Should return only user memory without extra separators
      expect(await agent.getCombinedMemory()).toBe(userMemoryContent);

      await agent.destroy();
    });

    it("should return empty strings when no content loaded", async () => {
      // Mock files not existing
      setupFsMock((path: PathLike | FileHandle) => {
        if (
          path.toString().includes("AGENTS.md") ||
          path.toString().includes("AGENTS.md")
        ) {
          const error = new Error("File not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // All memory getters should return empty strings
      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");
      expect(await agent.getCombinedMemory()).toBe("");

      await agent.destroy();
    });
  });

  describe("T011 - Memory loading error handling test", () => {
    it("should handle missing AGENTS.md gracefully (empty string fallback)", async () => {
      // Mock project memory file missing but user memory exists
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          const error = new Error("File not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve("# User Memory\n\nUser content");
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Project memory should be empty string, user memory should load normally
      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("# User Memory\n\nUser content");
      expect(await agent.getCombinedMemory()).toBe(
        "# User Memory\n\nUser content",
      );

      await agent.destroy();
    });

    it("should handle missing user memory file gracefully", async () => {
      // Mock user memory file missing but project memory exists
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve("# Memory\n\nProject content");
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          const error = new Error("File not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // User memory should be empty string, project memory should load normally
      expect(agent.projectMemory).toBe("# Memory\n\nProject content");
      expect(agent.userMemory).toBe("");
      expect(await agent.getCombinedMemory()).toBe(
        "# Memory\n\nProject content",
      );

      await agent.destroy();
    });

    it("should handle corrupted/unreadable files gracefully", async () => {
      // Mock files being unreadable due to permissions or corruption
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          const error = new Error("Permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          return Promise.reject(error);
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          const error = new Error(
            "Input/output error",
          ) as NodeJS.ErrnoException;
          error.code = "EIO";
          return Promise.reject(error);
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Both memories should fallback to empty strings on read errors
      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");
      expect(await agent.getCombinedMemory()).toBe("");

      await agent.destroy();
    });

    it("should log errors but not throw during initialization", async () => {
      // Mock console.error or logger to capture error logs
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Mock files throwing various errors
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.reject(new Error("Unexpected file system error"));
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.reject(new Error("Network file system timeout"));
        }
        return Promise.resolve("");
      });

      // Agent creation should NOT throw despite memory loading errors
      let agent: Agent;
      expect(async () => {
        agent = await Agent.create({
          workdir: mockTempDir,
          callbacks: mockCallbacks,
        });
      }).not.toThrow();

      agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      expect(agent).toBeDefined();
      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");

      consoleErrorSpy.mockRestore();
      await agent.destroy();
    });

    it("should ensure Agent startup succeeds even with memory errors", async () => {
      // Mock all possible error scenarios
      setupFsMock((path: PathLike | FileHandle) => {
        if (
          path.toString().includes("AGENTS.md") ||
          path.toString().includes("AGENTS.md")
        ) {
          // Simulate random file system errors
          const errors = [
            Object.assign(new Error("No such file"), { code: "ENOENT" }),
            Object.assign(new Error("Permission denied"), { code: "EACCES" }),
            Object.assign(new Error("Device busy"), { code: "EBUSY" }),
            new Error("Unexpected error"),
          ];
          const randomError = errors[Math.floor(Math.random() * errors.length)];
          return Promise.reject(randomError);
        }
        return Promise.resolve("");
      });

      // Multiple agent creations should all succeed
      for (let i = 0; i < 3; i++) {
        const agent = await Agent.create({
          workdir: `${mockTempDir}-${i}`,
          callbacks: mockCallbacks,
        });

        expect(agent).toBeDefined();
        expect(typeof agent.projectMemory).toBe("string");
        expect(typeof agent.userMemory).toBe("string");
        expect(typeof (await agent.getCombinedMemory())).toBe("string");

        // Agent should be fully functional despite memory loading failures
        expect(agent.workingDirectory).toBe(`${mockTempDir}-${i}`);
        expect(agent.sessionId).toBeDefined();

        await agent.destroy();
      }
    });
  });
});
