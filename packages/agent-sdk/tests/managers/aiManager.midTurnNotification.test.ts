import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type {
  Message,
  TaskNotificationBlock,
} from "../../src/types/messaging.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("../../src/utils/gitUtils.js", () => ({ isGitRepository: vi.fn() }));

const { callAgentMock } = vi.hoisted(() => ({ callAgentMock: vi.fn() }));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: callAgentMock,
  compactMessages: vi.fn().mockResolvedValue({
    content: "Compacted content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

const mockGatewayConfig: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "https://test-gateway.com",
};

const mockModelConfig: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
};

/**
 * A completed background command, in the exact shape
 * BackgroundTaskManager.enqueueNotification produces on child exit.
 */
const NOTIFICATION_XML = [
  "<task-notification>",
  "<task-id>bg-1</task-id>",
  "<task-type>shell</task-type>",
  "<output-file>/tmp/bg-1.log</output-file>",
  "<status>completed</status>",
  '<summary>Command "make build" completed with exit code 0</summary>',
  "</task-notification>",
].join("\n");

const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };

function toolCallResponse() {
  return {
    content: "",
    usage,
    tool_calls: [
      {
        id: "call_1",
        type: "function" as const,
        function: { name: "Read", arguments: "{}" },
      },
    ],
  };
}

function textResponse() {
  return { content: "All done.", usage, tool_calls: [] };
}

/**
 * A MessageManager double backed by a real message array: the notification path
 * runs through the REAL convertMessagesForAPI, so what the model receives is
 * asserted from the request body rather than from a mock call.
 */
function buildMessageManager(messages: Message[]) {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn(() => messages),
    addAssistantMessage: vi.fn(() => {
      const message: Message = {
        id: `assistant-${messages.length}`,
        role: "assistant",
        blocks: [],
        timestamp: new Date().toISOString(),
      };
      messages.push(message);
      return message.id;
    }),
    addUserMessage: vi.fn(
      ({ content, isMeta }: { content: string; isMeta?: boolean }) => {
        const message: Message = {
          id: `user-${messages.length}`,
          role: "user",
          blocks: [{ type: "text", content }],
          timestamp: new Date().toISOString(),
          isMeta,
        };
        messages.push(message);
        return message.id;
      },
    ),
    addNotificationMessage: vi.fn(
      (params: Omit<TaskNotificationBlock, "type">) => {
        const block: TaskNotificationBlock = {
          type: "task_notification",
          ...params,
        };
        const message: Message = {
          id: `user-${messages.length}`,
          role: "user",
          blocks: [block],
          timestamp: new Date().toISOString(),
          isMeta: true,
        };
        messages.push(message);
        return message.id;
      },
    ),
    appendCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    setlatestTotalTokens: vi.fn(),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    addNoticeBlock: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compactMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    triggerFileRead: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    finalizeAbortedToolBlocks: vi.fn(),
  };
}

function buildHarness() {
  const messages: Message[] = [];
  const queue = new MessageQueue();
  const messageManager = buildMessageManager(messages);

  const container = new Container();
  container.register("MessageQueue", queue);
  container.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(8000),
  });
  container.register("MessageManager", messageManager);
  container.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi
      .fn()
      .mockResolvedValue({ success: true, content: "file contents" }),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager);
  container.register("TaskManager", {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as TaskManager);
  container.register("MemoryService", {
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  });
  container.register("PermissionManager", {
    getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
    clearTemporaryRules: vi.fn(),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  container.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  container.register("AgentOptions", { callbacks: {} });

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  return { aiManager, queue, messageManager, messages };
}

describe("AIManager mid-turn notification injection (background-task-notification)", () => {
  beforeEach(() => {
    callAgentMock.mockReset();
  });

  it("hands a notification that lands mid-turn to the model in the SAME turn", async () => {
    const { aiManager, queue, messageManager, messages } = buildHarness();

    const requests: Array<Array<{ role: string; content: unknown }>> = [];
    callAgentMock.mockImplementation(
      async (options: { messages: (typeof requests)[0] }) => {
        requests.push(options.messages);
        if (requests.length === 1) {
          // The background command finishes while this turn's tool is running —
          // i.e. after the model already returned its tool call.
          queue.enqueueNotification(NOTIFICATION_XML);
          return toolCallResponse();
        }
        return textResponse();
      },
    );

    await aiManager.sendAIMessage();
    // Two requests: initial one, plus the follow-up that carried the tool
    // result. The notification must ride the second one — no third request
    // (a turn-end restart) and nothing left in the queue.
    expect(callAgentMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(requests[0])).not.toContain("bg-1");
    expect(JSON.stringify(requests[1])).toContain("<task-id>bg-1</task-id>");
    // The lead-in is what tells the model this is a task result, not a user turn.
    expect(JSON.stringify(requests[1])).toContain(
      "A background agent completed a task:",
    );

    // Injected exactly once, as a hidden (isMeta) user message.
    expect(messageManager.addNotificationMessage).toHaveBeenCalledTimes(1);
    expect(messageManager.addNotificationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "bg-1", status: "completed" }),
    );
    const notificationMessages = messages.filter(
      (m) =>
        m.role === "user" &&
        m.blocks.some((b) => b.type === "task_notification"),
    );
    expect(notificationMessages).toHaveLength(1);
    expect(notificationMessages[0]?.isMeta).toBe(true);
    expect(queue.hasNotifications()).toBe(false);
  });

  it("does not inject while the model ends the turn — the turn-end path owns it", async () => {
    const { aiManager, queue, messageManager } = buildHarness();

    let calls = 0;
    callAgentMock.mockImplementation(() => {
      calls++;
      if (calls === 1) {
        // A task finishes while this no-tool turn is streaming. Nothing may be
        // injected mid-turn here: there is no further request in this turn.
        queue.enqueueNotification(NOTIFICATION_XML);
      }
      return textResponse();
    });

    await aiManager.sendAIMessage();

    // One turn plus the notification-driven follow-up turn the turn-end drain
    // starts. Injected exactly once; the queue is empty afterwards.
    expect(callAgentMock).toHaveBeenCalledTimes(2);
    expect(messageManager.addNotificationMessage).toHaveBeenCalledTimes(1);
    expect(queue.hasNotifications()).toBe(false);
  });
});
