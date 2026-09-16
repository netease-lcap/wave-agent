import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { Message } from "../../src/types/messaging.js";
import type { NestedMemoryFile } from "../../src/utils/nestedMemory.js";
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

function createHarness() {
  const container = new Container();
  const messages: Message[] = [];

  // What a read has queued up since the last request. Flipped by the tests to
  // model the real flow: a Read runs as a tool call, the next request pulls it
  // in. Collecting drains it, like the real MessageManager does.
  const nestedMemoryQueue: NestedMemoryFile[] = [];
  const collectNestedMemoryFiles = vi.fn(async () =>
    nestedMemoryQueue.splice(0),
  );

  const mockMessageManager = {
    collectNestedMemoryFiles,
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn(() => [...messages]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn((params: { content: string; isMeta?: boolean }) => {
      messages.push({
        id: `m${messages.length}`,
        role: "user",
        timestamp: "2026-09-16T00:00:00.000Z",
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

  // The nested-memory trigger is a Read side effect, so the turn needs a real
  // tool round: the model asks for Read, the result comes back, and the loop
  // issues a follow-up request.
  const readToolConfig = {
    type: "function",
    function: { name: "Read", description: "Read a file", parameters: {} },
  };
  const mockToolManager = {
    getToolsConfig: vi.fn().mockReturnValue([readToolConfig]),
    getTools: vi
      .fn()
      .mockReturnValue([{ name: "Read", description: "Read a file" }]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ success: true, content: "read ok" }),
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

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  return { aiManager, messages, nestedMemoryQueue };
}

/**
 * The model asks for a Read; the tool runs as part of handling that response,
 * so its nested-memory side effect only exists from the next round on.
 */
function readToolCall(
  nestedMemoryQueue: NestedMemoryFile[],
  ...files: NestedMemoryFile[]
) {
  vi.mocked(aiService.callAgent).mockImplementationOnce(async () => {
    nestedMemoryQueue.push(...files);
    return {
      content: "Reading the file",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "Read", arguments: '{"file_path":"a.ts"}' },
        },
      ],
      finish_reason: "tool_calls",
    };
  });
}

function textReply() {
  vi.mocked(aiService.callAgent).mockResolvedValueOnce({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    tool_calls: [],
  });
}

function requestPayload(callIndex: number): string {
  const call = vi.mocked(aiService.callAgent).mock.calls[callIndex][0];
  return JSON.stringify(call);
}

function noRequestContains(text: string): boolean {
  return vi
    .mocked(aiService.callAgent)
    .mock.calls.every((call) => !JSON.stringify(call[0]).includes(text));
}

function nestedMemoryMessages(messages: Message[]): Message[] {
  return messages.filter(
    (message) =>
      message.isMeta &&
      message.blocks.some(
        (block) =>
          block.type === "text" && block.content.includes("Contents of "),
      ),
  );
}

describe("AIManager nested memory injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects a memory file read during this turn into the follow-up request", async () => {
    const { aiManager, messages, nestedMemoryQueue } = createHarness();
    readToolCall(nestedMemoryQueue, {
      path: "/test/workdir/packages/foo/AGENTS.md",
      content: "foo conventions",
    });
    textReply();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const injected = nestedMemoryMessages(messages);
    expect(injected).toHaveLength(1);
    expect(injected[0].blocks[0]).toEqual({
      type: "text",
      content:
        "<system-reminder>\nContents of /test/workdir/packages/foo/AGENTS.md:\n\nfoo conventions\n</system-reminder>",
    });

    // The request that issued the read did not carry it...
    expect(requestPayload(0)).not.toContain("foo conventions");
    // ...the follow-up one does (the injection point runs before the snapshot).
    expect(requestPayload(1)).toContain("foo conventions");
  });

  it("injects nothing when no nested memory was triggered", async () => {
    const { aiManager, messages } = createHarness();
    textReply();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(nestedMemoryMessages(messages)).toHaveLength(0);
    expect(noRequestContains("Contents of ")).toBe(true);
  });

  it("keeps the ancestor-to-leaf order the collector produced", async () => {
    const { aiManager, messages, nestedMemoryQueue } = createHarness();
    textReply();
    nestedMemoryQueue.push(
      { path: "/test/workdir/packages/AGENTS.md", content: "packages memory" },
      {
        path: "/test/workdir/packages/foo/AGENTS.md",
        content: "foo memory",
      },
    );

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const injected = nestedMemoryMessages(messages);
    expect(injected.map((message) => message.blocks[0])).toEqual([
      {
        type: "text",
        content:
          "<system-reminder>\nContents of /test/workdir/packages/AGENTS.md:\n\npackages memory\n</system-reminder>",
      },
      {
        type: "text",
        content:
          "<system-reminder>\nContents of /test/workdir/packages/foo/AGENTS.md:\n\nfoo memory\n</system-reminder>",
      },
    ]);
  });

  it("injects on later turns too — dedup is the collector's job, not this layer's", async () => {
    const { aiManager, messages, nestedMemoryQueue } = createHarness();
    textReply();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    nestedMemoryQueue.push({
      path: "/test/workdir/packages/bar/AGENTS.md",
      content: "bar memory",
    });
    textReply();
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const injectedTexts = nestedMemoryMessages(messages).map(
      (message) => message.blocks[0],
    );
    expect(injectedTexts).toHaveLength(1);
    expect(injectedTexts[0]).toEqual({
      type: "text",
      content:
        "<system-reminder>\nContents of /test/workdir/packages/bar/AGENTS.md:\n\nbar memory\n</system-reminder>",
    });
    expect(requestPayload(1)).toContain("bar memory");
  });
});
