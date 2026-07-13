import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookManager } from "@/managers/hookManager.js";
import { MessageManager } from "@/managers/messageManager.js";
import * as fs from "fs/promises";
import { homedir } from "os";

vi.mock("@/services/aiService");
vi.mock("fs/promises");

describe("Agent WorktreeCreate Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(homedir).mockReturnValue("/home/testuser");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("HookManager.processHookResults for WorktreeCreate", () => {
    it("should add an error block when a WorktreeCreate hook returns exit code 2", async () => {
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
      expect(processResult.shouldBlock).toBe(false);
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
      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });
  });
});
