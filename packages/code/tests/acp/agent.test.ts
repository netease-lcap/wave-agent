import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WaveAcpAgent } from "../../src/acp/agent.js";
import {
  Agent as WaveAgent,
  type AgentOptions,
  type PermissionCallback,
} from "wave-agent-sdk";
import {
  type AgentSideConnection,
  type ListSessionsRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

// Mock wave-agent-sdk
vi.mock("wave-agent-sdk", async () => {
  const actual = await vi.importActual("wave-agent-sdk");
  return {
    ...actual,
    Agent: {
      create: vi.fn(),
    },
    listSessions: vi.fn().mockResolvedValue([]),
    listAllSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn(),
    truncateContent: vi.fn((s) => s),
  };
});

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("WaveAcpAgent", () => {
  let mockConnection: {
    closed: Promise<void>;
    requestPermission: ReturnType<typeof vi.fn>;
    sessionUpdate: ReturnType<typeof vi.fn>;
    extMethod: ReturnType<typeof vi.fn>;
  };
  let agent: WaveAcpAgent;

  beforeEach(() => {
    mockConnection = {
      closed: new Promise(() => {}),
      requestPermission: vi.fn(),
      sessionUpdate: vi.fn(),
      extMethod: vi.fn(),
    };
    agent = new WaveAcpAgent(mockConnection as unknown as AgentSideConnection);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with correct capabilities", async () => {
    const response = await agent.initialize();
    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(
      (response.agentCapabilities as { availableCommands?: unknown })
        ?.availableCommands,
    ).toBeUndefined();
    expect(response.agentCapabilities?.sessionCapabilities?.list).toBeDefined();
    expect(
      response.agentCapabilities?.sessionCapabilities?.close,
    ).toBeDefined();
  });

  it("should create a new session", async () => {
    const mockWaveAgent = {
      sessionId: "test-session-id",
      sendMessage: vi.fn(),
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    const response = await agent.newSession({
      cwd: "/test/cwd",
      mcpServers: [],
    });
    expect(response.sessionId).toBe("test-session-id");
    expect(response.modes?.availableModes).toContainEqual(
      expect.objectContaining({ id: "dontAsk" }),
    );
    expect(
      (response.configOptions?.[0] as { options: { value: string }[] }).options,
    ).toContainEqual(expect.objectContaining({ value: "dontAsk" }));
    expect(WaveAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: "/test/cwd",
      }),
    );

    await vi.waitFor(() => {
      expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "available_commands_update",
          }),
        }),
      );
    });
  });

  it("should load an existing session", async () => {
    const mockWaveAgent = {
      sessionId: "existing-session-id",
      sendMessage: vi.fn(),
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
      messages: [],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    const response = await agent.loadSession({
      sessionId: "existing-session-id",
      cwd: "/test/cwd",
      mcpServers: [],
    });
    expect(response.modes).toBeDefined();
    expect(response.configOptions).toBeDefined();
    expect(WaveAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restoreSessionId: "existing-session-id",
        workdir: "/test/cwd",
      }),
    );

    await vi.waitFor(() => {
      expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "available_commands_update",
          }),
        }),
      );
    });
  });

  it("should replay conversation history when loading a session", async () => {
    const mockWaveAgent = {
      sessionId: "replay-session-id",
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      messages: [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "Hello" }],
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          role: "assistant",
          blocks: [
            { type: "reasoning", content: "Thinking..." },
            { type: "text", content: "Hi there!" },
            {
              type: "tool",
              id: "tool-1",
              name: "Read",
              compactParams: "file.txt",
              stage: "end",
              success: true,
              parameters: JSON.stringify({ file_path: "/test/file.txt" }),
              result: "file contents",
              shortResult: "file contents",
            },
          ],
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-3",
          role: "user",
          blocks: [{ type: "text", content: "Thanks" }],
          timestamp: new Date().toISOString(),
          isMeta: true,
        },
      ],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.loadSession({
      sessionId: "replay-session-id",
      cwd: "/test",
      mcpServers: [],
    });

    // Should emit user_message_chunk for user message
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "replay-session-id",
        update: expect.objectContaining({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Hello" },
          messageId: "msg-1",
        }),
      }),
    );

    // Should emit agent_thought_chunk for reasoning block
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "replay-session-id",
        update: expect.objectContaining({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thinking..." },
          messageId: "msg-2",
        }),
      }),
    );

    // Should emit agent_message_chunk for text block
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "replay-session-id",
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hi there!" },
          messageId: "msg-2",
        }),
      }),
    );

    // Should emit tool_call then tool_call_update for tool block
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "replay-session-id",
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read: file.txt",
          status: "pending",
        }),
      }),
    );
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "replay-session-id",
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          title: "Read: file.txt",
          status: "completed",
        }),
      }),
    );

    // Should NOT emit anything for isMeta messages
    const allCalls = vi.mocked(mockConnection.sessionUpdate).mock.calls;
    for (const call of allCalls) {
      if (
        "messageId" in (call[0] as { update: { messageId?: string } }).update
      ) {
        expect(
          (call[0] as { update: { messageId?: string } }).update.messageId,
        ).not.toBe("msg-3");
      }
    }
  });

  it("should fallback to agent.messages when getFullMessageThread fails", async () => {
    const mockWaveAgent = {
      sessionId: "fallback-session-id",
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      getFullMessageThread: vi.fn().mockRejectedValue(new Error("disk error")),
      messages: [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "Fallback msg" }],
          timestamp: new Date().toISOString(),
        },
      ],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.loadSession({
      sessionId: "fallback-session-id",
      cwd: "/test",
      mcpServers: [],
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "fallback-session-id",
        update: expect.objectContaining({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Fallback msg" },
        }),
      }),
    );
  });

  it("should replay tool blocks with various edge cases", async () => {
    const mockWaveAgent = {
      sessionId: "edge-case-session",
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      messages: [
        {
          id: "msg-tool-edges",
          role: "assistant",
          blocks: [
            // Tool without id — should generate a replay- prefixed id
            {
              type: "tool",
              name: "Bash",
              stage: "running",
              parameters: JSON.stringify({ command: "ls" }),
            },
            // Tool with failed stage
            {
              type: "tool",
              id: "tool-fail",
              name: "Edit",
              compactParams: "file.ts",
              stage: "end",
              success: false,
              error: "edit failed",
              parameters: JSON.stringify({
                file_path: "/test/file.ts",
                old_string: "a",
                new_string: "b",
              }),
            },
            // Tool without name — should use "Tool" fallback
            {
              type: "tool",
              id: "tool-no-name",
              stage: "end",
              success: true,
              result: "ok",
            },
            // Tool with unparseable parameters
            {
              type: "tool",
              id: "tool-bad-json",
              name: "Bash",
              stage: "end",
              success: true,
              parameters: "not-json",
              result: "done",
            },
            // Skipped block types (image, bang, error, file_history, task_notification)
            { type: "image", imageUrls: ["file.png"] },
            {
              type: "bang",
              command: "ls",
              output: "",
              stage: "end" as const,
              exitCode: 0,
            },
            { type: "error", content: "err" },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.loadSession({
      sessionId: "edge-case-session",
      cwd: "/test",
      mcpServers: [],
    });

    // Tool without id — generated toolCallId starts with "replay-"
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: expect.stringMatching(/^replay-/),
          title: "Bash",
          status: "pending",
        }),
      }),
    );
    // Running stage → in_progress in update
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: expect.stringMatching(/^replay-/),
          status: "in_progress",
        }),
      }),
    );

    // Failed tool
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "tool-fail",
          title: "Edit: file.ts",
          status: "pending",
        }),
      }),
    );
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-fail",
          status: "failed",
          rawOutput: "edit failed",
        }),
      }),
    );

    // Tool without name — uses "Tool" fallback, no compactParams → title is just "Tool"
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "tool-no-name",
          title: "Tool",
        }),
      }),
    );

    // Tool with bad JSON parameters — parse error caught, parsedParameters undefined
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "tool-bad-json",
          rawInput: undefined,
        }),
      }),
    );

    // Skipped block types should not produce any session updates with these ids
    const allCalls = vi.mocked(mockConnection.sessionUpdate).mock.calls;
    const allUpdates = allCalls.map(
      (c) => (c[0] as { update: { sessionUpdate: string } }).update,
    );
    // No extra tool_call or message_chunk for skipped types
    const skippedTypes = allUpdates.filter(
      (u) =>
        u.sessionUpdate !== "tool_call" &&
        u.sessionUpdate !== "tool_call_update" &&
        u.sessionUpdate !== "user_message_chunk" &&
        u.sessionUpdate !== "agent_message_chunk" &&
        u.sessionUpdate !== "agent_thought_chunk" &&
        u.sessionUpdate !== "available_commands_update",
    );
    expect(skippedTypes).toHaveLength(0);
  });

  it("should list all sessions when cwd is not provided", async () => {
    const {
      listAllSessions: listAllWaveSessions,
      truncateContent: truncateWaveContent,
    } = await import("wave-agent-sdk");
    vi.mocked(listAllWaveSessions).mockResolvedValue([
      {
        id: "session-all-1",
        workdir: "/cwd/all",
        createdAt: new Date("2023-03-01T00:00:00Z"),
        lastActiveAt: new Date("2023-03-01T00:00:00Z"),
        sessionType: "main",
        latestTotalTokens: 200,
        firstMessage: "Hello\nworld",
      },
    ]);
    vi.mocked(truncateWaveContent).mockImplementation((s) =>
      s.replace(/\n/g, "\\n"),
    );

    const response = await agent.listSessions({} as ListSessionsRequest);
    expect(listAllWaveSessions).toHaveBeenCalled();
    expect(truncateWaveContent).toHaveBeenCalledWith("Hello\nworld");
    expect(response.sessions).toHaveLength(1);
    expect(response.sessions[0]).toEqual({
      sessionId: "session-all-1",
      cwd: "/cwd/all",
      title: "Hello\\nworld",
      updatedAt: "2023-03-01T00:00:00.000Z",
    });
  });

  it("should list sessions from wave-agent-sdk when cwd is provided", async () => {
    const {
      listSessions: listWaveSessions,
      truncateContent: truncateWaveContent,
    } = await import("wave-agent-sdk");
    vi.mocked(listWaveSessions).mockResolvedValue([
      {
        id: "session-sdk-1",
        workdir: "/cwd/sdk",
        createdAt: new Date("2023-02-01T00:00:00Z"),
        lastActiveAt: new Date("2023-02-01T00:00:00Z"),
        sessionType: "main",
        latestTotalTokens: 100,
        firstMessage: "SDK session",
      },
    ]);
    vi.mocked(truncateWaveContent).mockImplementation((s) => s);

    const response = await agent.listSessions({
      cwd: "/cwd/sdk",
    } as ListSessionsRequest);

    expect(listWaveSessions).toHaveBeenCalledWith("/cwd/sdk");
    expect(truncateWaveContent).toHaveBeenCalledWith("SDK session");
    expect(response.sessions).toHaveLength(1);
    expect(response.sessions[0]).toEqual({
      sessionId: "session-sdk-1",
      cwd: "/cwd/sdk",
      title: "SDK session",
      updatedAt: "2023-02-01T00:00:00.000Z",
    });
  });

  it("should include diff content for Write and Edit tools", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // Write tool
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Write",
      stage: "start",
      parameters: JSON.stringify({
        file_path: "/test/file.txt",
        content: "new content",
      }),
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/test/file.txt",
              oldText: null,
              newText: "new content",
            },
          ],
          locations: [
            {
              path: "/test/file.txt",
              line: 1,
            },
          ],
        }),
      }),
    );

    // Edit tool
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "2",
      name: "Edit",
      stage: "end",
      success: true,
      parameters: JSON.stringify({
        file_path: "/test/file.txt",
        old_string: "old",
        new_string: "new",
      }),
      result: "Text replaced successfully",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "2",
          status: "completed",
          kind: "edit",
          content: [
            {
              type: "diff",
              path: "/test/file.txt",
              oldText: "old",
              newText: "new",
            },
          ],
          locations: [
            {
              path: "/test/file.txt",
              line: undefined,
            },
          ],
        }),
      }),
    );
  });

  it("should stop a session via unstable_closeSession", async () => {
    const mockWaveAgent = {
      sessionId: "session-to-stop",
      destroy: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.unstable_closeSession({
      sessionId: "session-to-stop",
    });
    expect(mockWaveAgent.destroy).toHaveBeenCalled();

    const { listAllSessions: listAllWaveSessions } = await import(
      "wave-agent-sdk"
    );
    vi.mocked(listAllWaveSessions).mockResolvedValue([]);

    const listResponse = await agent.listSessions({} as ListSessionsRequest);
    expect(listResponse.sessions).toHaveLength(0);
  });

  it("should cleanup all agents when connection closes", async () => {
    let resolveClosed: () => void = () => {};
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    mockConnection.closed = closedPromise;

    // Re-instantiate to use the new closed promise
    agent = new WaveAcpAgent(mockConnection as unknown as AgentSideConnection);
    await agent.initialize();

    const mockWaveAgent = {
      sessionId: "session-1",
      destroy: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    resolveClosed();
    await closedPromise;

    // Wait for cleanupAllAgents to finish (it's triggered by .then)
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWaveAgent.destroy).toHaveBeenCalled();
  });

  it("should handle prompt and send message", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith("hello", undefined);
    expect(response.stopReason).toBe("end_turn");
  });

  it("should handle cancel and abort message", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      abortMessage: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.cancel({ sessionId: "session-1" });
    expect(mockWaveAgent.abortMessage).toHaveBeenCalled();
  });

  it("should handle permission request", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
      toolCallId: "test-tool-id",
    });
    expect(decision.behavior).toBe("allow");
    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          toolCallId: "test-tool-id",
          title: "test-tool",
        }),
        options: [
          {
            optionId: "allow_once",
            name: "Allow Once",
            kind: "allow_once",
          },
          {
            optionId: "allow_always",
            name: "Allow Always",
            kind: "allow_always",
          },
          {
            optionId: "reject_once",
            name: "Reject Once",
            kind: "reject_once",
          },
        ],
      }),
    );
  });

  it("should handle Bash permission request specially", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    await canUseToolCallback!({
      toolName: "Bash",
      toolInput: { command: "ls" },
      permissionMode: "default",
      toolCallId: "bash-id",
    });

    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            optionId: "allow_once",
            name: "Yes, proceed",
            kind: "allow_once",
          },
          {
            optionId: "allow_always",
            name: "Yes, always allow this command",
            kind: "allow_always",
          },
        ],
      }),
    );

    // Test with suggestedPrefix
    await canUseToolCallback!({
      toolName: "Bash",
      toolInput: { command: "git status" },
      permissionMode: "default",
      toolCallId: "bash-prefix-id",
      suggestedPrefix: "git",
    });

    expect(mockConnection.requestPermission).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            optionId: "allow_always",
            name: "Yes, always allow git",
          }),
        ]),
      }),
    );

    // Test with mkdir
    await canUseToolCallback!({
      toolName: "Bash",
      toolInput: { command: "mkdir foo" },
      permissionMode: "default",
      toolCallId: "bash-mkdir-id",
    });

    expect(mockConnection.requestPermission).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({
            optionId: "allow_always",
            name: "Yes, and auto-accept edits",
          }),
        ]),
      }),
    );
  });

  it("should handle Edit/Write permission request specially", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    await canUseToolCallback!({
      toolName: "Edit",
      toolInput: { file_path: "foo.txt" },
      permissionMode: "default",
      toolCallId: "edit-id",
    });

    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            optionId: "allow_once",
            name: "Yes, proceed",
            kind: "allow_once",
          },
          {
            optionId: "allow_always",
            name: "Yes, and auto-accept edits",
            kind: "allow_always",
          },
        ],
      }),
    );
  });

  it("should handle ExitPlanMode permission request specially", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("plan"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      planContent: "My Plan",
      permissionMode: "plan",
      toolCallId: "exit-plan-id",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionMode).toBe("default");
    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          toolCallId: "exit-plan-id",
          title: "ExitPlanMode",
          rawInput: {},
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "My Plan",
              },
            },
          ],
        }),
        options: [
          {
            optionId: "allow_once",
            name: "Yes, manually approve edits",
            kind: "allow_once",
          },
          {
            optionId: "allow_always",
            name: "Yes, auto-accept edits",
            kind: "allow_always",
          },
        ],
      }),
    );
  });

  it("should handle ExitPlanMode permission request with allow_always", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("plan"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_always" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      planContent: "My Plan",
      permissionMode: "plan",
      toolCallId: "exit-plan-id",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionMode).toBe("acceptEdits");
  });

  it("should handle AskUserQuestion permission request specially", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const mockAnswers = JSON.stringify({ Library: "Option 1" });
    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "dummy" },
      message: mockAnswers,
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "AskUserQuestion",
      toolInput: { questions: [] },
      permissionMode: "default",
      toolCallId: "ask-id",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.message).toBe(mockAnswers);
    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [],
        toolCall: expect.objectContaining({
          toolCallId: "ask-id",
          title: "AskUserQuestion",
        }),
      }),
    );
  });

  it("should handle permission rejection", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "reject_once" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("deny");
  });

  it("should handle permission allow always", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_always" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionRule).toBe("test-tool");
  });

  it("should handle Bash permission allow always with suggestedPrefix", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_always" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "Bash",
      toolInput: { command: "npm run dev:foo" },
      permissionMode: "default",
      suggestedPrefix: "npm run dev:foo",
    });
    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionRule).toBe("Bash(npm run dev:foo)");
  });

  it("should handle permission cancellation", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "cancelled" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("Cancelled by user");
  });

  it("should handle setSessionMode", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      setPermissionMode: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.setSessionMode({
      sessionId: "session-1",
      modeId: "plan",
    });
    expect(mockWaveAgent.setPermissionMode).toHaveBeenCalledWith("plan");

    await agent.setSessionMode({
      sessionId: "session-1",
      modeId: "dontAsk",
    });
    expect(mockWaveAgent.setPermissionMode).toHaveBeenCalledWith("dontAsk");
  });

  it("should handle setSessionConfigOption", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      setPermissionMode: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.setSessionConfigOption({
      sessionId: "session-1",
      configId: "permission_mode",
      value: "bypassPermissions",
    });

    expect(mockWaveAgent.setPermissionMode).toHaveBeenCalledWith(
      "bypassPermissions",
    );

    await agent.setSessionConfigOption({
      sessionId: "session-1",
      configId: "permission_mode",
      value: "dontAsk",
    });

    expect(mockWaveAgent.setPermissionMode).toHaveBeenCalledWith("dontAsk");
  });

  it("should handle callbacks", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onAssistantContentUpdated!(
      "msg-test-id",
      "chunk",
      "chunk",
    );
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "chunk" },
        }),
      }),
    );

    capturedCallbacks!.onAssistantReasoningUpdated!(
      "msg-test-id",
      "thought",
      "thought",
    );
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thought" },
        }),
      }),
    );

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "tool",
      stage: "start",
    });
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
        }),
      }),
    );

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "tool",
      stage: "end",
      success: true,
      result: "ok",
    });
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "1",
          status: "completed",
        }),
      }),
    );

    capturedCallbacks!.onTasksChange!([
      {
        id: "1",
        subject: "task",
        description: "",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]);
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "plan",
          entries: [
            expect.objectContaining({ content: "task", status: "completed" }),
          ],
        }),
      }),
    );

    capturedCallbacks!.onTasksChange!([
      {
        id: "1",
        subject: "task",
        description: "",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]);
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "plan",
          entries: [
            expect.objectContaining({ content: "task", status: "in_progress" }),
          ],
        }),
      }),
    );

    capturedCallbacks!.onTasksChange!([
      {
        id: "1",
        subject: "task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]);
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "plan",
          entries: [
            expect.objectContaining({ content: "task", status: "pending" }),
          ],
        }),
      }),
    );

    capturedCallbacks!.onPermissionModeChange!("plan");
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "current_mode_update",
          currentModeId: "plan",
        }),
      }),
    );

    capturedCallbacks!.onPermissionModeChange!("bypassPermissions");
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "config_option_update",
          configOptions: expect.arrayContaining([
            expect.objectContaining({
              id: "permission_mode",
              currentValue: "default",
            }),
          ]),
        }),
      }),
    );
  });

  it("should handle prompt with images", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.prompt({
      sessionId: "session-1",
      prompt: [
        { type: "text", text: "what is this?" },
        { type: "image", data: "base64data", mimeType: "image/png" },
      ],
    });

    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith("what is this?", [
      { path: "data:image/png;base64,base64data", mimeType: "image/png" },
    ]);
  });

  it("should handle prompt errors", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockRejectedValue(new Error("failed")),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await expect(
      agent.prompt({
        sessionId: "session-1",
        prompt: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toThrow("failed");
  });

  it("should handle prompt abort", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockRejectedValue(new Error("abort")),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(response.stopReason).toBe("cancelled");
  });

  it("should handle unknown extMethod", async () => {
    await expect(agent.extMethod("unknown", {})).rejects.toThrow(
      "Method unknown not implemented",
    );
  });

  it("should handle permission request with unknown option", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "unknown" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("Unknown option selected");
  });

  it("should handle permission request error", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockRejectedValue(
      new Error("network error"),
    );

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("network error");
  });

  it("should handle tool block updated with various stages", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([
        {
          id: "test-cmd",
          name: "test-cmd",
          description: "Test command",
          handler: vi.fn(),
        },
      ]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });
    vi.mocked(mockConnection.sessionUpdate).mockClear();

    // Streaming stage
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "tool",
      stage: "streaming",
    });
    expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();

    // Running stage
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "tool",
      stage: "running",
    });
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          status: "in_progress",
        }),
      }),
    );

    // Failed stage
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "tool",
      stage: "end",
      success: false,
      error: "failed",
    });
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          status: "failed",
          rawOutput: "failed",
        }),
      }),
    );
  });

  it("should throw error if prompt is called with non-existent session", async () => {
    await expect(
      agent.prompt({ sessionId: "non-existent", prompt: [] }),
    ).rejects.toThrow("Session non-existent not found");
  });

  it("should handle closeSession with non-existent session", async () => {
    // stop is implemented via unstable_closeSession
    await expect(
      agent.unstable_closeSession({
        sessionId: "non-existent",
      }),
    ).resolves.toEqual({});
  });

  it("should handle unknown extMethod", async () => {
    await expect(agent.extMethod("unknown", {})).rejects.toThrow(
      "Method unknown not implemented",
    );
  });

  it("should format tool call title with compactParams", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // Test with compactParams
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Read",
      stage: "start",
      compactParams: "package.json",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          title: "Read: package.json",
        }),
      }),
    );

    // Test update with compactParams
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Read",
      stage: "end",
      success: true,
      compactParams: "package.json",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "1",
          title: "Read: package.json",
        }),
      }),
    );

    // Test fallback when compactParams is missing
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "2",
      name: "Read",
      stage: "start",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "2",
          title: "Read",
        }),
      }),
    );
  });

  it("should remember tool name and compactParams across updates", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // 1. Start with name only
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Read",
      stage: "start",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          title: "Read",
        }),
      }),
    );

    // 2. Update with compactParams in running stage
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      stage: "running",
      compactParams: "file.txt",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          title: "Read: file.txt",
        }),
      }),
    );

    // 3. Update in end stage with missing name and compactParams
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      stage: "end",
      success: true,
    });

    expect(mockConnection.sessionUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          title: "Read: file.txt",
        }),
      }),
    );

    // 4. Verify permission request uses the remembered title
    let capturedCanUseTool: PermissionCallback;
    vi.mocked(WaveAgent.create).mockImplementationOnce(
      (options: AgentOptions) => {
        capturedCanUseTool = options.canUseTool as PermissionCallback;
        const agent = {
          ...mockWaveAgent,
          messages: [
            {
              blocks: [
                {
                  type: "tool",
                  id: "1",
                  name: "Read",
                  compactParams: "file.txt",
                },
              ],
            },
          ],
        };
        return Promise.resolve(agent as unknown as WaveAgent);
      },
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    await capturedCanUseTool!({
      toolName: "Read",
      toolInput: {},
      permissionMode: "default",
      toolCallId: "1",
    });

    expect(mockConnection.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCall: expect.objectContaining({
          toolCallId: "1",
          title: "Read: file.txt",
        }),
      }),
    );
  });

  it("should include shortResult in tool call content", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Grep",
      stage: "end",
      success: true,
      shortResult: "Found 3 matches",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "1",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "Found 3 matches",
              },
            },
          ],
        }),
      }),
    );
  });

  it("should not include bash command text in tool call content", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Bash",
      stage: "start",
      parameters: JSON.stringify({
        command: "ls -la",
      }),
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          content: undefined,
        }),
      }),
    );
  });

  it("should include formatted bash shortResult in tool call content", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "Bash",
      stage: "end",
      success: true,
      shortResult: "test output",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "1",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "```\ntest output\n```",
              },
            },
          ],
        }),
      }),
    );
  });

  it("should include locations for LSP tool and prioritize startLineNumber", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // LSP tool
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "LSP",
      stage: "start",
      parameters: JSON.stringify({
        filePath: "/test/file.ts",
        line: 10,
        character: 5,
      }),
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          locations: [
            {
              path: "/test/file.ts",
              line: 10,
            },
          ],
        }),
      }),
    );

    // Edit tool with startLineNumber
    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "2",
      name: "Edit",
      stage: "end",
      success: true,
      parameters: JSON.stringify({
        file_path: "/test/file.txt",
        old_string: "old",
        new_string: "new",
      }),
      startLineNumber: 42,
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "2",
          locations: [
            {
              path: "/test/file.txt",
              line: 42,
            },
          ],
        }),
      }),
    );
  });

  it("should handle prompt with embedded resources", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.prompt({
      sessionId: "session-1",
      prompt: [
        { type: "text", text: "check this resource:" },
        {
          type: "resource",
          resource: { uri: "file:///test/file.txt", text: "file content" },
        },
      ],
    });

    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith(
      "check this resource:\n[Resource](file:///test/file.txt)",
      undefined,
    );
  });

  it("should handle prompt with mixed content", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.prompt({
      sessionId: "session-1",
      prompt: [
        { type: "text", text: "text 1" },
        { type: "image", data: "img1", mimeType: "image/png" },
        { type: "resource", resource: { uri: "uri1", text: "res1" } },
        { type: "text", text: "text 2" },
        { type: "image", data: "img2", mimeType: "image/jpeg" },
      ],
    });

    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith(
      "text 1\n[Resource](uri1)\ntext 2",
      [
        { path: "data:image/png;base64,img1", mimeType: "image/png" },
        { path: "data:image/jpeg;base64,img2", mimeType: "image/jpeg" },
      ],
    );
  });

  it("should include raw JSON content for unknown tools", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "UnknownTool",
      stage: "start",
      parameters: JSON.stringify({
        arg1: "val1",
        arg2: 42,
      }),
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          content: undefined,
        }),
      }),
    );
  });

  it("should forward onUserMessageAdded callback as user_message_chunk", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onUserMessageAdded!({
      content: "Hello from cron job",
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Hello from cron job" },
        }),
      }),
    );
  });

  it("should pass mcpServers to WaveAgent.create for newSession", async () => {
    let capturedOptions: AgentOptions;
    const mockWaveAgent = {
      sessionId: "session-mcp-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedOptions = options;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({
      cwd: "/test",
      mcpServers: [
        {
          name: "filesystem",
          command: "/path/to/mcp-server",
          args: ["--stdio"],
          env: [{ name: "API_KEY", value: "secret" }],
        },
      ],
    });

    expect(capturedOptions!.mcpServers).toEqual({
      filesystem: {
        command: "/path/to/mcp-server",
        args: ["--stdio"],
        env: { API_KEY: "secret" },
      },
    });
  });

  it("should convert HTTP mcpServers to SDK format", async () => {
    let capturedOptions: AgentOptions;
    const mockWaveAgent = {
      sessionId: "session-http-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedOptions = options;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({
      cwd: "/test",
      mcpServers: [
        {
          type: "http",
          name: "api-server",
          url: "https://api.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer token123" }],
        },
      ],
    });

    expect(capturedOptions!.mcpServers).toEqual({
      "api-server": {
        type: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer token123" },
      },
    });
  });

  it("should convert SSE mcpServers to SDK format", async () => {
    let capturedOptions: AgentOptions;
    const mockWaveAgent = {
      sessionId: "session-sse-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedOptions = options;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({
      cwd: "/test",
      mcpServers: [
        {
          type: "sse",
          name: "event-stream",
          url: "https://events.example.com/mcp",
          headers: [{ name: "X-API-Key", value: "apikey456" }],
        },
      ],
    });

    expect(capturedOptions!.mcpServers).toEqual({
      "event-stream": {
        type: "sse",
        url: "https://events.example.com/mcp",
        headers: { "X-API-Key": "apikey456" },
      },
    });
  });

  it("should forward onMcpServersChange callback as ext_notification", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-servers-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const callbacks = capturedCallbacks as unknown as Record<string, unknown>;
    expect(typeof callbacks.onMcpServersChange).toBe("function");

    const onMcpServersChange = callbacks.onMcpServersChange as (
      servers: import("wave-agent-sdk").McpServerStatus[],
    ) => void;
    onMcpServersChange([
      {
        name: "filesystem",
        status: "connected",
        config: { command: "/path/to/server", args: [] },
        toolCount: 5,
      },
      {
        name: "api-server",
        status: "error",
        config: { url: "https://api.example.com" },
        error: "Connection refused",
      },
    ]);

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "ext_notification",
          method: "mcp_server_status",
          params: expect.objectContaining({
            name: "filesystem",
            status: "connected",
            toolCount: 5,
          }),
        }),
      }),
    );

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "ext_notification",
          method: "mcp_server_status",
          params: expect.objectContaining({
            name: "api-server",
            status: "error",
            error: "Connection refused",
          }),
        }),
      }),
    );
  });

  it("should advertise mcpCapabilities in initialize response", async () => {
    const response = await agent.initialize();
    expect(response.agentCapabilities?.mcpCapabilities).toEqual({
      http: true,
      sse: true,
    });
  });

  it("should include raw JSON content for MCP tools", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
      messageId: "msg-test-id",
      id: "1",
      name: "mcp__UnknownTool",
      stage: "start",
      parameters: JSON.stringify({
        arg1: "val1",
        arg2: 42,
      }),
    });

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          toolCallId: "1",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: '```json\n{\n  "arg1": "val1",\n  "arg2": 42\n}\n```',
              },
            },
          ],
        }),
      }),
    );
  });

  it("should use wave/ask_question extMethod for AskUserQuestion", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockResolvedValue({
      outcome: "answered",
      answers: [{ questionId: "q0", selectedOptionIds: ["0"] }],
    });

    const decision = await canUseToolCallback!({
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            question: "Which library?",
            header: "Library choice",
            options: [
              { label: "date-fns", description: "Lightweight" },
              { label: "moment", description: "Legacy" },
            ],
          },
        ],
      },
      permissionMode: "default",
      toolCallId: "tool-call-1",
    });

    expect(decision.behavior).toBe("allow");
    expect(JSON.parse(decision.message!)).toEqual({
      "Which library?": "date-fns",
    });
    expect(mockConnection.extMethod).toHaveBeenCalledWith(
      "wave/ask_question",
      expect.objectContaining({
        toolCallId: "tool-call-1",
        questions: expect.arrayContaining([
          expect.objectContaining({
            id: "q0",
            prompt: "Which library?",
          }),
        ]),
      }),
    );
    expect(mockConnection.requestPermission).not.toHaveBeenCalled();
  });

  it("should fall back to requestPermission when wave/ask_question extMethod fails", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockRejectedValue(
      new Error("not implemented"),
    );
    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
      message: JSON.stringify({ "Which?": "A" }),
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          { question: "Which?", header: "h", options: [{ label: "A" }] },
        ],
      },
      permissionMode: "default",
    });

    expect(decision.behavior).toBe("allow");
    expect(mockConnection.requestPermission).toHaveBeenCalled();
  });

  it("should use wave/create_plan extMethod for ExitPlanMode (accepted)", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockResolvedValue({
      outcome: "accepted",
    });

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      permissionMode: "plan",
      planContent: "# My Plan\nDo stuff",
      toolCallId: "plan-tool-1",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionMode).toBe("default");
    expect(mockConnection.extMethod).toHaveBeenCalledWith(
      "wave/create_plan",
      expect.objectContaining({
        toolCallId: "plan-tool-1",
        plan: "# My Plan\nDo stuff",
      }),
    );
    expect(mockConnection.requestPermission).not.toHaveBeenCalled();
  });

  it("should use custom mode from wave/create_plan response when accepted", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("bypassPermissions"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockResolvedValue({
      outcome: "accepted",
      mode: "bypassPermissions",
    });

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      permissionMode: "plan",
      planContent: "# My Plan\nDo stuff",
      toolCallId: "plan-tool-1",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionMode).toBe("bypassPermissions");
  });

  it("should use wave/create_plan extMethod for ExitPlanMode (rejected)", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockResolvedValue({
      outcome: "rejected",
      reason: "too complex",
    });

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      permissionMode: "plan",
      planContent: "# Plan",
    });

    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("too complex");
  });

  it("should fall back to requestPermission when wave/create_plan extMethod fails", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.extMethod).mockRejectedValue(
      new Error("not implemented"),
    );
    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "allow_once" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      permissionMode: "plan",
      planContent: "# Plan",
    });

    expect(decision.behavior).toBe("allow");
    expect(decision.newPermissionMode).toBe("default");
    expect(mockConnection.requestPermission).toHaveBeenCalled();
  });

  it("should populate taskCache and filter deleted tasks in onTasksChange", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onTasksChange!([
      {
        id: "t1",
        subject: "Task 1",
        description: "",
        status: "completed",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "t2",
        subject: "Task 2",
        description: "",
        status: "deleted",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "t3",
        subject: "Task 3",
        description: "",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "t4",
        subject: "Task 4",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]);

    // Verify plan session update excludes deleted task
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "plan",
          entries: [
            { content: "Task 1", status: "completed", priority: "medium" },
            { content: "Task 3", status: "in_progress", priority: "medium" },
            { content: "Task 4", status: "pending", priority: "medium" },
          ],
        }),
      }),
    );

    // Verify taskCache is populated (test via handleCreatePlan using the cache)
    vi.mocked(mockConnection.extMethod).mockResolvedValue({
      outcome: "accepted",
    });

    let canUseToolCallback: PermissionCallback;
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // Trigger onTasksChange again for the new session
    capturedCallbacks!.onTasksChange!([
      {
        id: "t1",
        subject: "Cached Task",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]);

    const decision = await canUseToolCallback!({
      toolName: "ExitPlanMode",
      toolInput: {},
      permissionMode: "plan",
      planContent: "test plan",
    });

    expect(decision.behavior).toBe("allow");
    expect(mockConnection.extMethod).toHaveBeenCalledWith(
      "wave/create_plan",
      expect.objectContaining({
        todos: [{ id: "t1", content: "Cached Task", status: "pending" }],
      }),
    );
  });

  it("should handle session ID change via onSessionIdChange callback", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-a",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
      usages: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      messages: [],
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // onSessionIdChange should be available in the wrapper callbacks
    const callbacks = capturedCallbacks as unknown as Record<string, unknown>;
    expect(typeof callbacks.onSessionIdChange).toBe("function");

    const onSessionIdChange = callbacks.onSessionIdChange as (
      newSessionId: string,
    ) => void;

    // Trigger session ID change
    onSessionIdChange("session-b");

    // Verify ext_notification was sent with session_id_change
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-a",
        update: expect.objectContaining({
          sessionUpdate: "ext_notification",
          method: "session_id_change",
          params: { oldSessionId: "session-a", newSessionId: "session-b" },
        }),
      }),
    );

    // Verify the agent is now accessible under the new session ID
    // by successfully calling prompt with the new ID
    const response = await agent.prompt({
      sessionId: "session-b",
      prompt: [{ type: "text", text: "hello" }],
    });
    expect(response.stopReason).toBe("end_turn");
    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith("hello", undefined);

    // Old session ID should no longer work
    await expect(
      agent.prompt({
        sessionId: "session-a",
        prompt: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toThrow("Session session-a not found");
  });

  it("should be a no-op when onSessionIdChange receives the same ID", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-same",
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      messages: [],
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });
    vi.mocked(mockConnection.sessionUpdate).mockClear();

    const callbacks = capturedCallbacks as unknown as Record<string, unknown>;
    const onSessionIdChange = callbacks.onSessionIdChange as (
      newSessionId: string,
    ) => void;

    // Same ID should be a no-op
    onSessionIdChange("session-same");

    // No ext_notification should be sent
    const sessionUpdateCalls = vi.mocked(mockConnection.sessionUpdate).mock
      .calls;
    const sessionIdChangeCalls = sessionUpdateCalls.filter(
      (call) =>
        (call[0] as { update: { method?: string } }).update.method ===
        "session_id_change",
    );
    expect(sessionIdChangeCalls).toHaveLength(0);
  });

  it("should replay compact block content as agent_message_chunk", async () => {
    const mockWaveAgent = {
      sessionId: "compact-replay-session",
      destroy: vi.fn(),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      messages: [
        {
          id: "msg-compact",
          role: "assistant",
          blocks: [
            {
              type: "compact",
              content: "Summary of previous conversation",
              sessionId: "old-session",
            },
          ],
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-after",
          role: "user",
          blocks: [{ type: "text", content: "Continue from summary" }],
          timestamp: new Date().toISOString(),
        },
      ],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.loadSession({
      sessionId: "compact-replay-session",
      cwd: "/test",
      mcpServers: [],
    });

    // Compact block should be replayed as agent_message_chunk
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "compact-replay-session",
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: "Summary of previous conversation",
          },
          messageId: "msg-compact",
        }),
      }),
    );

    // User message after compact should also be replayed
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "compact-replay-session",
        update: expect.objectContaining({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Continue from summary" },
          messageId: "msg-after",
        }),
      }),
    );
  });

  it("should send usage_update sessionUpdate on onLatestTotalTokensChange", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      getMaxInputTokens: vi.fn().mockReturnValue(200000),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onLatestTotalTokensChange!(50000);

    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "usage_update",
          size: 200000,
          used: 50000,
        }),
      }),
    );
  });

  it("should return per-turn usage in PromptResponse", async () => {
    const usages: Array<Record<string, number>> = [];
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockImplementation(async () => {
        usages.push({
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        });
      }),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      get usages() {
        return usages;
      },
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(response.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(response.usage).not.toHaveProperty("cachedReadTokens");
    expect(response.usage).not.toHaveProperty("cachedWriteTokens");
  });

  it("should include cache tokens in usage when present", async () => {
    const usages: Array<Record<string, number>> = [];
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockImplementation(async () => {
        usages.push({
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 20,
        });
      }),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      get usages() {
        return usages;
      },
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(response.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedReadTokens: 30,
      cachedWriteTokens: 20,
    });
  });

  it("should echo userMessageId from PromptRequest", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      usages: [],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
      messageId: "msg-123",
    });

    expect(response.userMessageId).toBe("msg-123");
  });

  it("should omit usage from PromptResponse when no usages tracked", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      usages: [],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(response.usage).toBeUndefined();
  });

  it("should sum multiple usage entries for a single turn", async () => {
    const usages: Array<Record<string, number>> = [];
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockImplementation(async () => {
        usages.push({
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        });
        usages.push({
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
        });
      }),
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getConfiguredModels: vi.fn().mockReturnValue(["test-model"]),
      getModelConfig: vi.fn().mockReturnValue({ model: "test-model" }),
      getSlashCommands: vi.fn().mockReturnValue([]),
      get usages() {
        return usages;
      },
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    const response = await agent.prompt({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "hello" }],
    });

    expect(response.usage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
    });
  });
});
