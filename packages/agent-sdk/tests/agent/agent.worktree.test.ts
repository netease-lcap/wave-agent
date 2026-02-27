import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { HookManager } from "@/managers/hookManager.js";
import { MessageManager } from "@/managers/messageManager.js";
import * as fs from "fs/promises";
import { homedir } from "os";

// Mock AI service
vi.mock("@/services/aiService");
// Mock fs/promises to avoid actual file operations
vi.mock("fs/promises");
// Mock os to avoid actual homedir access
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/home/testuser"),
    platform: vi.fn(() => "linux"),
  };
});

describe("Agent WorktreeCreate Hook", () => {
  const mockCallbacks = {
    onMessagesChange: vi.fn(),
    onLoadingChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(homedir).mockReturnValue("/home/testuser");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should trigger WorktreeCreate hook when isNewWorktree is true during initialization", async () => {
    // We need to spy on HookManager.prototype.executeHooks because it's created during Agent.create
    const executeHooksSpy = vi.spyOn(HookManager.prototype, "executeHooks");
    const processHookResultsSpy = vi.spyOn(
      HookManager.prototype,
      "processHookResults",
    );

    executeHooksSpy.mockResolvedValue([]);

    const agent = await Agent.create({
      callbacks: mockCallbacks,
      workdir: "/tmp/test-workdir",
      isNewWorktree: true,
      worktreeName: "test-worktree",
    });

    expect(executeHooksSpy).toHaveBeenCalledWith(
      "WorktreeCreate",
      expect.objectContaining({
        event: "WorktreeCreate",
        worktreeName: "test-worktree",
      }),
    );
    expect(processHookResultsSpy).toHaveBeenCalledWith(
      "WorktreeCreate",
      [],
      expect.any(MessageManager),
    );

    await agent.destroy();
  });

  it("should handle errors during WorktreeCreate hook execution gracefully", async () => {
    const executeHooksSpy = vi.spyOn(HookManager.prototype, "executeHooks");
    executeHooksSpy.mockRejectedValue(new Error("Hook execution failed"));

    // Should not throw
    const agent = await Agent.create({
      callbacks: mockCallbacks,
      workdir: "/tmp/test-workdir",
      isNewWorktree: true,
    });

    expect(executeHooksSpy).toHaveBeenCalledWith(
      "WorktreeCreate",
      expect.anything(),
    );

    await agent.destroy();
  });

  it("should NOT trigger WorktreeCreate hook when isNewWorktree is false", async () => {
    const executeHooksSpy = vi.spyOn(HookManager.prototype, "executeHooks");

    const agent = await Agent.create({
      callbacks: mockCallbacks,
      workdir: "/tmp/test-workdir",
      isNewWorktree: false,
    });

    // Check if WorktreeCreate was called
    const worktreeCreateCalls = executeHooksSpy.mock.calls.filter(
      (call) => call[0] === "WorktreeCreate",
    );
    expect(worktreeCreateCalls.length).toBe(0);

    await agent.destroy();
  });

  describe("HookManager.processHookResults for WorktreeCreate", () => {
    it("should add an error block when a WorktreeCreate hook returns exit code 2", async () => {
      // We can test this by calling processHookResults on a real HookManager instance
      // but we need a MessageManager mock
      const mockMessageManager = {
        addErrorBlock: vi.fn(),
      } as unknown as MessageManager;

      // Create a HookManager instance (we need a container but we can mock it)
      const mockContainer = {
        get: vi.fn(),
      } as unknown as import("@/utils/container.js").Container;
      const hookManager = new HookManager(mockContainer, "/tmp/test-workdir");

      const results = [
        {
          success: false,
          exitCode: 2,
          stderr: "Worktree creation failed critically",
          duration: 100,
          timedOut: false,
        },
      ];

      const processResult = hookManager.processHookResults(
        "WorktreeCreate",
        results,
        mockMessageManager,
      );

      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "Worktree creation failed critically",
      );
      expect(processResult.shouldBlock).toBe(false); // WorktreeCreate is non-blocking for now
    });

    it("should add an error block for non-zero exit codes other than 2", async () => {
      const mockMessageManager = {
        addErrorBlock: vi.fn(),
      } as unknown as MessageManager;

      const mockContainer = {
        get: vi.fn(),
      } as unknown as import("@/utils/container.js").Container;
      const hookManager = new HookManager(mockContainer, "/tmp/test-workdir");

      const results = [
        {
          success: false,
          exitCode: 1,
          stderr: "Minor hook failure",
          duration: 50,
          timedOut: false,
        },
      ];

      hookManager.processHookResults(
        "WorktreeCreate",
        results,
        mockMessageManager,
      );

      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "Minor hook failure",
      );
    });

    it("should NOT add an error block for exit code 0", async () => {
      const mockMessageManager = {
        addErrorBlock: vi.fn(),
        addUserMessage: vi.fn(),
      } as unknown as MessageManager;

      const mockContainer = {
        get: vi.fn(),
      } as unknown as import("@/utils/container.js").Container;
      const hookManager = new HookManager(mockContainer, "/tmp/test-workdir");

      const results = [
        {
          success: true,
          exitCode: 0,
          stdout: "Hook success",
          stderr: "",
          duration: 50,
          timedOut: false,
        },
      ];

      hookManager.processHookResults(
        "WorktreeCreate",
        results,
        mockMessageManager,
      );

      expect(mockMessageManager.addErrorBlock).not.toHaveBeenCalled();
      // WorktreeCreate doesn't inject stdout even on success
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });
  });
});
