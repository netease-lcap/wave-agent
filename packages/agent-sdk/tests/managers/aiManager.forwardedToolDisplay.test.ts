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

/**
 * A forwarded call has to be shown as the leaf it hit, not as `ToolInvoke`:
 * 「用户必须能看到该次调用实际命中哪个叶子工具及其结果」. The tool block is what
 * every host renders, so that is where the address has to land.
 */
describe("aiManager: forwarded tool calls display their leaf address", () => {
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

  async function runToolCall(
    toolCallName: string,
    toolCallArguments: string,
  ): Promise<{
    updates: ToolBlockUpdateCallbackParams[];
    executedWith: string[];
  }> {
    const container = createContainer();

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

    const toolManager = new ToolManager({ container });
    toolManager.initializeBuiltInTools();
    const executeSpy = vi.spyOn(toolManager, "execute").mockResolvedValue({
      success: true,
      content: "leaf ran",
      shortResult: "leaf ran",
    });
    container.register("ToolManager", toolManager);

    vi.mocked(aiService.callAgent).mockImplementationOnce(async (options) => {
      options.onToolUpdate?.({
        id: "call_1",
        name: toolCallName,
        parameters: toolCallArguments,
        parametersChunk: toolCallArguments,
        stage: "start",
      });
      return {
        content: "",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: toolCallName, arguments: toolCallArguments },
          },
        ],
      };
    });
    vi.mocked(aiService.callAgent).mockImplementation(async () => ({
      content: "done",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      tool_calls: [],
    }));

    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });
    await aiManager.sendAIMessage();
    return {
      updates: capturedUpdates,
      executedWith: executeSpy.mock.calls.map((call) => String(call[0])),
    };
  }

  it("shows the MCP leaf address for a ToolInvoke call", async () => {
    const { updates, executedWith } = await runToolCall(
      "ToolInvoke",
      JSON.stringify({
        namespace: "github",
        tool: "create_issue",
        args: { title: "bug" },
      }),
    );

    const executionStages = updates.filter(
      (update) => update.stage !== "streaming",
    );
    expect(executionStages.length).toBeGreaterThan(0);
    for (const update of executionStages) {
      expect(update.name).toBe("github.create_issue");
    }
    // Display only: the call still goes out under the mechanism tool's name.
    expect(executedWith).toEqual(["ToolInvoke"]);
  });

  it("shows the built-in leaf address for a forwarded built-in call", async () => {
    const { updates } = await runToolCall(
      "ToolInvoke",
      JSON.stringify({
        namespace: "builtin",
        tool: "WebFetch",
        args: { url: "https://example.com" },
      }),
    );

    const last = updates[updates.length - 1];
    expect(last.name).toBe("builtin.WebFetch");
  });

  it("leaves a directly declared tool's name alone", async () => {
    const { updates, executedWith } = await runToolCall(
      "Bash",
      JSON.stringify({ command: "ls" }),
    );

    const last = updates[updates.length - 1];
    expect(last.name).toBe("Bash");
    expect(executedWith).toEqual(["Bash"]);
  });
});
