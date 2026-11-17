import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { callAgent } from "../../src/services/aiService.js";
import { isLeanPromptEnabled } from "../../src/services/leanPrompt.js";
import { TONE_AND_STYLE_PROMPT } from "../../src/prompts/index.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type {
  GatewayConfig,
  ModelConfig,
  Skill,
} from "../../src/types/index.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { ModPromptSection } from "../../src/types/mods.js";

/**
 * `prompt.compose` / `prompt.section` / `prompt.context` / `prompt.attachment` /
 * `skill.prompt`（spec ecosystem/plugin-mods.md「系统提示词与附件」与「给工具、
 * 技能、命令写描述」）。
 *
 * 这里钉的是宿主这一侧的行为：段表怎么切、`null` 怎么理解、一条会话只问一次、
 * 每个注入点用的是哪个 `type`，以及「一段都没改时必须逐字相同」这条缓存前提。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("../../src/utils/gitUtils.js", () => ({ isGitRepository: vi.fn() }));

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
  // 每次一个新数组：`buildHarness` 复用它，返回同一个实例会让上一轮 prepend 的
  // 残留串到这一轮里。
  convertMessagesForAPI: vi.fn(() => []),
}));

// 提示词分档由这里决定：默认档（lean）没有 `tone` / `tools` 段，而验收场景 1
// 改的就是 `tone`，所以测试默认按全量档跑，另有一个用例专门钉 lean 档的段表。
vi.mock("../../src/services/leanPrompt.js", () => ({
  LEAN_PROMPT_DEFAULT_ENABLED: true,
  isLeanPromptEnabled: vi.fn(() => false),
}));

const WORKDIR = "/test/workdir";
const MEMORY_TEXT = "AGENTS.md：本仓库只用 pnpm";

const mockGatewayConfig: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "https://test-gateway.com",
};

const mockModelConfig: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
};

const REPLY = {
  content: "answer",
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  tool_calls: [],
};

type PromptMods = {
  collectPromptSections: ReturnType<typeof vi.fn>;
  collectPromptSection: ReturnType<typeof vi.fn>;
  collectSessionContextBlocks: ReturnType<typeof vi.fn>;
  rewritePromptAttachment: ReturnType<typeof vi.fn>;
  collectSkillText: ReturnType<typeof vi.fn>;
  notifyMods: ReturnType<typeof vi.fn>;
  collectStopContext: ReturnType<typeof vi.fn>;
  // 工具跑完撤掉贴在它下面的 notice（spec「工具行下面的一行」）。这个用例集
  // 不关心这件事，但缺了方法会让调用点抛错，整轮工具的后续被静默中断。
  clearToolNotices: ReturnType<typeof vi.fn>;
};

/**
 * 一个「什么都不改」的 ModManager：每个钩子都把宿主给的原文原样还回去，个别用
 * 例只覆盖关心那一个。
 */
function buildMods(overrides: Partial<PromptMods> = {}): PromptMods {
  return {
    collectPromptSections: vi.fn(async (base: readonly ModPromptSection[]) => [
      ...base,
    ]),
    collectPromptSection: vi.fn(
      async (section: ModPromptSection) => section.text,
    ),
    collectSessionContextBlocks: vi.fn(async () => []),
    rewritePromptAttachment: vi.fn(
      async (attachment: { type: string; text: string }) => attachment.text,
    ),
    collectSkillText: vi.fn(async (skill: { text: string }) => skill.text),
    notifyMods: vi.fn(),
    collectStopContext: vi.fn(async () => [] as string[]),
    clearToolNotices: vi.fn(),
    ...overrides,
  };
}

function buildMockMessageManager(messages: unknown[] = []): MessageManager {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue(messages),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn().mockReturnValue("msg-id"),
    addNotificationMessage: vi.fn(),
    appendCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    getMemoryForInjection: vi
      .fn()
      .mockResolvedValue({ prependContent: MEMORY_TEXT }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    collectNestedMemoryFiles: vi.fn().mockResolvedValue([]),
    addNoticeBlock: vi.fn(),
    setlatestTotalTokens: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compactMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    triggerFileRead: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    finalizeAbortedToolBlocks: vi.fn(),
  } as unknown as MessageManager;
}

