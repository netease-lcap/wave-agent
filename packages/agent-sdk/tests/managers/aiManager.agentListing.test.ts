import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { SkillMetadata } from "../../src/types/skills.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { Message } from "../../src/types/messaging.js";
import * as aiService from "../../src/services/aiService.js";

/**
 * 子代理清单按会话下发（spec core/prompt-cache-control.md「子代理清单按会话
 * 下发，不占工具声明」）。
 *
 * 这条通道的判据与技能清单完全一致（`aiManager.skillListing.test.ts` 是同构的
 * 先例），所以这里只钉子代理自己的行为：清单进历史、不进 `tools[]`、只在集合
 * 变化时重发。
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

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn(),
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

const MODEL_CONFIG: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
} as ModelConfig;

interface CallOptions {
  messages: Array<{ role: string; content: unknown }>;
  systemPrompt: unknown;
}

/** The subagent set as the manager reports it; tests flip this between turns. */
const agentState: { configs: SubagentConfiguration[] } = { configs: [] };

function givenAgents(...configs: SubagentConfiguration[]): void {
  agentState.configs = configs;
}

function agent(
  name: string,
  description = `${name} does things`,
  scope: SubagentConfiguration["scope"] = "project",
): SubagentConfiguration {
  return {
    name,
    description,
    systemPrompt: "…",
    filePath: `/agents/${name}.md`,
    scope,
    priority: 0,
  };
}

function createHarness(options: { modManager?: unknown } = {}) {
  const container = new Container();
  const messages: Message[] = [];

  const messageManagerDouble: Record<string, unknown> = {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn(() => [...messages]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn((params: { content: string; isMeta?: boolean }) => {
      messages.push({
        id: `m${messages.length}`,
        role: "user",
        timestamp: "2026-10-01T00:00:00.000Z",
        isMeta: params.isMeta,
        blocks: [{ type: "text", content: params.content }],
      } satisfies Message);
    }),
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
  };
  const mockMessageManager = messageManagerDouble as unknown as MessageManager;

  container.register("ConfigurationService", {
    setOptions: vi.fn(),
    resolveGatewayConfig: vi.fn().mockReturnValue({
      apiKey: "test-api-key",
      baseURL: "https://test-gateway.com",
    } as GatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(MODEL_CONFIG),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  });
  container.register("MessageManager", mockMessageManager);
  container.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager);
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
    isToolDenied: vi.fn().mockReturnValue(false),
    clearTemporaryRules: vi.fn(),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  container.register("SubagentManager", {
    getConfigurations: vi.fn(() => agentState.configs),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([] as SkillMetadata[]),
  });
  container.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });
  container.register("McpManager", {});
  if (options.modManager) container.register("ModManager", options.modManager);

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  return { aiManager, messages };
}

function callAgentReturningText() {
  vi.mocked(aiService.callAgent).mockImplementation(async () => ({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  }));
}

function listings(messages: Message[]): Message[] {
  return messages.filter((message) =>
    message.blocks.some(
      (block) =>
        block.type === "text" && block.content.includes("agent-listing"),
    ),
  );
}

function textOf(message: Message): string {
  const [block] = message.blocks;
  return block.type === "text" ? block.content : "";
}

function lastCallOptions(): CallOptions {
  const calls = vi.mocked(aiService.callAgent).mock.calls;
  return calls[calls.length - 1][0] as unknown as CallOptions;
}

describe("AIManager subagent listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callAgentReturningText();
    agentState.configs = [];
  });

  it("列出可用子代理，且不在系统提示里重复一份", async () => {
    givenAgents(agent("reviewer", "reviews diffs"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [listing] = listings(messages);
    expect(listing?.isMeta).toBe(true);
    expect(textOf(listing)).toContain("- reviewer: reviews diffs (Tools: *)");

    // 请求里能看到（历史已持久化），但系统提示不带 —— 清单不该进缓存前缀。
    expect(JSON.stringify(lastCallOptions().messages)).toContain(
      "reviews diffs",
    );
    expect(JSON.stringify(lastCallOptions().systemPrompt)).not.toContain(
      "reviews diffs",
    );
  });

  it("同一份集合只下发一次", async () => {
    givenAgents(agent("reviewer", "reviews diffs"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(listings(messages)).toHaveLength(1);
  });

  it("集合变化后追加新清单，不动已有历史", async () => {
    givenAgents(agent("reviewer", "reviews diffs"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    const before = messages.map((message) => JSON.stringify(message));

    givenAgents(
      agent("reviewer", "reviews diffs"),
      agent("tester", "writes tests"),
    );
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = listings(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("- tester: writes tests");
    // 只追加、不改写：已经发出去的字节不变，缓存前缀才不会被击穿。
    expect(
      messages
        .slice(0, before.length)
        .map((message) => JSON.stringify(message)),
    ).toEqual(before);
  });

  it("最后一个子代理被删掉时说一句，而不是留着旧清单", async () => {
    givenAgents(agent("reviewer", "reviews diffs"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    givenAgents();
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = listings(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("No subagents are currently available");
  });

  it("agent.offer 说 false 的类型不入清单（清单这一次也算 offer）", async () => {
    givenAgents(
      agent("reviewer", "reviews diffs"),
      agent("tester", "writes tests"),
    );
    const dispatchAgentOffer = vi.fn(
      async (event: { agent: string }) => event.agent !== "tester",
    );
    const { aiManager, messages } = createHarness({
      modManager: {
        dispatchAgentOffer,
        notifyMods: vi.fn(),
        // 这一轮之前会先问一次「有没有插件要给会话加一段上下文」，缺了就抛。
        collectSessionContextBlocks: vi.fn(async () => []),
      },
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [listing] = listings(messages);
    expect(textOf(listing)).toContain("- reviewer: reviews diffs");
    expect(textOf(listing)).not.toContain("tester");
    expect(dispatchAgentOffer).toHaveBeenCalledWith({
      agent: "tester",
      description: "writes tests",
      source: "project",
    });
  });
});
