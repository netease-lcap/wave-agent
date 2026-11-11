import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { SkillMetadata } from "../../src/types/skills.js";
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

/** The skill set as the manager reports it; tests flip this between turns. */
const skillState: { skills: SkillMetadata[] } = { skills: [] };

/** Paths the file tools recorded, drained by the turn loop. */
const discoveryState: { filePaths: string[] } = { filePaths: [] };

function givenSkills(...skills: SkillMetadata[]): void {
  skillState.skills = skills;
}

function skill(
  name: string,
  description: string,
  extra: Partial<SkillMetadata> = {},
): SkillMetadata {
  return {
    name,
    description,
    type: "project",
    skillPath: `/skills/${name}`,
    ...extra,
  };
}

function createHarness(
  options: { subagentType?: string; discoveryChannel?: boolean } = {},
) {
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
      return `m${messages.length}`;
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
  if (options.discoveryChannel !== false) {
    // The queue the file tools fill in production; the test seeds it directly.
    messageManagerDouble.consumeSkillDiscoveryTriggers = vi.fn(() => {
      const drained = [...discoveryState.filePaths];
      discoveryState.filePaths.length = 0;
      return drained;
    });
  }
  const mockMessageManager = messageManagerDouble as unknown as MessageManager;

  const skillManager: {
    getAvailableSkills: Mock;
    discoverNestedSkills?: Mock;
  } = {
    getAvailableSkills: vi.fn(() => skillState.skills),
    discoverNestedSkills: vi.fn().mockResolvedValue(true),
  };
  if (options.discoveryChannel === false) {
    // A manager double with no subtree channel at all.
    skillManager.discoverNestedSkills = undefined;
  }

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
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", skillManager);
  container.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });
  container.register("McpManager", {});

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
    subagentType: options.subagentType,
  });

  return { aiManager, messages, skillManager };
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
        block.type === "text" && block.content.includes("skill-listing"),
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

describe("AIManager skill listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callAgentReturningText();
    skillState.skills = [];
    discoveryState.filePaths = [];
  });

  it("lists the available skills in the same request that can already call them", async () => {
    givenSkills(skill("deploy", "ship it"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [listing] = listings(messages);
    expect(listing?.isMeta).toBe(true);
    expect(textOf(listing)).toContain("- deploy: ship it");

    // The snapshot is taken after the listing is persisted.
    expect(JSON.stringify(lastCallOptions().messages)).toContain("ship it");
    // And the prompt never carries it: the skill set changes mid-session, and
    // rewriting a prompt that sits in the cached prefix would drop that prefix.
    expect(JSON.stringify(lastCallOptions().systemPrompt)).not.toContain(
      "ship it",
    );
  });

  it("lists a state once, not once per turn", async () => {
    givenSkills(skill("deploy", "ship it"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(listings(messages)).toHaveLength(1);
  });

  it("appends a new listing when a skill is added, leaving earlier messages untouched", async () => {
    givenSkills(skill("deploy", "ship it"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    const before = messages.map((message) => JSON.stringify(message));

    givenSkills(skill("deploy", "ship it"), skill("release", "cut a release"));
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = listings(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("- release: cut a release");
    // Only ever appended: nothing already sent is rewritten, so nothing already
    // cached is invalidated.
    expect(
      messages
        .slice(0, before.length)
        .map((message) => JSON.stringify(message)),
    ).toEqual(before);
  });

  it("corrects the list when the last skill is removed", async () => {
    givenSkills(skill("deploy", "ship it"));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    givenSkills();
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const all = listings(messages);
    expect(all).toHaveLength(2);
    expect(textOf(all[1])).toContain("No skills are currently available");
  });

  it("stays silent for a session that has no skills at all", async () => {
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // Most sessions list no skills; telling them about a list they never saw is
    // pure noise in the cached prefix.
    expect(listings(messages)).toHaveLength(0);
  });

  it("leaves out skills the model may not invoke", async () => {
    givenSkills(
      skill("deploy", "ship it"),
      skill("internal-notes", "notes for humans", {
        disableModelInvocation: true,
      }),
    );
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    const [listing] = listings(messages);
    expect(textOf(listing)).toContain("- deploy: ship it");
    expect(textOf(listing)).not.toContain("internal-notes");
  });

  it("does not offer a fork-context skill to a subagent", async () => {
    givenSkills(
      skill("deploy", "ship it"),
      skill("deep-dive", "spawn a subagent", { context: "fork" }),
    );
    const { aiManager, messages } = createHarness({ subagentType: "explore" });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // A subagent has no subagent of its own to fork into.
    const [listing] = listings(messages);
    expect(textOf(listing)).toContain("- deploy: ship it");
    expect(textOf(listing)).not.toContain("deep-dive");
  });

  it("offers fork-context skills to the main conversation", async () => {
    givenSkills(skill("deep-dive", "spawn a subagent", { context: "fork" }));
    const { aiManager, messages } = createHarness();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(textOf(listings(messages)[0])).toContain("- deep-dive");
  });

  it("discovers subtree skills from the recorded file paths before listing them", async () => {
    const { aiManager, messages, skillManager } = createHarness();
    discoveryState.filePaths = ["/test/workdir/packages/api/src/a.ts"];
    const discoverNestedSkills = skillManager.discoverNestedSkills!;
    discoverNestedSkills.mockImplementation(async () => {
      // What a real discovery run does: the newly loaded skills are visible by
      // the time the listing is built.
      givenSkills(skill("api-deploy", "deploy this service"));
      return true;
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(discoverNestedSkills).toHaveBeenCalledWith([
      "/test/workdir/packages/api/src/a.ts",
    ]);
    // Same request: a model that just walked into a subsystem sees that
    // subsystem's skills immediately, without an extra round-trip.
    expect(JSON.stringify(lastCallOptions().messages)).toContain("api-deploy");
    expect(listings(messages)).toHaveLength(1);
  });

  it("finishes the turn when subtree discovery fails", async () => {
    const { aiManager, messages, skillManager } = createHarness();
    discoveryState.filePaths = ["/test/workdir/packages/api/src/a.ts"];
    skillManager.discoverNestedSkills!.mockRejectedValue(new Error("EACCES"));

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(aiService.callAgent).toHaveBeenCalledTimes(1);
    expect(listings(messages)).toHaveLength(0);
  });

  it("drains the trigger queue once, so a turn does not rediscover what it just did", async () => {
    const { aiManager, skillManager } = createHarness();
    discoveryState.filePaths = ["/test/workdir/a.ts"];

    await aiManager.sendAIMessage({ recursionDepth: 0 });
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(skillManager.discoverNestedSkills!).toHaveBeenCalledTimes(1);
  });

  it("survives a manager double without the subtree channel", async () => {
    givenSkills(skill("deploy", "ship it"));
    discoveryState.filePaths = ["/test/workdir/a.ts"];
    const { aiManager, messages } = createHarness({ discoveryChannel: false });

    // Reading absence as fatal would take the turn down over a feature the
    // double simply lacks; reading it as "nothing triggered" is the honest
    // answer.
    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(aiService.callAgent).toHaveBeenCalledTimes(1);
    expect(listings(messages)).toHaveLength(1);
  });
});
