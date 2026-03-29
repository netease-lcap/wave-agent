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
  };
  let agent: WaveAcpAgent;

  beforeEach(() => {
    mockConnection = {
      closed: new Promise(() => {}),
      requestPermission: vi.fn(),
      sessionUpdate: vi.fn(),
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

  it("should list all sessions when cwd is not provided", async () => {
    const {
      listAllSessions: listAllWaveSessions,
      truncateContent: truncateWaveContent,
    } = await import("wave-agent-sdk");
    vi.mocked(listAllWaveSessions).mockResolvedValue([
      {
        id: "session-all-1",
        workdir: "/cwd/all",
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
      getPermissionMode: vi.fn().mockReturnValue("default"),
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

    capturedCallbacks!.onAssistantContentUpdated!("chunk", "chunk");
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "chunk" },
        }),
      }),
    );

    capturedCallbacks!.onAssistantReasoningUpdated!("thought", "thought");
    expect(mockConnection.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thought" },
        }),
      }),
    );

    capturedCallbacks!.onToolBlockUpdated!({
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
      getPermissionMode: vi.fn().mockReturnValue("default"),
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
      getPermissionMode: vi.fn().mockReturnValue("default"),
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
      getPermissionMode: vi.fn().mockReturnValue("default"),
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
      id: "1",
      name: "tool",
      stage: "streaming",
    });
    expect(mockConnection.sessionUpdate).not.toHaveBeenCalled();

    // Running stage
    capturedCallbacks!.onToolBlockUpdated!({
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
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // Test with compactParams
    capturedCallbacks!.onToolBlockUpdated!({
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
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // 1. Start with name only
    capturedCallbacks!.onToolBlockUpdated!({
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
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
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

  it("should include formatted bash command in tool call content", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
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
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "**Command:**\n```bash\nls -la\n```",
              },
            },
          ],
        }),
      }),
    );
  });

  it("should include formatted bash shortResult in tool call content", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    capturedCallbacks!.onToolBlockUpdated!({
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
      getSlashCommands: vi.fn().mockReturnValue([]),
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    // LSP tool
    capturedCallbacks!.onToolBlockUpdated!({
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
      getPermissionMode: vi.fn().mockReturnValue("default"),
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
      "check this resource:[Resource](file:///test/file.txt)",
      undefined,
    );
  });

  it("should handle prompt with mixed content", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(undefined),
      getPermissionMode: vi.fn().mockReturnValue("default"),
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
      "text 1[Resource](uri1)text 2",
      [
        { path: "data:image/png;base64,img1", mimeType: "image/png" },
        { path: "data:image/jpeg;base64,img2", mimeType: "image/jpeg" },
      ],
    );
  });
});
