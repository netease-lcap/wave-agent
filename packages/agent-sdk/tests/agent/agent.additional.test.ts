import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as sessionService from "@/services/session.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import * as fs from "fs/promises";
import { taskNotificationToXml } from "@/utils/notificationXml.js";
import { pageCommentEventToXml } from "@/utils/pageCommentEventXml.js";

// Mock dependencies
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  }),
  compactMessages: vi.fn().mockResolvedValue({
    content: "compacted",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
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
    setSessionCustomTitle: vi.fn(),
    reAppendSessionMetadata: vi.fn().mockResolvedValue(undefined),
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

describe("Agent additional coverage", () => {
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

    it("should skip notification processing when agent is loading", async () => {
      // Set loading state to true
      const aiManager = (
        agent as unknown as { aiManager: { isLoading: boolean } }
      ).aiManager;
      aiManager.isLoading = true;

      const messageQueue = (
        agent as unknown as {
          messageQueue: {
            enqueueNotification: (xml: string) => void;
            drainNotifications: () => string[];
            onMessageEnqueued?: () => void;
          };
        }
      ).messageQueue;

      // Enqueue a notification - tryDispatch returns early because isLoading is true
      messageQueue.enqueueNotification("test-notification");

      // Notification should still be in the queue (not processed)
      expect(messageQueue.drainNotifications()).toEqual(["test-notification"]);

      // Reset loading state
      aiManager.isLoading = false;
    });

    it("should process pending notifications and clear queue", async () => {
      const agent2 = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-coverage-2",
      });

      const messageQueue = (
        agent2 as unknown as {
          messageQueue: {
            enqueueNotification: (xml: string) => void;
            hasNotifications: () => boolean;
            onMessageEnqueued?: () => void;
          };
        }
      ).messageQueue;

      // Enqueue a notification - this triggers tryDispatch → processQueuedMessage
      messageQueue.enqueueNotification("test-notification");

      // Use vi.waitFor to properly wait for the async processing
      await vi.waitFor(
        () => {
          expect(messageQueue.hasNotifications()).toBe(false);
        },
        { timeout: 5000 },
      );

      // Clean up before the next test
      await agent2.destroy();
    });

    it("should deliver a background task's result to the model, not just its summary", async () => {
      // A workflow's notification is how the script's return value reaches the
      // model: the summary carries counts (<usage>), the result carries the
      // findings. The idle dispatch path dropped <result>, so a caller that
      // awaited a value had to go read the journal instead.
      const agent2 = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-coverage-result",
      });

      const messageQueue = (
        agent2 as unknown as {
          messageQueue: { enqueueNotification: (xml: string) => void };
        }
      ).messageQueue;

      messageQueue.enqueueNotification(
        taskNotificationToXml({
          type: "task_notification",
          taskId: "run-1",
          taskType: "workflow",
          status: "completed",
          summary: 'Dynamic workflow "scan" completed',
          result: '{"findings":[{"id":"F1"}]}',
        }),
      );

      await vi.waitFor(
        () => {
          const blocks = agent2.messages
            .flatMap((message) => message.blocks ?? [])
            .filter((block) => block.type === "task_notification");
          expect(blocks).toHaveLength(1);
          expect((blocks[0] as unknown as { result?: string }).result).toBe(
            '{"findings":[{"id":"F1"}]}',
          );
        },
        { timeout: 5000 },
      );

      await agent2.destroy();
    });

    it("wakes an idle agent on a page-comment event, as hidden user text", async () => {
      // The comment event is a signal, not a task: it has no taskId and no
      // terminal state, so it must not be dressed up as a task notification.
      // It reaches the model as a meta user message (UI hides it, the model
      // sees it, the transcript keeps it) and starts a turn on its own.
      const agent2 = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-coverage-page-comment",
      });

      const messageQueue = (
        agent2 as unknown as {
          messageQueue: { enqueueNotification: (xml: string) => void };
        }
      ).messageQueue;

      const xml = pageCommentEventToXml({
        url: "https://server.test/code/artifact/abc",
        slug: "abc",
        count: 1,
        threadIds: ["t1"],
      });
      messageQueue.enqueueNotification(xml);

      await vi.waitFor(
        () => {
          const meta = agent2.messages.filter(
            (message) => message.role === "user" && message.isMeta,
          );
          expect(meta).toHaveLength(1);
          const text = meta[0].blocks
            .map((block) => (block.type === "text" ? block.content : ""))
            .join("\n");
          expect(text).toContain("<slug>abc</slug>");
          // No comment text, and no task-notification wording.
          expect(text).not.toContain("task-notification");
        },
        { timeout: 5000 },
      );

      const blocks = agent2.messages.flatMap((message) => message.blocks ?? []);
      expect(blocks.some((block) => block.type === "task_notification")).toBe(
        false,
      );

      await agent2.destroy();
    });

    it("should handle restoreSession with same sessionId", async () => {
      const currentId = agent.sessionId;
      await agent.restoreSession(currentId);
      expect(sessionService.loadSessionFromJsonl).not.toHaveBeenCalled();
    });

    it("keeps the custom title in memory so it can be written back on exit", async () => {
      vi.mocked(sessionService.setSessionCustomTitle).mockResolvedValue(
        "我的标题",
      );
      const agent2 = await Agent.create({ workdir: "/tmp/test-title-exit" });

      await agent2.renameSession("  我的标题  ");

      // Append-only: the rename writes the entry right away...
      expect(sessionService.setSessionCustomTitle).toHaveBeenCalledWith(
        "test-session-id",
        "/tmp/test-title-exit",
        "  我的标题  ",
      );
      // ...and the value is remembered in memory, then flushed back to EOF when
      // the session is left behind.
      expect(
        (
          agent2 as unknown as {
            messageManager: { getCustomTitle: () => string | undefined };
          }
        ).messageManager.getCustomTitle(),
      ).toBe("我的标题");

      await agent2.destroy();

      expect(sessionService.reAppendSessionMetadata).toHaveBeenCalledWith(
        "test-session-id",
        "/tmp/test-title-exit",
        "我的标题",
        "main",
      );
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
    });
  });
});
