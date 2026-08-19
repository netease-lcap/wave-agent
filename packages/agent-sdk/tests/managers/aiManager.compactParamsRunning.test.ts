import { describe, it, expect, vi } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { ToolBlockUpdateCallbackParams } from "../../src/utils/messageOperations.js";
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
  compactMessages: vi.fn(),
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

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("aiManager: running-stage tool block updates carry compactParams", () => {
  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };
  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
  };

  function createContainer() {
    const container = new Container();
    container.register("ConfigurationService", {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
      getMergedEnv: vi.fn().mockReturnValue({}),
    });
    container.register("TaskManager", {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    });
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
      isToolDenied: vi.fn().mockReturnValue(false),
    });
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
    container.register("ForegroundTaskManager", {});
    container.register("LspManager", {});
    container.register("McpManager", {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    });
    container.register("BackgroundTaskManager", {
      listTasks: vi.fn().mockReturnValue([]),
    });
    container.register("HookManager", undefined);
    container.register("ReversionManager", undefined);
    container.register("PlanManager", undefined);
    return container;
  }

  it("shortResult/result running events include compactParams + name after streaming", async () => {
    const container = createContainer();

    // Real MessageManager; capture every onToolBlockUpdated callback param,
    // which is exactly what CLI/desktop/vsce consumers subscribe to.
    const capturedUpdates: ToolBlockUpdateCallbackParams[] = [];
    const messageManager = new MessageManager(container, {
      workdir: "/test/workdir",
      callbacks: {
        onToolBlockUpdated: (params) => {
          capturedUpdates.push(params);
        },
      },
    });
    container.register("MessageManager", messageManager);

    // Real ToolManager with agentTool registered so generateCompactParams
    // resolves "explore: find foo" instead of silently returning "".
    const toolManager = new ToolManager({ container });
    toolManager.initializeBuiltInTools();
    vi.spyOn(toolManager, "execute").mockImplementation(
      async (_name, _args, context) => {
        // Emit running-stage progress updates like a real subagent does.
        context.onShortResultUpdate?.("step 1: searching");
        context.onResultUpdate?.("progress output");
        return {
          success: true,
          content: "found foo",
          shortResult: "found foo",
        };
      },
    );
    container.register("ToolManager", toolManager);

    // Simulate streaming tool call deltas, then the resolved tool_calls.
    vi.mocked(aiService.callAgent).mockImplementationOnce(async (options) => {
      if (options.onToolUpdate) {
        options.onToolUpdate({
          id: "call_1",
          name: "Agent",
          parameters: "",
          parametersChunk: "",
          stage: "start",
        });
        options.onToolUpdate({
          id: "call_1",
          name: "Agent",
          parameters: '{"subagent_type":"explore"',
          parametersChunk: '{"subagent_type":"explore"',
          stage: "streaming",
        });
        options.onToolUpdate({
          id: "call_1",
          name: "Agent",
          parameters: '{"subagent_type":"explore","description":"find foo"',
          parametersChunk: ',"description":"find foo"',
          stage: "streaming",
        });
        options.onToolUpdate({
          id: "call_1",
          name: "Agent",
          parameters:
            '{"subagent_type":"explore","description":"find foo","prompt":"find foo in codebase"}',
          parametersChunk: ',"prompt":"find foo in codebase"}',
          stage: "streaming",
        });
      }
      return {
        content: "",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "Agent",
              arguments:
                '{"subagent_type":"explore","description":"find foo","prompt":"find foo in codebase"}',
            },
          },
        ],
      };
    });
    // Subsequent calls (loop restart) return no tool calls.
    vi.mocked(aiService.callAgent).mockImplementation(async () => ({
      content: "done",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      tool_calls: [],
    }));

    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: true,
    });
    await aiManager.sendAIMessage();

    // Progress updates (shortResult/result) during running stage must carry
    // compactParams + name: consumers throttle with last-value-wins and would
    // otherwise lose the single compactParams-carrying running update.
    const runningUpdates = capturedUpdates.filter((u) => u.stage === "running");
    const progressUpdates = runningUpdates.filter(
      (u) => u.shortResult !== undefined || u.result !== undefined,
    );
    expect(progressUpdates.length).toBeGreaterThan(0);
    for (const u of progressUpdates) {
      expect(u.compactParams).toBe("explore: find foo");
      expect(u.name).toBe("Agent");
    }
  });
});
