import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/types/index.js";

// Mock memory
const mockMemoryServiceInstance = {
  getUserMemoryContent: vi.fn().mockResolvedValue(""),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue(""),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
  getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
  ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
  getAutoMemoryContent: vi.fn().mockResolvedValue(""),
};

vi.mock("@/services/memory", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
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

  beforeEach(async () => {
    // Set up mock directory path
    mockTempDir = "/mock/tmp/memory-test-123";

    // Reset all mocks
    vi.clearAllMocks();
    mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue("");
    mockMemoryServiceInstance.readMemoryFile.mockResolvedValue("");
    mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue("");

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

      mockMemoryServiceInstance.readMemoryFile.mockResolvedValue(
        projectMemoryContent,
      );

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Memory should be loaded during initialization
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(mockMemoryServiceInstance.readMemoryFile).toHaveBeenCalledWith(
        mockTempDir,
      );

      await agent.destroy();
    });

    it("should load user memory from user memory file during Agent.create()", async () => {
      // Mock user memory file content
      const userMemoryContent =
        "# User Memory\n\nUser-level preferences\n- User setting 1\n- User setting 2\n";

      mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue(
        userMemoryContent,
      );

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // User memory should be loaded during initialization
      expect(agent.userMemory).toBe(userMemoryContent);
      expect(mockMemoryServiceInstance.getUserMemoryContent).toHaveBeenCalled();

      await agent.destroy();
    });

    it("should initialize with empty content when files don't exist", async () => {
      // Mock files not existing
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("File not found"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("File not found"),
      );

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

      mockMemoryServiceInstance.readMemoryFile.mockResolvedValue(
        projectMemoryContent,
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue(
        userMemoryContent,
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        projectMemoryContent + "\n\n" + userMemoryContent,
      );

      const agent = await Agent.create({
        workdir: mockTempDir,
        callbacks: mockCallbacks,
      });

      // Verify initial memory loading
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(agent.userMemory).toBe(userMemoryContent);

      // Access memory multiple times - should not trigger additional file reads for initialization
      // But getCombinedMemory() calls MemoryService.getCombinedMemoryContent which might read files
      expect(agent.projectMemory).toBe(projectMemoryContent);
      expect(agent.userMemory).toBe(userMemoryContent);
      expect(await agent.getCombinedMemory()).toBe(
        projectMemoryContent + "\n\n" + userMemoryContent,
      );

      // Initialization calls: 1 for project, 1 for user
      expect(mockMemoryServiceInstance.readMemoryFile).toHaveBeenCalledTimes(1);
      expect(
        mockMemoryServiceInstance.getUserMemoryContent,
      ).toHaveBeenCalledTimes(1);
      // getCombinedMemory calls: 1
      expect(
        mockMemoryServiceInstance.getCombinedMemoryContent,
      ).toHaveBeenCalledTimes(1);

      await agent.destroy();
    });
  });

  describe("T010 - Memory content access test for readonly getters", () => {
    it("should provide projectMemory getter that returns loaded content", async () => {
      const projectMemoryContent =
        "# Memory\n\n- Important project info\n- Another detail\n";

      mockMemoryServiceInstance.readMemoryFile.mockResolvedValue(
        projectMemoryContent,
      );

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

      mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue(
        userMemoryContent,
      );

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

      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        `${projectMemoryContent}\n\n${userMemoryContent}`,
      );

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

      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        projectMemoryContent,
      );

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

      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        userMemoryContent,
      );

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
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("ENOENT"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("ENOENT"),
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue("");

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
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("ENOENT"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue(
        "# User Memory\n\nUser content",
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        "# User Memory\n\nUser content",
      );

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
      mockMemoryServiceInstance.readMemoryFile.mockResolvedValue(
        "# Memory\n\nProject content",
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("ENOENT"),
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue(
        "# Memory\n\nProject content",
      );

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
      // Mock files being unreadable
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("EACCES"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("EIO"),
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue("");

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
      // Mock files throwing various errors
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("Unexpected file system error"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("Network file system timeout"),
      );

      // Agent creation should NOT throw despite memory loading errors
      let agent: Agent;
      await expect(async () => {
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

      await agent.destroy();
    });

    it("should ensure Agent startup succeeds even with memory errors", async () => {
      // Mock all possible error scenarios
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("Random error"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("Random error"),
      );
      mockMemoryServiceInstance.getCombinedMemoryContent.mockResolvedValue("");

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
