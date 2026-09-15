import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { Message } from "../../src/types/messaging.js";
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

function createHarness(mcpManager: unknown) {
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

  const mockToolManager = {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager;

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
  container.register("ToolManager", mockToolManager);
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
  container.register("McpManager", mcpManager);

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  return { aiManager, messages };
}

/** A live MCP manager double: `mcpDoubleState.available` is what a turn reads. */
function mcpDouble() {
  return {
    getServerInstructions: vi.fn(() =>
      mcpDoubleState.available.map((entry) => ({ ...entry })),
    ),
  };
}

// `getServerInstructions` is read once per turn; the test flips this between
// turns to model a server connecting or going away mid-session.
const mcpDoubleState: {
  available: Array<{ name: string; instructions: string }>;
} = { available: [] };

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
        block.type === "text" && block.content.includes("mcp-instructions"),
    ),
  );
}

function lastCallOptions(): CallOptions {
  const calls = vi.mocked(aiService.callAgent).mock.calls;
  return calls[calls.length - 1][0] as unknown as CallOptions;
}

describe("AIManager MCP usage notes announcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callAgentReturningText();
    mcpDoubleState.available = [];
  });

  it("announces a server's notes in the same request that can already use it, and keeps them out of the system prompt", async () => {
    mcpDoubleState.available = [
      { name: "guide", instructions: "Use lookup before mutate." },
    ];
    const { aiManager, messages } = createHarness(mcpDouble());

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [announcement] = announcements(messages);
    expect(announcement?.isMeta).toBe(true);
    const text = announcement.blocks[0];
    expect(text.type === "text" && text.content).toContain(
      "Use lookup before mutate.",
    );
    expect(text.type === "text" && text.content).toContain(
      '<server name="guide">',
    );

    // Same request: the snapshot is taken after the announcement is persisted.
    expect(JSON.stringify(lastCallOptions().messages)).toContain(
      "Use lookup before mutate.",
    );
    // And the prompt itself never carries it: a connection must not rewrite the
    // cached prefix (docs/specs/core/prompt-cache-control.md 边界情况 10).
    expect(JSON.stringify(lastCallOptions().systemPrompt)).not.toContain(
      "Use lookup before mutate.",
    );
  });

  it("announces a server once, not once per turn", async () => {
    mcpDoubleState.available = [
      { name: "guide", instructions: "Use lookup before mutate." },
    ];
    const { aiManager, messages } = createHarness(mcpDouble());

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(1);
  });

  it("announces a server that went away, once, and does not repeat its notes", async () => {
    mcpDoubleState.available = [
      { name: "guide", instructions: "Use lookup before mutate." },
    ];
    const { aiManager, messages } = createHarness(mcpDouble());

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    mcpDoubleState.available = [];
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = announcements(messages);
    expect(all).toHaveLength(2);
    const departure = all[1].blocks[0];
    expect(departure.type === "text" && departure.content).toContain(
      "no longer apply",
    );
    expect(departure.type === "text" && departure.content).toContain("guide");
  });

  it("says nothing when there is nothing to say", async () => {
    const { aiManager, messages } = createHarness(mcpDouble());

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(0);
  });

  it("does not read a quoted marker as a connection that never happened", async () => {
    // The reply that explains this mechanism quotes a marker verbatim. Reading it
    // as state made the history claim a server had been announced, so the next
    // turn announced a departure for a server that was never there.
    const { aiManager, messages } = createHarness(mcpDouble());
    messages.push({
      id: "reply",
      role: "assistant",
      timestamp: "2026-09-15T00:00:00.000Z",
      blocks: [
        {
          type: "text",
          content:
            'A marker looks like:\n\n<!-- mcp-instructions {"added":["guide"],"removed":[]} -->',
        },
      ],
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages.filter((m) => m.isMeta))).toHaveLength(0);
  });

  it("tolerates a manager double without the usage-notes channel", async () => {
    // Hosts and tests register partial McpManager doubles; reading absence as
    // "every server left" would announce departures that never happened — and
    // calling through would take the turn down.
    const { aiManager, messages } = createHarness({});
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
            '<!-- mcp-instructions {"added":["guide"],"removed":[]} -->\n<system-reminder>\n<mcp_instructions>\n...\n</mcp_instructions>\n</system-reminder>',
        },
      ],
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(announcements(messages)).toHaveLength(1);
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });
});