/** 一个声明了 Bash 的工具集：`# Using your tools` 这一段才存在。 */
function buildMockToolManager(): ToolManager {
  return {
    getToolsConfig: vi
      .fn()
      .mockReturnValue([
        { type: "function", function: { name: "Bash", description: "run" } },
      ]),
    getTools: vi.fn().mockReturnValue([{ name: "Bash" }]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ success: true, content: "ok" }),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
    getOnDemandToolNames: vi.fn().mockReturnValue([]),
  } as unknown as ToolManager;
}

function buildHarness(
  options: {
    mods?: PromptMods | null;
    messages?: unknown[];
    subagentManager?: unknown;
  } = {},
) {
  const container = new Container();
  container.register("MessageQueue", new MessageQueue());
  container.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
  });
  const messageManager = buildMockMessageManager(options.messages ?? []);
  container.register("MessageManager", messageManager);
  container.register("ToolManager", buildMockToolManager());
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
  });
  container.register(
    "SubagentManager",
    options.subagentManager ?? {
      getConfigurations: vi.fn().mockReturnValue([]),
    },
  );
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });

  const mods = options.mods === null ? null : (options.mods ?? buildMods());
  if (mods) container.register("ModManager", mods as unknown as ModManager);

  const aiManager = new AIManager(container, {
    workdir: WORKDIR,
    stream: false,
  });

  return { aiManager, container, messageManager, mods };
}

/** 这一轮实际发给模型的系统提示词块。 */
function sentSystemPrompt() {
  const calls = vi.mocked(callAgent).mock.calls;
  return calls[calls.length - 1][0].systemPrompt as {
    text: string;
    cacheable: boolean;
  }[];
}

/** 这一轮请求里被 prepend 进消息数组的那条（记忆注入）。 */
function sentMessages() {
  const calls = vi.mocked(callAgent).mock.calls;
  return (calls[calls.length - 1][0].messages ?? []) as {
    role: string;
    content: string;
  }[];
}

function addedUserMessages(messageManager: MessageManager): string[] {
  return vi
    .mocked(messageManager.addUserMessage)
    .mock.calls.map((call) => call[0].content)
    .filter((content): content is string => typeof content === "string");
}

function userMessage(content: string) {
  return {
    id: "user-1",
    role: "user",
    blocks: [{ type: "text", content }],
  };
}

const EXPLORE_SUBAGENTS = {
  getConfigurations: vi.fn().mockReturnValue([{ name: "explore" }]),
};

