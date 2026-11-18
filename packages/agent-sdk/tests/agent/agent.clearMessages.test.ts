// Regression tests for /clear and /compact while the agent is running.
//
// Design (aligned with webview ChatApp.handleClearChat): when the agent is
// loading, clearMessages() and compact() are IGNORED — the AI turn is not
// aborted and the conversation history is untouched. Aborting a mid-turn
// /clear used to inject a late "Request was aborted" error block into the
// newly cleared session (visible error in UI, second /clear required).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { Container } from "@/utils/container.js";
import { AIManager } from "@/managers/aiManager.js";
import { ModManager } from "@/managers/modManager.js";
import type { HookManager } from "@/managers/hookManager.js";

import type { NoticeBlock, Usage } from "@/types/index.js";

vi.mock("@/services/aiService");
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: vi.fn().mockResolvedValue(undefined),
  flushTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
}));
vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
  logRequestContentEvents: vi.fn().mockResolvedValue(undefined),
  resetContentEventState: vi.fn(),
}));

const { instance: mockToolManagerInstance, execute: mockToolExecute } =
  createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent - clear/compact ignored while running", () => {
  let agent: Agent;
  let aiManager: AIManager;
  let onNoticeAdded: ReturnType<
    typeof vi.fn<(notice: { level: string; content: string }) => void>
  >;

  beforeEach(async () => {
    onNoticeAdded =
      vi.fn<(notice: { level: string; content: string }) => void>();
    const mockCallbacks = {
      onLoadingChange: vi.fn(),
      onNoticeAdded,
    };

    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-clear-abort",
      callbacks: mockCallbacks,
    });

    const container = (agent as unknown as { container: Container }).container;
    container.register("ToolManager", mockToolManagerInstance);
    container.register("McpManager", {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    });
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => agent.getGatewayConfig(),
      resolveModelConfig: () => agent.getModelConfig(),
      resolveContextWindow: () => agent.getContextWindow(),
      resolveMaxOutputTokens: () => 4096,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => agent.getLanguage(),
      getEnvironmentVars: () => ({}),
      getEnvSnapshot: () => ({}),
    });

    aiManager = new AIManager(container, {
      callbacks: {
        ...mockCallbacks,
        onUsageAdded: (usage: Usage) =>
          (
            agent as unknown as {
              messageManager: { addUsage: (u: Usage) => void };
            }
          ).messageManager.addUsage(usage),
      },
      workdir: "/tmp/test-clear-abort",
      stream: true,
    });
    container.register("AIManager", aiManager);
    (agent as unknown as { aiManager: AIManager }).aiManager = aiManager;
    (agent as unknown as { stream: boolean }).stream = true;

    vi.spyOn(aiService, "callAgent").mockResolvedValue({
      content: "Mock response",
      tool_calls: [],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    vi.clearAllMocks();
    onNoticeAdded.mockClear();
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
  });

  /** Start a hanging turn (deferred callAgent) and wait until it is in flight. */
  async function startHangingTurn() {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    let rejectCallAgent!: (e: Error) => void;
    const deferred = new Promise((_resolve, reject) => {
      rejectCallAgent = reject;
    });
    mockCallAgent.mockReturnValueOnce(
      deferred as unknown as ReturnType<typeof mockCallAgent>,
    );

    const sendPromise = agent.sendMessage("Test message");
    await vi.waitFor(() => expect(mockCallAgent).toHaveBeenCalled());
    return { sendPromise, rejectCallAgent };
  }

  function errorBlocks(): NoticeBlock[] {
    return agent.messages.flatMap((msg) =>
      msg.blocks.filter(
        (b): b is NoticeBlock => b.type === "notice" && b.level === "error",
      ),
    );
  }

  it("/clear while AI is running is ignored — session and messages untouched", async () => {
    const { sendPromise, rejectCallAgent } = await startHangingTurn();
    const sessionIdBefore = agent.sessionId;
    const messageCountBefore = agent.messages.length;

    await agent.clearMessages();

    // Ignored: no hooks fired, no session replacement, no UI error.
    expect(onNoticeAdded).not.toHaveBeenCalled();
    expect(agent.sessionId).toBe(sessionIdBefore);
    expect(agent.messages.length).toBe(messageCountBefore);
    expect(
      agent.messages.some(
        (m) =>
          m.role === "user" &&
          m.blocks.some(
            (b) => b.type === "text" && b.content === "Test message",
          ),
      ),
    ).toBe(true);

    // The turn keeps running; when it fails, the error lands in the SAME
    // (current) session — normal error handling, no cleared-session pollution.
    rejectCallAgent(new Error("Request was aborted"));
    await sendPromise;
    expect(agent.sessionId).toBe(sessionIdBefore);
    expect(
      errorBlocks().some((b) => b.content?.includes("Request was aborted")),
    ).toBe(true);
    expect(onNoticeAdded).toHaveBeenCalled();
    expect(mockToolExecute).not.toHaveBeenCalled();
  });

  it("/compact while AI is running is ignored — no compaction, session untouched", async () => {
    const { sendPromise, rejectCallAgent } = await startHangingTurn();
    const compactSpy = vi.spyOn(aiManager, "compactConversation");
    const sessionIdBefore = agent.sessionId;
    const messageCountBefore = agent.messages.length;

    await agent.compact("focus on the bug");

    expect(compactSpy).not.toHaveBeenCalled();
    expect(agent.sessionId).toBe(sessionIdBefore);
    expect(agent.messages.length).toBe(messageCountBefore);

    rejectCallAgent(new Error("Request was aborted"));
    await sendPromise;
    expect(compactSpy).not.toHaveBeenCalled();
  });

  it("ESC stop alone still injects 'Request was aborted' error into the CURRENT session", async () => {
    const { sendPromise, rejectCallAgent } = await startHangingTurn();

    agent.abortMessage();
    rejectCallAgent(new Error("Request was aborted"));
    await sendPromise;

    expect(
      errorBlocks().some((b) => b.content?.includes("Request was aborted")),
    ).toBe(true);
    expect(onNoticeAdded).toHaveBeenCalled();
  });

  it("影子事件：/clear 先发 classic.SessionEnd(clear) 再发 SessionStart(clear)", async () => {
    // spec「影子事件」：结束的那场报旧 session id（在 `clearMessages()` 换 id
    // 之前发），新开的那场报 `source: "clear"`。
    const notifyMods = vi.spyOn(ModManager.prototype, "notifyMods");
    await agent.sendMessage("Test message");
    await vi.waitFor(() => expect(agent.isLoading).toBe(false));
    notifyMods.mockClear();

    await agent.clearMessages();

    const lifecycle = notifyMods.mock.calls
      .filter((call) => call[0].startsWith("classic.Session"))
      .map((call) => `${call[0]}:${JSON.stringify(call[1])}`);
    expect(lifecycle).toEqual([
      'classic.SessionEnd:{"reason":"clear"}',
      'classic.SessionStart:{"source":"clear"}',
    ]);

    notifyMods.mockRestore();
  });

  it("/clear 之后的 SessionStart 上下文照常重新注入（列表已清空）", async () => {
    // 去重看的是当前列表：`/clear` 把它清空了，所以即便内容与上一次完全相同，
    // 下一份也照常落地（这是四个 source 共用同一份判断的必然结果）。
    const hookManager = (agent as unknown as { hookManager: HookManager })
      .hookManager;
    vi.spyOn(hookManager, "executeSessionStartHooks").mockResolvedValue({
      results: [],
      additionalContext: "Cached context",
    });
    const injected = `<system-reminder>\nSessionStart hook additional context: Cached context\n</system-reminder>`;
    const metaTexts = () =>
      agent.messages
        .filter((message) => message.isMeta)
        .flatMap((message) =>
          message.blocks.flatMap((block) =>
            block.type === "text" ? [block.content] : [],
          ),
        );

    await agent.clearMessages();
    expect(metaTexts()).toEqual([injected]);

    await agent.clearMessages();
    expect(metaTexts()).toEqual([injected]);
    expect(agent.messages).toHaveLength(1);
  });

  it("/clear 仍注入 initialUserMessage（清空后的空表 = 会话起点，对齐 -p 语义）", async () => {
    const hookManager = (agent as unknown as { hookManager: HookManager })
      .hookManager;
    vi.spyOn(hookManager, "executeSessionStartHooks").mockResolvedValue({
      results: [],
      initialUserMessage: "Start with a plan",
    });

    await agent.clearMessages();

    // `startup` 与 `clear` 是仅有的两个「列表为空」的 source；恢复与压缩都不注入。
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0].isMeta).toBe(true);
    expect(agent.messages[0].blocks[0]).toMatchObject({
      type: "text",
      content: "Start with a plan",
    });
  });

  it("/clear while idle still works — messages cleared, new session ID", async () => {
    // Complete a normal turn first.
    await agent.sendMessage("Test message");
    await vi.waitFor(() => expect(agent.isLoading).toBe(false));
    const oldSessionId = agent.sessionId;
    expect(agent.messages.length).toBeGreaterThan(0);

    await agent.clearMessages();

    expect(agent.sessionId).not.toBe(oldSessionId);
    expect(agent.messages.length).toBe(0);
  });
});
