import { describe, it, expect, vi } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { Message, ToolBlock } from "../../src/types/messaging.js";
import type { ToolResult } from "../../src/tools/types.js";
import * as aiService from "../../src/services/aiService.js";

/**
 * issue #3055 阶段 2：工具结果的**落盘字段**与**模型侧文本**的分工。
 *
 * 口径（`AIManager.executeToolCall`）：`data` 能重建出这段文本时只落 `data`，文本由
 * 读路径（`utils/toolBlockText.ts` → `tools/resultData/` 的渲染器）现场生成；表外
 * 工具（没有渲染器）与「事后追加了提示」的分支必须继续落 `result`，否则那段结果就
 * 没了。这里的期望值是手写字面量，不从渲染器抄。
 */

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

const GATEWAY: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "https://test-gateway.com",
};
const MODEL: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
};

function createContainer() {
  const container = new Container();
  container.register("ConfigurationService", {
    setOptions: vi.fn(),
    resolveGatewayConfig: vi.fn().mockReturnValue(GATEWAY),
    resolveModelConfig: vi.fn().mockReturnValue(MODEL),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
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
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
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
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
    isMcpTool: vi.fn().mockReturnValue(false),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  });
  container.register("BackgroundTaskManager", {
    listTasks: vi.fn().mockReturnValue([]),
    getAllTasks: vi.fn().mockReturnValue([]),
  });
  container.register("HookManager", undefined);
  container.register("ReversionManager", undefined);
  container.register("PlanManager", undefined);
  return container;
}

/** 让模型这一轮只要一次工具调用，之后收口成一句话。 */
function askForTool(name: string, args: string) {
  vi.mocked(aiService.callAgent).mockImplementationOnce(async () => ({
    content: "",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name, arguments: args },
      },
    ],
  }));
  vi.mocked(aiService.callAgent).mockImplementationOnce(async () => ({
    content: "done",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    tool_calls: [],
  }));
}

/** 跑一轮，返回工具块与「模型在第二轮请求里读到的 tool_result 文本」。 */
async function runToolTurn(toolName: string, result: ToolResult, args = "{}") {
  const container = createContainer();
  const messageManager = new MessageManager(container, {
    workdir: "/test/workdir",
    callbacks: {},
  });
  container.register("MessageManager", messageManager);

  const toolManager = new ToolManager({ container });
  toolManager.initializeBuiltInTools();
  vi.spyOn(toolManager, "execute").mockResolvedValue(result);
  container.register("ToolManager", toolManager);

  askForTool(toolName, args);

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });
  await aiManager.sendAIMessage();

  const toolBlock = messageManager
    .getMessages()
    .flatMap((message: Message) => message.blocks)
    .find((block): block is ToolBlock => block.type === "tool");

  // 第二轮请求就是「模型这次读到的工具结果」：convertMessagesForAPI 把 tool 块
  // 变成 `role: "tool"` 的消息。
  const secondRequest = vi.mocked(aiService.callAgent).mock.calls[1]?.[0];
  const toolMessage = (
    secondRequest?.messages as
      | Array<{ role: string; content?: unknown }>
      | undefined
  )?.find((message) => message.role === "tool");

  return { toolBlock, modelText: toolMessage?.content };
}

describe("aiManager: 工具结果只落 data，模型侧文本现场渲染", () => {
  it("有渲染器的内置工具：只落 data，模型读到渲染结果而不是 content", async () => {
    const { toolBlock, modelText } = await runToolTurn(
      "Grep",
      {
        success: true,
        // 故意与 data 的渲染结果不同：模型必须读到渲染结果。
        content: "工具当场写好的那段文本",
        data: {
          mode: "files_with_matches",
          numFiles: 2,
          filenames: ["a.ts", "b.ts"],
        },
      },
      '{"pattern":"TODO"}',
    );

    expect(toolBlock?.data).toEqual({
      mode: "files_with_matches",
      numFiles: 2,
      filenames: ["a.ts", "b.ts"],
    });
    expect(toolBlock?.result).toBeUndefined();
    expect(modelText).toBe("Found 2 files\na.ts\nb.ts");
  });

  it("data 缺席（老形态的工具结果）：退回 content，并原样落 result", async () => {
    const { toolBlock, modelText } = await runToolTurn(
      "Grep",
      {
        success: true,
        content: "Found 1 file\nlegacy.ts",
      },
      '{"pattern":"TODO"}',
    );

    expect(toolBlock?.data).toBeUndefined();
    expect(toolBlock?.result).toBe("Found 1 file\nlegacy.ts");
    expect(modelText).toBe("Found 1 file\nlegacy.ts");
  });

  it("表外工具（MCP）：没有渲染器，必须继续落 result", async () => {
    const { toolBlock, modelText } = await runToolTurn("mcp__demo__search", {
      success: true,
      content: "mcp hit 1\nmcp hit 2",
    });

    expect(toolBlock?.data).toBeUndefined();
    expect(toolBlock?.result).toBe("mcp hit 1\nmcp hit 2");
    expect(modelText).toBe("mcp hit 1\nmcp hit 2");
  });

  it("工具参数被截断后恢复：data 重建不出那句提示，仍落 result", async () => {
    const { toolBlock, modelText } = await runToolTurn(
      "Grep",
      {
        success: true,
        content: "Found 1 file\nb.ts",
        data: {
          mode: "files_with_matches",
          numFiles: 1,
          filenames: ["b.ts"],
        },
      },
      // 少了收尾的 `}`：aiManager 会补回来并标记 jsonRecovered。
      '{"pattern":"TODO","path":"src"',
    );

    expect(toolBlock?.data).toBeUndefined();
    expect(toolBlock?.result).toBe(
      "Found 1 file\nb.ts\n\nTool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls.",
    );
    expect(modelText).toBe(
      "Found 1 file\nb.ts\n\nTool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls.",
    );
  });
});