describe("AIManager 的 prompt.* 钩子", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    vi.mocked(isLeanPromptEnabled).mockReturnValue(false);
  });

  it("lean 档按同样的段表拼：session 段是 identity / security / harness，没有 tone 与 tools", async () => {
    vi.mocked(isLeanPromptEnabled).mockReturnValue(true);
    const mods = buildMods();
    const { aiManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();

    expect(
      mods.collectPromptSection.mock.calls.map((call) => call[0].id),
    ).toEqual(["identity", "security", "harness", "env", "memory"]);
  });

  it("prompt.section 改一段：只有那一段变，其余一字未变，一段一轮只问一次", async () => {
    const baseline = buildHarness({ mods: null });
    await baseline.aiManager.sendAIMessage();
    const before = sentSystemPrompt();

    const mods = buildMods({
      collectPromptSection: vi.fn(async (section: ModPromptSection) =>
        section.id === "tone" ? "只用中文回答。" : section.text,
      ),
    });
    const { aiManager } = buildHarness({ mods });
    await aiManager.sendAIMessage();

    const blocks = sentSystemPrompt();
    expect(blocks[0].text).toContain("只用中文回答。");
    expect(blocks[0].text).not.toContain("# Tone and style");
    // 把改写后的段换回原文，必须与「没有钩子」时逐字相同 —— 其余段没被动过。
    expect(
      blocks[0].text.replace("只用中文回答。", TONE_AND_STYLE_PROMPT),
    ).toBe(before[0].text);

    // 一轮一次：每个命名段各问一次，tone 也只问了一次。
    const asked = mods.collectPromptSection.mock.calls.map(
      (call) => call[0].id,
    );
    expect(asked.filter((id) => id === "tone")).toHaveLength(1);
    expect(asked).toEqual([
      "identity",
      "security",
      "url-guard",
      "system",
      "doing-tasks",
      "executing-actions",
      "tools",
      "tone",
      "env",
      "memory",
    ]);
  });

  it("prompt.section 返回 null：这一段整体不出现，不是空字符串占位", async () => {
    const baseline = buildHarness({ mods: null });
    await baseline.aiManager.sendAIMessage();
    const before = sentSystemPrompt();

    const mods = buildMods({
      collectPromptSection: vi.fn(async (section: ModPromptSection) =>
        section.id === "tone" ? null : section.text,
      ),
    });
    const { aiManager } = buildHarness({ mods });
    await aiManager.sendAIMessage();

    const blocks = sentSystemPrompt();
    expect(blocks[0].text).not.toContain("# Tone and style");
    // 整段连同它的分隔符一起消失，不留占位。
    expect(blocks[0].text).toBe(
      before[0].text.replace(`\n\n${TONE_AND_STYLE_PROMPT}`, ""),
    );
  });

  it("一轮里发了两次模型请求：prompt.compose 与每个命名段都只问一次，两步的提示词逐字相同", async () => {
    // 第一次带工具调用、第二次收尾 —— 一轮两次请求（spec「一轮一次」）。
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        content: undefined,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        tool_calls: [
          {
            id: "call-1",
            type: "function" as const,
            function: { name: "Bash", arguments: "{}" },
          },
        ],
      })
      .mockResolvedValueOnce(REPLY);

    // 带计数器的那种插件：逐请求重问会让同一轮各步的系统提示词不同。
    let asked = 0;
    const mods = buildMods({
      collectPromptSection: vi.fn(async (section: ModPromptSection) =>
        section.id === "tone"
          ? `只用中文回答（第 ${++asked} 次）`
          : section.text,
      ),
    });
    const { aiManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();

    expect(mods.collectPromptSections).toHaveBeenCalledTimes(1);
    expect(asked).toBe(1);
    const prompts = vi
      .mocked(callAgent)
      .mock.calls.map((call) => call[0].systemPrompt);
    expect(prompts).toHaveLength(2);
    // 同一轮的两步必须逐字相同，否则缓存前缀整段作废。
    expect(prompts[1]).toEqual(prompts[0]);
  });

  it("一段都没被改：拼出来的提示词与没有 ModManager 时逐字相同（缓存前缀不被打断）", async () => {
    const withoutMods = buildHarness({ mods: null });
    await withoutMods.aiManager.sendAIMessage();
    const before = sentSystemPrompt();

    const withMods = buildHarness({ mods: buildMods() });
    await withMods.aiManager.sendAIMessage();

    expect(withMods.mods?.collectPromptSections).toHaveBeenCalledTimes(1);
    expect(sentSystemPrompt()).toEqual(before);
    // 静态块仍然只有一块、仍然 cacheable；环境与记忆落在不缓存的那一块。
    expect(sentSystemPrompt().map((block) => block.cacheable)).toEqual([
      true,
      false,
    ]);
  });

  it("prompt.context 一条会话一次，落在第一条消息之前", async () => {
    const mods = buildMods({
      collectSessionContextBlocks: vi.fn().mockResolvedValue([
        { name: "lcm", text: "本仓库只用 pnpm" },
        { name: "lcm", text: "不要碰 packages/code" },
      ]),
    });
    const { aiManager, messageManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();
    await aiManager.sendAIMessage();

    // 一条会话只问一次。
    expect(mods.collectSessionContextBlocks).toHaveBeenCalledTimes(1);

    const injected = addedUserMessages(messageManager).filter((content) =>
      content.includes("本仓库只用 pnpm"),
    );
    expect(injected).toEqual([
      "<system-reminder>\n本仓库只用 pnpm\n</system-reminder>",
    ]);
    expect(
      addedUserMessages(messageManager).some((content) =>
        content.includes("不要碰 packages/code"),
      ),
    ).toBe(true);
  });

  it("prompt.context 换了会话（session id 变了）重新问一次", async () => {
    const mods = buildMods({
      collectSessionContextBlocks: vi
        .fn()
        .mockResolvedValue([{ name: "lcm", text: "本仓库只用 pnpm" }]),
    });
    const { aiManager, messageManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();
    vi.mocked(messageManager.getSessionId).mockReturnValue("second-session-id");
    await aiManager.sendAIMessage();

    expect(mods.collectSessionContextBlocks).toHaveBeenCalledTimes(2);
  });

  it("prompt.attachment 的 memory 档：返回 null 就压掉 AGENTS.md 这一条", async () => {
    const mods = buildMods({
      rewritePromptAttachment: vi.fn(
        async (attachment: { type: string; text: string }) =>
          attachment.type === "memory" ? null : attachment.text,
      ),
    });
    const { aiManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();

    expect(mods.rewritePromptAttachment).toHaveBeenCalledWith({
      type: "memory",
      text: MEMORY_TEXT,
    });
    // 那条提醒没进请求，也没有变成别的东西留在里面。
    expect(
      sentMessages().some((message) =>
        String(message.content).includes(MEMORY_TEXT),
      ),
    ).toBe(false);
  });

  it("prompt.attachment 只看我们真的发了的 type：改其它 type 不会误伤 memory", async () => {
    const mods = buildMods({
      rewritePromptAttachment: vi.fn(
        async (attachment: { type: string; text: string }) =>
          // 一个我们根本不发的分类（照抄 CC 的取值表就会是这样）。
          attachment.type === "claude-md" ? null : attachment.text,
      ),
    });
    const { aiManager } = buildHarness({ mods });

    await aiManager.sendAIMessage();

    expect(
      sentMessages().some((message) =>
        String(message.content).includes(MEMORY_TEXT),
      ),
    ).toBe(true);
    const types = mods.rewritePromptAttachment.mock.calls.map(
      (call) => call[0].type,
    );
    expect(types).toContain("memory");
    expect(types).not.toContain("claude-md");
  });

  it("prompt.attachment 的 agent_mention 档：改的是那条 @子代理提醒", async () => {
    const mods = buildMods({
      rewritePromptAttachment: vi.fn(
        async (attachment: { type: string; text: string }) =>
          attachment.type === "agent_mention"
            ? "（插件改写过的子代理提醒）"
            : attachment.text,
      ),
    });
    const { aiManager, messageManager } = buildHarness({
      mods,
      messages: [userMessage("@agent:explore 看看这个仓库")],
      subagentManager: EXPLORE_SUBAGENTS,
    });

    await aiManager.sendAIMessage();

    const agentMention = mods.rewritePromptAttachment.mock.calls.find(
      (call) => call[0].type === "agent_mention",
    );
    expect(agentMention?.[0].text).toContain("The user explicitly named");
    // 改了提醒不等于压掉了记忆：同一轮里 memory 那条照常在。
    expect(
      addedUserMessages(messageManager).some((content) =>
        content.includes("（插件改写过的子代理提醒）"),
      ),
    ).toBe(true);
  });

  it("prompt.attachment 的 nested_memory 档：压掉子目录 AGENTS.md 那一条", async () => {
    const mods = buildMods({
      rewritePromptAttachment: vi.fn(
        async (attachment: { type: string; text: string }) =>
          attachment.type === "nested_memory" ? null : attachment.text,
      ),
    });
    const { aiManager, messageManager } = buildHarness({ mods });
    vi.mocked(messageManager.collectNestedMemoryFiles).mockResolvedValue([
      { path: join(WORKDIR, "sub", "AGENTS.md"), content: "子目录规矩" },
    ] as unknown as Awaited<
      ReturnType<typeof messageManager.collectNestedMemoryFiles>
    >);

    await aiManager.sendAIMessage();

    expect(mods.rewritePromptAttachment).toHaveBeenCalledWith({
      type: "nested_memory",
      text: `Contents of ${join(WORKDIR, "sub", "AGENTS.md")}:\n\n子目录规矩`,
    });
    expect(
      addedUserMessages(messageManager).some((content) =>
        content.includes("子目录规矩"),
      ),
    ).toBe(false);
  });

  it("skill.prompt：/名字 调用时模型收到的技能正文被替换", async () => {
    const mods = buildMods();
    const { container } = buildHarness({ mods: null });
    container.register("ModManager", mods as unknown as ModManager);

    const skillManager = new SkillManager(container, {
      personalSkillsPath: "/test/personal-skills",
      workdir: WORKDIR,
      watch: false,
    });
    const skill: Skill = {
      name: "deploy",
      description: "部署",
      type: "personal",
      skillPath: "/test/personal-skills/deploy",
      content: "---\nname: deploy\ndescription: 部署\n---\n\n原来的正文",
      frontmatter: { name: "deploy", description: "部署" },
      isValid: true,
      errors: [],
    };
    vi.spyOn(skillManager, "loadSkill").mockResolvedValue(skill);
    mods.collectSkillText = vi.fn(async () => "插件改写过的正文");

    const result = await skillManager.executeSkill({ skill_name: "deploy" });

    expect(result.content).toBe("插件改写过的正文");
    expect(mods.collectSkillText).toHaveBeenCalledWith({
      skill: "deploy",
      text: expect.stringContaining("原来的正文"),
      source: "user",
      path: join("/test/personal-skills/deploy", "SKILL.md"),
    });
  });
});
