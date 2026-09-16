import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { Message } from "../../src/types/messaging.js";
import { renderCatalog } from "../../src/exec/catalog.js";
import type { RenderedCatalog } from "../../src/exec/catalog.js";
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

/** What a call to the model looked like, for asserting on the request payload. */
interface CallOptions {
  messages: Array<{ role: string; content: unknown }>;
  systemPrompt: unknown;
}

function createHarness(
  options: { catalogChannel: boolean } = { catalogChannel: true },
) {
  const container = new Container();
  const messages: Message[] = [];

  const mockMessageManager = {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn(() => [...messages]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn((params: { content: string; isMeta?: boolean }) => {
      messages.push({
        id: `m${messages.length}`,
        role: "user",
        timestamp: "2026-09-15T00:00:00.000Z",
        isMeta: params.isMeta,
        blocks: [{ type: "text", content: params.content }],
      });
      return `m${messages.length}`;
    }),
    updateCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    addErrorBlock: vi.fn(),
    setlatestTotalTokens: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compactMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    triggerFileRead: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    finalizeAbortedToolBlocks: vi.fn(),
  } as unknown as MessageManager;

  const mockToolManager: Record<string, unknown> = {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  };
  if (options.catalogChannel) {
    // Read once per turn: the test flips `catalogChannelState.catalog` between turns
    // to model a server connecting, the pool emptying, or Exec being switched off.
    mockToolManager.getExecCatalog = () => catalogChannelState.catalog;
  }

  container.register("ConfigurationService", {
    setOptions: vi.fn(),
    resolveGatewayConfig: vi.fn().mockReturnValue({
      apiKey: "test-api-key",
      baseURL: "https://test-gateway.com",
    } as GatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(MODEL_CONFIG),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  });
  container.register("MessageManager", mockMessageManager);
  container.register("ToolManager", mockToolManager as unknown as ToolManager);
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
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  container.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });
  // A double without the usage-notes channel: this suite is about the catalog, and
  // the guard there must simply skip it.
  container.register("McpManager", {});

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  return { aiManager, messages };
}

/** `undefined` here is the channel being closed (Exec undeclared). */
const catalogChannelState: { catalog: RenderedCatalog | undefined } = {
  catalog: undefined,
};

function catalogOf(counts: Record<string, number>): RenderedCatalog {
  return renderCatalog(
    Object.entries(counts).flatMap(([server, count]) =>
      Array.from({ length: count }, (_, index) => ({
        name: `mcp__${server}__tool${index}`,
      })),
    ),
    10_000,
  );
}

function callAgentReturningText() {
  vi.mocked(aiService.callAgent).mockImplementation(async () => ({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  }));
}

function announcements(messages: Message[]): Message[] {
  return messages.filter((message) =>
    message.blocks.some(
      (block) =>
        block.type === "text" && block.content.includes("exec-catalog"),
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

describe("AIManager MCP catalog announcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callAgentReturningText();
    catalogChannelState.catalog = undefined;
  });

  it("announces the catalog in the same request that can already use it, and keeps it out of the system prompt", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 2 });
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [announcement] = announcements(messages);
    expect(announcement?.isMeta).toBe(true);
    expect(textOf(announcement)).toContain("tools.mcp__alpha__tool0");

    // Same request: the snapshot is taken after the announcement is persisted.
    expect(JSON.stringify(lastCallOptions().messages)).toContain(
      "tools.mcp__alpha__tool0",
    );
    // And the prompt itself never carries it: the catalog is a function of the pool,
    // and rewriting the prompt would drop the whole cached prefix
    // (docs/specs/core/prompt-cache-control.md 边界情况 9).
    expect(JSON.stringify(lastCallOptions().systemPrompt)).not.toContain(
      "tools.mcp__alpha__tool0",
    );
  });

  it("announces a state once, not once per turn", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 2 });
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(1);
  });

  it("appends a new announcement when the pool changes, leaving every earlier message untouched", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 2 });
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    const before = messages.map((message) => JSON.stringify(message));

    catalogChannelState.catalog = catalogOf({ alpha: 2, beta: 3 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = announcements(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("tools.mcp__beta__tool0");
    // Only ever appended: nothing already sent is rewritten, so nothing already
    // cached is invalidated.
    expect(
      messages.slice(0, before.length).map((m) => JSON.stringify(m)),
    ).toEqual(before);
  });

  it("stays silent for an empty pool it has never announced, then reports it emptying", async () => {
    catalogChannelState.catalog = renderCatalog([], 10_000);
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    // With an empty pool `Exec` is not even declared, so a session with no MCP servers
    // must not pay a message describing a capability it never saw.
    expect(announcements(messages)).toHaveLength(0);

    catalogChannelState.catalog = catalogOf({ alpha: 1 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    expect(announcements(messages)).toHaveLength(1);

    catalogChannelState.catalog = renderCatalog([], 10_000);
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = announcements(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("No MCP tools are currently available");
    // Names no tool: with an empty pool `Exec` is not declared, so naming it would
    // point at a tool the model cannot call.
    expect(textOf(all[1])).not.toContain("Exec");
  });

  it("says the catalog no longer applies when the channel closes, and re-announces when it reopens", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 1 });
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    catalogChannelState.catalog = undefined;
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = announcements(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("no longer available");

    // Re-opening is not compared by content — a closed channel has no catalog to
    // hash, so going by content would leave the session mute for good.
    catalogChannelState.catalog = catalogOf({ alpha: 1 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    expect(announcements(messages)).toHaveLength(3);
  });

  it("announces the full catalog again after the history lost the marker", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 2 });
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    expect(announcements(messages)).toHaveLength(1);

    // Compaction (or a rewind): the announcement is no longer in the history, so the
    // next turn has nothing to compare against. A duplicate beats a loss.
    messages.splice(0, messages.length);
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(1);
  });

  it("does not read a quoted marker as an announcement that never happened", async () => {
    catalogChannelState.catalog = catalogOf({ alpha: 2 });
    const { aiManager, messages } = createHarness();
    messages.push({
      id: "reply",
      role: "assistant",
      timestamp: "2026-09-15T00:00:00.000Z",
      blocks: [
        {
          type: "text",
          content:
            'A marker looks like:\n\n<!-- exec-catalog {"k":"full","h":"deadbeefcafe"} -->',
        },
      ],
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // The unreadable-to-the-scan marker (a hash with no catalog behind it) cannot be
    // mistaken for the current state, so the catalog is still announced.
    const meta = announcements(messages.filter((message) => message.isMeta));
    expect(meta).toHaveLength(1);
    expect(textOf(meta[0])).toContain("tools.mcp__alpha__tool0");
  });

  it("tolerates a manager double without the catalog channel", async () => {
    // Reading an absent channel as "the catalog is gone" would tell the model to
    // stop using every tool an earlier catalog listed; calling through would take the
    // turn down.
    const { aiManager, messages } = createHarness({ catalogChannel: false });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    messages.push({
      id: "seed",
      role: "user",
      timestamp: "2026-09-15T00:00:00.000Z",
      isMeta: true,
      blocks: [
        {
          type: "text",
          content:
            '<!-- exec-catalog {"k":"full","h":"deadbeefcafe","t":0,"ns":{"alpha":2}} -->\n<system-reminder>\nMCP tools reachable…\n</system-reminder>',
        },
      ],
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(1);
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });
});
