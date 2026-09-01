import React from "react";
import { render, cleanup } from "ink-testing-library";
import { Text } from "ink";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatProvider, useChat } from "../../src/contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

// Mock the Agent class (only the static `create` is used by ChatProvider),
// keeping the rest of the SDK intact.
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    Agent: { create: createMock } as unknown as typeof actual.Agent,
  };
});

// useAppConfig reads settings/config files — not needed here.
vi.mock("../../src/contexts/useAppConfig.js", () => ({
  useAppConfig: () => ({
    restoreSessionId: undefined,
    continueLastSession: false,
  }),
}));

// The screen-clear escape sequence written by forceRemount.
const SCREEN_CLEAR_ESCAPE = "\u001b[2J\u001b[3J\u001b[0;0H";

function makeMessage(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "text", content }],
  };
}

function createMockAgent() {
  const agent = {
    sessionId: "test-session-id",
    workingDirectory: "/tmp",
    messages: [makeMessage("m1", "hello"), makeMessage("m2", "world")],
    // Full UI stream follows the context in this mock (the compaction/rewind
    // callbacks here replace the whole list rather than splitting streams).
    get displayMessages() {
      return agent.messages;
    },
    isLoading: false,
    isCommandRunning: false,
    isCompacting: false,
    usages: [],
    sessionFilePath: "",
    getPermissionMode: () => "default",
    getModelConfig: () => ({ model: "test-model", fastModel: "" }),
    getConfiguredModels: () => [],
    getMaxInputTokens: () => 200000,
    getMcpServers: () => [],
    getSlashCommands: () => [],
    getHooksByScope: async () => ({}),
    clearMessages: vi.fn().mockImplementation(() => {
      agent.messages = [];
      return Promise.resolve();
    }),
    compact: vi.fn().mockImplementation(() => {
      agent.messages = [makeMessage("m3", "compacted summary")];
      return Promise.resolve();
    }),
    truncateHistory: vi.fn().mockImplementation((index: number) => {
      agent.messages = agent.messages.slice(0, index);
      return Promise.resolve();
    }),
    destroy: vi.fn(),
  };
  return agent;
}

type Captured = {
  clearMessages: () => Promise<void>;
  compact: (instructions?: string) => Promise<void>;
  handleRewindSelect: (index: number) => Promise<void>;
  messages: Message[];
};

let captured: Captured | null = null;

function Consumer() {
  const { clearMessages, compact, handleRewindSelect, messages } = useChat();
  captured = { clearMessages, compact, handleRewindSelect, messages };
  return <Text>{`count:${messages.length}`}</Text>;
}

function renderProvider() {
  return render(
    <ChatProvider workdir="/tmp">
      <Consumer />
    </ChatProvider>,
  );
}

async function waitForAgentInit() {
  await vi.waitFor(() => expect(createMock).toHaveBeenCalled());
  await vi.waitFor(() => expect(captured?.messages.length).toBe(2));
}

describe("ChatProvider clear/compact/rewind force remount", () => {
  let mockAgent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    captured = null;
    mockAgent = createMockAgent();
    createMock.mockResolvedValue(mockAgent);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("clearMessages refreshes the list then forces a remount (screen clear)", async () => {
    const tree = renderProvider();
    await waitForAgentInit();
    const writeSpy = vi.spyOn(tree.stdout, "write");

    await captured!.clearMessages();

    expect(mockAgent.clearMessages).toHaveBeenCalled();
    // The escape sequence must be written even if a throttled remount
    // happened moments before (bypasses requestRemount's 1s throttle).
    expect(writeSpy).toHaveBeenCalledWith(
      SCREEN_CLEAR_ESCAPE,
      expect.any(Function),
    );
    await vi.waitFor(() => expect(captured!.messages.length).toBe(0));
  });

  it("compact refreshes the list then forces a remount", async () => {
    const tree = renderProvider();
    await waitForAgentInit();
    const writeSpy = vi.spyOn(tree.stdout, "write");

    await captured!.compact("focus on the API design");

    expect(mockAgent.compact).toHaveBeenCalledWith("focus on the API design");
    expect(writeSpy).toHaveBeenCalledWith(
      SCREEN_CLEAR_ESCAPE,
      expect.any(Function),
    );
    await vi.waitFor(() => expect(captured!.messages.length).toBe(1));
  });

  it("handleRewindSelect forces a remount after truncation", async () => {
    const tree = renderProvider();
    await waitForAgentInit();
    const writeSpy = vi.spyOn(tree.stdout, "write");

    await captured!.handleRewindSelect(1);

    expect(mockAgent.truncateHistory).toHaveBeenCalledWith(1);
    expect(writeSpy).toHaveBeenCalledWith(
      SCREEN_CLEAR_ESCAPE,
      expect.any(Function),
    );
    await vi.waitFor(() => expect(captured!.messages.length).toBe(1));
  });

  it("consecutive clearMessages both force a remount (throttle bypass)", async () => {
    const tree = renderProvider();
    await waitForAgentInit();
    const writeSpy = vi.spyOn(tree.stdout, "write");

    await captured!.clearMessages();
    await captured!.clearMessages();

    expect(mockAgent.clearMessages).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenCalledTimes(2);
  });
});
