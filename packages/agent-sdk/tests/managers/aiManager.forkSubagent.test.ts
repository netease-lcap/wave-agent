import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
} from "../../src/types/index.js";

const { callAgentMock } = vi.hoisted(() => ({
  callAgentMock: vi.fn(),
}));

// node:fs.createWriteStream must return a stable mock stream; vi.hoisted keeps
// the reference available inside the vi.mock factory (hoisted above imports).
const { createWriteStreamMock, logStream } = vi.hoisted(() => ({
  createWriteStreamMock: vi.fn(),
  logStream: {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  createWriteStream: (...args: unknown[]) => {
    createWriteStreamMock(...args);
    return logStream;
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { access: vi.fn() },
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: callAgentMock,
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: (...args: unknown[]) => {
    // Snapshot a copy: the fork mutates the returned array afterwards (pushes
    // the prompt and tool results), which would otherwise leak into the record.
    return args[0];
  },
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

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

interface MockTask {
  id: string;
  type: string;
  status: string;
  description: string;
  stdout: string;
  stderr: string;
  outputPath: string;
  startTime?: number;
  endTime?: number;
  runtime?: number;
  onStop?: () => void;
}

describe("AIManager - runForkSubagent", () => {
  let aiManager: AIManager;
  let container: Container;
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;
  let mockPermissionManager: PermissionManager;
  let tasks: Map<string, MockTask>;
  let backgroundTaskManager: BackgroundTaskManager;
  let mockEnqueueNotification: ReturnType<typeof vi.fn>;
  let onUsageAdded: (usage: Usage) => void;
  let taskIdCounter: number;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
    permissionMode: "default",
  };

  const toolCall = (id: string, name: string, args: string) => ({
    id,
    type: "function" as const,
    function: { name, arguments: args },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    taskIdCounter = 0;
    tasks = new Map();

    // Default: the fork produces an answer on a single turn.
    callAgentMock.mockResolvedValue({
      content: "Subtask result",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
    });

    container = new Container();

    mockMessageManager = {
      getMessages: vi.fn().mockReturnValue([]),
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMemoryForInjection: vi.fn().mockResolvedValue({
        prependContent: "",
      }),
    } as unknown as MessageManager;

    mockToolManager = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      execute: vi.fn(),
    } as unknown as ToolManager;

    mockPermissionManager = {
      isToolDenied: vi.fn().mockReturnValue(false),
      getEffectiveAdditionalDirectories: vi.fn().mockReturnValue([]),
    } as unknown as PermissionManager;

    backgroundTaskManager = {
      generateId: vi.fn(() => `task_${++taskIdCounter}`),
      addTask: vi.fn((task: MockTask) => {
        tasks.set(task.id, task);
      }),
      getTask: vi.fn((id: string) => tasks.get(id)),
    } as unknown as BackgroundTaskManager;

    mockEnqueueNotification = vi.fn();

    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("BackgroundTaskManager", backgroundTaskManager);
    container.register("MessageQueue", {
      enqueueNotification: mockEnqueueNotification,
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", undefined);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("TaskManager", { syncWithSession: vi.fn() });
    container.register("MergedEnv", { PATH: "/usr/bin" });
    container.register("Workdir", "/test/workdir");
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue("en"),
    });

    onUsageAdded = vi.fn();
    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: { onUsageAdded },
    });
  });

  describe("background task lifecycle", () => {
    it("should return a task id, complete the fork in the background, and notify with the result", async () => {
      const taskId = await aiManager.runForkSubagent("Summarize the plan", {
        description: "Summarize the plan",
      });

      expect(taskId).toBe("task_1");

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("completed");
      });

      const task = tasks.get("task_1")!;
      expect(task.stdout).toBe("Subtask result");
      expect(task.type).toBe("subagent");
      expect(task.outputPath).toContain("wave-subagent-task_1.log");
      expect(task.endTime).toBeGreaterThanOrEqual(task.startTime!);
      expect(task.runtime).toBeGreaterThanOrEqual(0);

      // The completion notification carries the fork's final reply as <result>.
      expect(mockEnqueueNotification).toHaveBeenCalledTimes(1);
      const xml = mockEnqueueNotification.mock.calls[0][0] as string;
      expect(xml).toContain("<task-id>task_1</task-id>");
      expect(xml).toContain("<task-type>agent</task-type>");
      expect(xml).toContain("<status>completed</status>");
      expect(xml).toContain(
        '<summary>Subtask "Summarize the plan" completed</summary>',
      );
      expect(xml).toContain("<result>Subtask result</result>");

      // Usage is reported as an agent operation on the parent's callbacks.
      expect(onUsageAdded).toHaveBeenCalledWith({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        model: "test-agent-model",
        operation_type: "agent",
      });

      // The log stream received the start marker and the final response.
      expect(logStream.write).toHaveBeenCalledWith(
        expect.stringContaining("Fork subagent started"),
      );
      expect(logStream.write).toHaveBeenCalledWith(
        expect.stringContaining("Final response:\nSubtask result"),
      );
      expect(logStream.end).toHaveBeenCalled();
    });

    it("should snapshot the parent context synchronously so the /subtask echo never duplicates inside the fork", async () => {
      const parentMessages = [
        {
          role: "user",
          blocks: [{ type: "text", text: "parent context", stage: "end" }],
        },
      ];
      mockMessageManager.getMessages = vi.fn().mockReturnValue(parentMessages);

      await aiManager.runForkSubagent("Do the work", {
        description: "Do the work",
      });

      // The /subtask handler records its transcript echo AFTER the fork call
      // returns; the fork's context copy must already be made.
      parentMessages.push({
        role: "user",
        blocks: [{ type: "text", text: "/subtask Do the work", stage: "end" }],
      });

      await vi.waitFor(() => {
        expect(callAgentMock).toHaveBeenCalled();
      });

      const messages = callAgentMock.mock.calls[0][0].messages;
      expect(messages).toEqual([
        {
          role: "user",
          blocks: [{ type: "text", text: "parent context", stage: "end" }],
        },
        { role: "user", content: "Do the work" },
      ]);
    });

    it("should still run the fork and return an empty task id without a BackgroundTaskManager", async () => {
      (
        container as unknown as { services: Map<string, unknown> }
      ).services.delete("BackgroundTaskManager");

      const taskId = await aiManager.runForkSubagent("Do the work", {
        description: "Do the work",
      });

      expect(taskId).toBe("");

      await vi.waitFor(() => {
        expect(callAgentMock).toHaveBeenCalled();
      });

      // No task bookkeeping and no notification machinery without the manager.
      expect(mockEnqueueNotification).not.toHaveBeenCalled();
    });
  });

  describe("turns and failure classification", () => {
    it("should allow multiple turns by default (CC-aligned loose maxTurns), retrying denied tool calls", async () => {
      callAgentMock
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [toolCall("c1", "Agent", "{}")],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
        .mockResolvedValueOnce({
          content: "Final answer",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          tool_calls: [],
        });

      await aiManager.runForkSubagent("Refuse this", {
        description: "Refuse this",
      });

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("completed");
      });

      expect(callAgentMock).toHaveBeenCalledTimes(2);
      expect(tasks.get("task_1")!.stdout).toBe("Final answer");
    });

    it("should fail when an explicit maxTurns cap prevents a text response", async () => {
      callAgentMock.mockResolvedValue({
        content: "",
        tool_calls: [toolCall("c1", "Agent", "{}")],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      await aiManager.runForkSubagent("Turn around", {
        description: "Turn around",
        maxTurns: 1,
      });

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("failed");
      });

      expect(tasks.get("task_1")!.stderr).toBe(
        "Fork subagent produced no text response",
      );
      expect(mockEnqueueNotification).toHaveBeenCalledWith(
        expect.stringContaining("<status>failed</status>"),
      );
    });

    it("should fail when the fork produces neither text nor tool calls", async () => {
      callAgentMock.mockResolvedValue({
        content: "",
        tool_calls: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      const taskId = await aiManager.runForkSubagent("Say nothing", {
        description: "Say nothing",
      });

      await vi.waitFor(() => {
        expect(tasks.get(taskId)?.status).toBe("failed");
      });

      expect(tasks.get(taskId)!.stderr).toBe(
        "Fork subagent produced no text response",
      );
    });

    it("should fail and notify when the AI call errors", async () => {
      callAgentMock.mockRejectedValue(new Error("rate limit exceeded"));

      await aiManager.runForkSubagent("Do it", { description: "Do it" });

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("failed");
      });

      expect(tasks.get("task_1")!.stderr).toBe("rate limit exceeded");
      expect(mockEnqueueNotification).toHaveBeenCalledWith(
        expect.stringContaining('Subtask "Do it" failed: rate limit exceeded'),
      );
    });
  });

  describe("tool gate", () => {
    it("should deny the Agent and Task tools (recursion prevention) and feed the denial back", async () => {
      callAgentMock
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [
            toolCall("c1", "Agent", JSON.stringify({ description: "nested" })),
            toolCall("c2", "TaskCreate", "{}"),
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
        .mockResolvedValueOnce({
          content: "Done",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          tool_calls: [],
        });

      await aiManager.runForkSubagent("Delegate", {
        description: "Delegate",
      });

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("completed");
      });

      const messages = callAgentMock.mock.calls[1][0].messages;
      const toolResults = messages.filter(
        (m: { role: string }) => m.role === "tool",
      );
      expect(toolResults).toHaveLength(2);
      for (const tr of toolResults) {
        expect(tr.content).toBe(
          "The Agent tool and Task tools are not available in a fork subagent.",
        );
      }
      // Denied tools must never reach the local tool executor.
      expect(mockToolManager.execute).not.toHaveBeenCalled();
    });

    it("should honor the parent's denied-tool rules (permissionManager.isToolDenied)", async () => {
      (
        mockPermissionManager.isToolDenied as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockImplementation((name: string) => name === "Read");
      callAgentMock
        .mockResolvedValueOnce({
          content: "",
          tool_calls: [toolCall("c1", "Read", "{}")],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
        .mockResolvedValueOnce({
          content: "OK",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          tool_calls: [],
        });

      await aiManager.runForkSubagent("Read it", { description: "Read it" });

      await vi.waitFor(() => {
        expect(tasks.get("task_1")?.status).toBe("completed");
      });

      expect(mockPermissionManager.isToolDenied).toHaveBeenCalledWith("Read");
      const messages = callAgentMock.mock.calls[1][0].messages;
      const toolResults = messages.filter(
        (m: { role: string }) => m.role === "tool",
      );
      expect(toolResults[0].content).toBe(
        "The Agent tool and Task tools are not available in a fork subagent.",
      );
      expect(mockToolManager.execute).not.toHaveBeenCalled();
    });
  });

  describe("abort and stop", () => {
    it("should mark the task killed (no notification) when the caller aborts", async () => {
      callAgentMock.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("Request was aborted");
      });

      const controller = new AbortController();
      const taskId = await aiManager.runForkSubagent(
        "Slow work",
        { description: "Slow work" },
        controller.signal,
      );
      controller.abort();

      await vi.waitFor(() => {
        expect(tasks.get(taskId)?.status).toBe("killed");
      });

      expect(mockEnqueueNotification).not.toHaveBeenCalled();
      expect(logStream.end).toHaveBeenCalled();
    });

    it("should abort the in-flight fork when the background task is stopped (onStop)", async () => {
      callAgentMock.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("Request was aborted");
      });

      await aiManager.runForkSubagent("Slow work", {
        description: "Slow work",
      });

      const addedTask = (
        backgroundTaskManager as unknown as {
          addTask: ReturnType<typeof vi.fn>;
        }
      ).addTask.mock.calls[0][0] as MockTask;
      addedTask.onStop?.();

      await vi.waitFor(() => {
        expect(tasks.get(addedTask.id)?.status).toBe("killed");
      });

      expect(mockEnqueueNotification).not.toHaveBeenCalled();
    });
  });
});
