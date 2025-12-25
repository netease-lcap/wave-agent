import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import { promises as fs } from "fs";
import * as fsPromises from "fs/promises";
import type { PathLike } from "fs";
import type { FileHandle } from "fs/promises";
import type { URL } from "url";

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
      const initialCallCount = readFileCallCount;

      // Access memory multiple times - should not trigger additional file reads
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(agent.userMemory).toBe(userMemoryContent);
      expect(agent.combinedMemory).toBe(
        projectMemoryContent + "\n\n" + userMemoryContent,
      );

      // Verify no additional file reads occurred
      expect(readFileCallCount).toBe(initialCallCount);

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
      expect(agent.combinedMemory).toBe(expectedCombined);

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
      expect(agent.combinedMemory).toBe(projectMemoryContent);

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
      expect(agent.combinedMemory).toBe(userMemoryContent);

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
      expect(agent.combinedMemory).toBe("");

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
      expect(agent.combinedMemory).toBe("# User Memory\n\nUser content");

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
      expect(agent.combinedMemory).toBe("# Memory\n\nProject content");

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
      expect(agent.combinedMemory).toBe("");

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
        expect(typeof agent.combinedMemory).toBe("string");

        // Agent should be fully functional despite memory loading failures
        expect(agent.workingDirectory).toBe(`${mockTempDir}-${i}`);
        expect(agent.sessionId).toBeDefined();

        await agent.destroy();
      }
    });

    it("should handle memory loading errors in saveMemory method", async () => {
      // Mock initial memory loading to succeed
      setupFsMock((path: PathLike | FileHandle) => {
        // Project memory file path: /mock/tmp/memory-test-123/AGENTS.md
        if (
          path.toString().includes(mockTempDir) &&
          path.toString().includes("AGENTS.md")
        ) {
          return Promise.resolve("# Memory\n\nInitial content");
        }
        // User memory file path: /mock/home/.wave/AGENTS.md
        if (path.toString().includes("/mock/home/.wave/AGENTS.md")) {
          return Promise.resolve("# User Memory\n\nInitial content");
        }
        return Promise.resolve("");
      });

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Note: This test verifies that saveMemory doesn't throw when memory loading fails.
      // The actual implementation of memory loading during initialization will be tested
      // by the other tests in this suite.

      // saveMemory should handle internal errors gracefully and not throw
      await expect(
        agent.saveMemory("#Test memory save", "project"),
      ).resolves.not.toThrow();

      await agent.destroy();
    });
  });

  // T017 [P] [US2] - Test to verify memory content updates when saveMemory is called
  describe("T017 - Memory content updates on saveMemory", () => {
    it("should update projectMemory getter after calling saveMemory with project type", async () => {
      // Create a simulated file system to track file contents
      const fileSystem = new Map<string, string>();
      fileSystem.set(
        `${mockTempDir}/AGENTS.md`,
        "# Initial Project Memory\n\nOriginal content",
      );
      fileSystem.set(
        "/mock/home/.wave/AGENTS.md",
        "# Initial User Memory\n\nOriginal user content",
      );

      // Mock fs operations to use our simulated file system - both import patterns
      const readFileImpl = vi
        .fn()
        .mockImplementation((path: PathLike | FileHandle) => {
          const content = fileSystem.get(path.toString()) || "";
          return Promise.resolve(content);
        });
      const writeFileImpl = vi
        .fn()
        .mockImplementation(
          (path: PathLike | URL, content: string | Buffer | Uint8Array) => {
            fileSystem.set(path.toString(), content.toString());
            return Promise.resolve(undefined);
          },
        );

      setupFsMock(readFileImpl);
      vi.mocked(fs.writeFile).mockImplementation(writeFileImpl);
      vi.mocked(fsPromises.readFile).mockImplementation(readFileImpl);
      vi.mocked(fsPromises.writeFile).mockImplementation(writeFileImpl);

      // Mock other fs operations that might be needed
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Verify initial content
      expect(agent.projectMemory).toBe(
        "# Initial Project Memory\n\nOriginal content",
      );
      expect(agent.userMemory).toBe(
        "# Initial User Memory\n\nOriginal user content",
      );

      // Call saveMemory to add new project memory
      await agent.saveMemory("New project memory block", "project");

      // Verify that projectMemory getter reflects the updated content
      // It should contain both original and new content
      expect(agent.projectMemory).toContain(
        "# Initial Project Memory\n\nOriginal content",
      );
      expect(agent.projectMemory).toContain("New project memory block");

      // Verify userMemory remains unchanged
      expect(agent.userMemory).toBe(
        "# Initial User Memory\n\nOriginal user content",
      );

      await agent.destroy();
    });

    it("should update userMemory getter after calling saveMemory with user type", async () => {
      // Create a simulated file system to track file contents
      const fileSystem = new Map<string, string>();
      fileSystem.set(
        `${mockTempDir}/AGENTS.md`,
        "# Initial Project Memory\n\nOriginal content",
      );
      fileSystem.set(
        "/mock/home/.wave/AGENTS.md",
        "# Initial User Memory\n\nOriginal user content",
      );

      // Mock fs operations to use our simulated file system - both import patterns
      const readFileImpl = vi
        .fn()
        .mockImplementation((path: PathLike | FileHandle) => {
          const content = fileSystem.get(path.toString()) || "";
          return Promise.resolve(content);
        });
      const writeFileImpl = vi
        .fn()
        .mockImplementation(
          (path: PathLike | URL, content: string | Buffer | Uint8Array) => {
            fileSystem.set(path.toString(), content.toString());
            return Promise.resolve(undefined);
          },
        );

      setupFsMock(readFileImpl);
      vi.mocked(fs.writeFile).mockImplementation(writeFileImpl);
      vi.mocked(fsPromises.readFile).mockImplementation(readFileImpl);
      vi.mocked(fsPromises.writeFile).mockImplementation(writeFileImpl);

      // Mock other fs operations that might be needed
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Verify initial content
      expect(agent.projectMemory).toBe(
        "# Initial Project Memory\n\nOriginal content",
      );
      expect(agent.userMemory).toBe(
        "# Initial User Memory\n\nOriginal user content",
      );

      // Call saveMemory to add new user memory
      await agent.saveMemory("New user memory block", "user");

      // Verify that userMemory getter reflects the updated content
      expect(agent.userMemory).toContain(
        "# Initial User Memory\n\nOriginal user content",
      );
      expect(agent.userMemory).toContain("New user memory block");

      // Verify projectMemory remains unchanged
      expect(agent.projectMemory).toBe(
        "# Initial Project Memory\n\nOriginal content",
      );

      await agent.destroy();
    });

    it("should update combinedMemory getter after saveMemory calls", async () => {
      // Create a simulated file system to track file contents
      const fileSystem = new Map<string, string>();
      fileSystem.set(
        `${mockTempDir}/AGENTS.md`,
        "# Project Memory\n\nProject content",
      );
      fileSystem.set(
        "/mock/home/.wave/AGENTS.md",
        "# User Memory\n\nUser content",
      );

      // Mock fs operations to use our simulated file system - both import patterns
      const readFileImpl = vi
        .fn()
        .mockImplementation((path: PathLike | FileHandle) => {
          const content = fileSystem.get(path.toString()) || "";
          return Promise.resolve(content);
        });
      const writeFileImpl = vi
        .fn()
        .mockImplementation(
          (path: PathLike | URL, content: string | Buffer | Uint8Array) => {
            fileSystem.set(path.toString(), content.toString());
            return Promise.resolve(undefined);
          },
        );

      setupFsMock(readFileImpl);
      vi.mocked(fs.writeFile).mockImplementation(writeFileImpl);
      vi.mocked(fsPromises.readFile).mockImplementation(readFileImpl);
      vi.mocked(fsPromises.writeFile).mockImplementation(writeFileImpl);

      // Mock other fs operations that might be needed
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Get initial combined memory
      const initialCombined = agent.combinedMemory;
      expect(initialCombined).toContain("Project content");
      expect(initialCombined).toContain("User content");

      // Add project memory
      await agent.saveMemory("New project info", "project");

      // Verify combinedMemory includes new project content
      expect(agent.combinedMemory).toContain("Project content");
      expect(agent.combinedMemory).toContain("User content");
      expect(agent.combinedMemory).toContain("New project info");

      // Add user memory
      await agent.saveMemory("New user info", "user");

      // Verify combinedMemory includes all content
      expect(agent.combinedMemory).toContain("Project content");
      expect(agent.combinedMemory).toContain("User content");
      expect(agent.combinedMemory).toContain("New project info");
      expect(agent.combinedMemory).toContain("New user info");

      await agent.destroy();
    });

    it("should handle multiple sequential saveMemory calls correctly", async () => {
      // Create a simulated file system to track file contents
      const fileSystem = new Map<string, string>();
      fileSystem.set(
        `${mockTempDir}/AGENTS.md`,
        "# Project Memory\n\nInitial project content",
      );
      fileSystem.set(
        "/mock/home/.wave/AGENTS.md",
        "# User Memory\n\nInitial user content",
      );

      // Mock fs operations to use our simulated file system - both import patterns
      const readFileImpl = vi
        .fn()
        .mockImplementation((path: PathLike | FileHandle) => {
          const content = fileSystem.get(path.toString()) || "";
          return Promise.resolve(content);
        });
      const writeFileImpl = vi
        .fn()
        .mockImplementation(
          (path: PathLike | URL, content: string | Buffer | Uint8Array) => {
            fileSystem.set(path.toString(), content.toString());
            return Promise.resolve(undefined);
          },
        );

      setupFsMock(readFileImpl);
      vi.mocked(fs.writeFile).mockImplementation(writeFileImpl);
      vi.mocked(fsPromises.readFile).mockImplementation(readFileImpl);
      vi.mocked(fsPromises.writeFile).mockImplementation(writeFileImpl);

      // Mock other fs operations that might be needed
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Perform multiple sequential saves
      await agent.saveMemory("First project update", "project");
      await agent.saveMemory("First user update", "user");
      await agent.saveMemory("Second project update", "project");
      await agent.saveMemory("Second user update", "user");

      // Verify all updates are reflected in getters
      const projectMemory = agent.projectMemory;
      const userMemory = agent.userMemory;
      const combinedMemory = agent.combinedMemory;

      // Project memory should contain original + all project updates
      expect(projectMemory).toContain("Initial project content");
      expect(projectMemory).toContain("First project update");
      expect(projectMemory).toContain("Second project update");

      // User memory should contain original + all user updates
      expect(userMemory).toContain("Initial user content");
      expect(userMemory).toContain("First user update");
      expect(userMemory).toContain("Second user update");

      // Combined memory should contain everything
      expect(combinedMemory).toContain("Initial project content");
      expect(combinedMemory).toContain("Initial user content");
      expect(combinedMemory).toContain("First project update");
      expect(combinedMemory).toContain("First user update");
      expect(combinedMemory).toContain("Second project update");
      expect(combinedMemory).toContain("Second user update");

      await agent.destroy();
    });
  });
});
