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

describe("Agent WorktreeCreate Hook", () => {
  const mockCallbacks = {
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

  it("should NOT fire WorktreeCreate hooks during initialization (replace semantics)", async () => {
    // The notification-style trigger was removed: WorktreeCreate is now a
    // replace hook driven by EnterWorktree / the CLI createWorktree path,
    // never by agent initialization.
    const executeHooksSpy = vi.spyOn(HookManager.prototype, "executeHooks");

    const agent = await Agent.create({
      callbacks: mockCallbacks,
      workdir: "/tmp/test-workdir",
      isNewWorktree: true,
      worktreeName: "test-worktree",
    });

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
