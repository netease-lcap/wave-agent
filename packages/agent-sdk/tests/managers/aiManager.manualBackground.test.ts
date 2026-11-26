import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
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

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager 手动转后台后是否继续本轮", () => {
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
  };

  /** 最后一条助手消息里躺着一个被用户手动转后台的 shell 工具块。 */
  function messagesWithBackgroundedTool() {
    return [
      {
        id: "msg-1",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "call-1",
            name: "Bash",
            stage: "end",
            result: "",
            success: true,
            backgroundTaskId: "task_1",
            backgroundedByUser: true,
          },
        ],
      },
    ] as unknown as ReturnType<MessageManager["getMessages"]>;
  }

  function createContainer() {
    const container = new Container();
    container.register("ConfigurationService", {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveContextWindow: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
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
    } as unknown as Record<string, unknown>);
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });
    container.register("MessageQueue", {
      hasNotifications: vi.fn().mockReturnValue(false),
      drainNotifications: vi.fn().mockReturnValue([]),
    });
    return container;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMessages: vi.fn().mockReturnValue([]),
      addAssistantMessage: vi.fn(),
      addUserMessage: vi.fn(),
      appendCurrentMessageContent: vi.fn(),
      updateToolBlock: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
      setMessages: vi.fn(),
      getLatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
      processTriggeredRules: vi.fn().mockReturnValue([]),
      addNoticeBlock: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compactMessagesAndUpdateSession: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
      triggerFileRead: vi.fn(),
      finalizeStreamingBlocks: vi.fn(),
      finalizeAbortedToolBlocks: vi.fn(),
    } as unknown as MessageManager;

    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
      isConcurrencySafe: vi.fn().mockReturnValue(true),
    } as unknown as ToolManager;
  });

  function toolCallResponse(id: string) {
    return {
      content: "Tool response",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          type: "function" as const,
          id,
          function: { name: "test-tool", arguments: "{}" },
        },
      ],
    };
  }

  function finalResponse() {
    return {
      content: "Final response",
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      tool_calls: [],
    };
  }

  it("用户把前台命令手动转到后台后，本轮继续跑工具循环（与 Claude Code 对齐）", async () => {
    vi.mocked(mockMessageManager.getMessages).mockReturnValue(
      messagesWithBackgroundedTool(),
    );

    let callCount = 0;
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? toolCallResponse("call-1") : finalResponse();
    });

    const aiManager = new AIManager(createContainer(), {
      workdir: "/test/workdir",
      stream: false,
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // 转后台只是让那条命令继续在后台跑，本轮照常推进到下一次模型调用。
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });

  it("手动转后台后用户又中断，仍停在中断处（abort 语义不受影响）", async () => {
    vi.mocked(mockMessageManager.getMessages).mockReturnValue(
      messagesWithBackgroundedTool(),
    );

    let callCount = 0;
    const aiManagerRef: { current: AIManager | undefined } = {
      current: undefined,
    };
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        aiManagerRef.current?.abortAIMessage();
        return toolCallResponse("call-1");
      }
      return finalResponse();
    });

    const aiManager = new AIManager(createContainer(), {
      workdir: "/test/workdir",
      stream: false,
    });
    aiManagerRef.current = aiManager;

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(aiService.callAgent).toHaveBeenCalledTimes(1);
  });
});
