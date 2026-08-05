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

import type { Usage } from "@/types/index.js";

vi.mock("@/services/aiService");
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: vi.fn().mockResolvedValue(undefined),
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  getOTELApi: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  JsonlSpanExporter: class {},
  JsonlLogExporter: class {},
}));
vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
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
  let onErrorBlockAdded: ReturnType<typeof vi.fn<(error: string) => void>>;

  beforeEach(async () => {
    onErrorBlockAdded = vi.fn<(error: string) => void>();
    const mockCallbacks = {
      onLoadingChange: vi.fn(),
      onErrorBlockAdded,
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
      resolveMaxInputTokens: () => agent.getMaxInputTokens(),
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
    onErrorBlockAdded.mockClear();
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

  function errorBlocks(): { content?: string }[] {
    return agent.messages.flatMap((msg) =>
      msg.blocks.filter((b) => b.type === "error"),
    );
  }

  it("/clear while AI is running is ignored — session and messages untouched", async () => {
    const { sendPromise, rejectCallAgent } = await startHangingTurn();
    const sessionIdBefore = agent.sessionId;
    const messageCountBefore = agent.messages.length;

    await agent.clearMessages();

    // Ignored: no hooks fired, no session replacement, no UI error.
    expect(onErrorBlockAdded).not.toHaveBeenCalled();
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
    expect(onErrorBlockAdded).toHaveBeenCalled();
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
    expect(onErrorBlockAdded).toHaveBeenCalled();
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
