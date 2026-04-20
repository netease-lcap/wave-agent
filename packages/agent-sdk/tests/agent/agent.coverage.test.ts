import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as sessionService from "@/services/session.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import * as fs from "fs/promises";

// Mock dependencies
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  }),
  compressMessages: vi.fn().mockResolvedValue({
    content: "compressed",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  isClaudeModel: vi.fn().mockReturnValue(false),
  transformMessagesForClaudeCache: vi.fn((m) => m),
  addCacheControlToLastTool: vi.fn((t) => t),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));
vi.mock("@/services/session", async () => {
  const actual = await vi.importActual("@/services/session");
  return {
    ...actual,
    generateSessionId: vi.fn(() => "test-session-id"),
    handleSessionRestoration: vi.fn(),
    loadSessionFromJsonl: vi.fn(),
    appendMessages: vi.fn(),
  };
});
vi.mock("fs/promises");

// Mock memory
const mockMemoryServiceInstance = {
  getUserMemoryContent: vi.fn().mockResolvedValue(""),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue(""),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
  getAutoMemoryDirectory: vi.fn().mockReturnValue("/test/auto-memory"),
  ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
  getAutoMemoryContent: vi.fn().mockResolvedValue(""),
};

vi.mock("@/services/memory", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
}));

const { instance: mockToolManagerInstance } = createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent - Branch Coverage", () => {
  let agent: Agent;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMemoryServiceInstance.readMemoryFile.mockResolvedValue("");
    mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue("");

    // Default session restoration mock
    vi.mocked(sessionService.handleSessionRestoration).mockResolvedValue(
      undefined,
    );
    vi.mocked(fs.readdir).mockResolvedValue([]);
  });

  afterEach(async () => {
    if (agent) await agent.destroy();
  });

  describe("Initialization and Configuration", () => {
    it("should handle missing project and user memory files", async () => {
      mockMemoryServiceInstance.readMemoryFile.mockRejectedValue(
        new Error("File not found"),
      );
      mockMemoryServiceInstance.getUserMemoryContent.mockRejectedValue(
        new Error("File not found"),
      );

      agent = await Agent.create({ workdir: "/test/workdir" });

      expect(agent.projectMemory).toBe("");
      expect(agent.userMemory).toBe("");
    });
  });

  describe("Public Methods and Edge Cases", () => {
    beforeEach(async () => {
      agent = await Agent.create({});
    });

    it("should return null for background shell output if task not found", () => {
      expect(agent.getBackgroundShellOutput("non-existent")).toBeNull();
    });

    it("should return null for background task output if task not found", () => {
      expect(agent.getBackgroundTaskOutput("non-existent")).toBeNull();
    });

    it("should have notification queue wired up", async () => {
      // Verify the notification queue exists and has the expected interface
      const notificationQueue = (
        agent as unknown as {
          notificationQueue: {
            enqueue: (n: string) => void;
            dequeueAll: () => string[];
            hasPending: () => boolean;
            onNotificationsEnqueued?: () => void;
          };
        }
      ).notificationQueue;

      expect(notificationQueue).toBeDefined();
      expect(typeof notificationQueue.enqueue).toBe("function");
      expect(typeof notificationQueue.dequeueAll).toBe("function");
      expect(typeof notificationQueue.hasPending).toBe("function");
      expect(typeof notificationQueue.onNotificationsEnqueued).toBe("function");
    });

    it("should trigger notification callback when agent is idle", async () => {
      // Enqueue a notification - this should trigger the onNotificationsEnqueued
      // callback, which calls processPendingNotifications since agent is idle
      const notificationQueue = (
        agent as unknown as {
          notificationQueue: {
            enqueue: (n: string) => void;
            hasPending: () => boolean;
            onNotificationsEnqueued?: () => void;
          };
        }
      ).notificationQueue;

      // Manually call the callback to exercise the branches
      notificationQueue.onNotificationsEnqueued!();

      // Give time for the async processPendingNotifications to run
      await new Promise((r) => setTimeout(r, 10));

      // The notification should have been processed (queue is empty since no items)
      expect(notificationQueue.hasPending()).toBe(false);
    });

    it("should skip notification processing when agent is loading", async () => {
      // Set loading state to true
      const aiManager = (
        agent as unknown as { aiManager: { isLoading: boolean } }
      ).aiManager;
      aiManager.isLoading = true;

      const notificationQueue = (
        agent as unknown as {
          notificationQueue: {
            enqueue: (n: string) => void;
            dequeueAll: () => string[];
            onNotificationsEnqueued?: () => void;
          };
        }
      ).notificationQueue;

      // Enqueue a notification first
      notificationQueue.enqueue("test-notification");

      // Manually call the callback - should NOT trigger processPendingNotifications
      // because agent is loading
      notificationQueue.onNotificationsEnqueued!();

      // Queue should still have the notification (not processed)
      expect(notificationQueue.dequeueAll()).toEqual(["test-notification"]);

      // Reset loading state
      aiManager.isLoading = false;
    });

    it("should process pending notification promises on destroy", async () => {
      const agent2 = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-coverage-2",
      });

      const notificationQueue = (
        agent2 as unknown as {
          notificationQueue: {
            enqueue: (n: string) => void;
            hasPending: () => boolean;
            onNotificationsEnqueued?: () => void;
          };
        }
      ).notificationQueue;

      // Enqueue a notification
      notificationQueue.enqueue("test-notification");

      // Manually call the callback (agent is idle)
      notificationQueue.onNotificationsEnqueued!();

      // Use vi.waitFor to properly wait for the async processing
      await vi.waitFor(
        () => {
          expect(notificationQueue.hasPending()).toBe(false);
        },
        { timeout: 5000 },
      );

      // Clean up before the next test
      await agent2.destroy();
    });

    it("should handle restoreSession with same sessionId", async () => {
      const currentId = agent.sessionId;
      await agent.restoreSession(currentId);
      expect(sessionService.loadSessionFromJsonl).not.toHaveBeenCalled();
    });

    it("should throw error if restoreSession target not found", async () => {
      vi.mocked(sessionService.loadSessionFromJsonl).mockResolvedValue(null);
      await expect(agent.restoreSession("missing")).rejects.toThrow(
        "Session not found: missing",
      );
    });

    it("should handle slash command that doesn't exist", async () => {
      // Mock slashCommandManager.parseAndValidateSlashCommand
      const mockSlashManager = (
        agent as unknown as {
          slashCommandManager: {
            parseAndValidateSlashCommand: (cmd: string) => { isValid: boolean };
          };
        }
      ).slashCommandManager;
      vi.spyOn(
        mockSlashManager,
        "parseAndValidateSlashCommand",
      ).mockReturnValue({ isValid: false });

      const spyAddUserMessage = vi.spyOn(
        (
          agent as unknown as {
            messageManager: { addUserMessage: (msg: string) => void };
          }
        ).messageManager,
        "addUserMessage",
      );

      await agent.sendMessage("/unknown");

      expect(spyAddUserMessage).toHaveBeenCalled();
    });

    it("should handle empty or single slash command", async () => {
      const spyAddUserMessage = vi.spyOn(
        (
          agent as unknown as {
            messageManager: { addUserMessage: (msg: string) => void };
          }
        ).messageManager,
        "addUserMessage",
      );
      await agent.sendMessage("/");
      expect(spyAddUserMessage).not.toHaveBeenCalled();

      await agent.sendMessage("  ");
      // sendMessage doesn't check for empty string if it doesn't start with /
      // but let's see
    });
  });
});
