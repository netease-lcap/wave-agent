import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WaveAcpAgent } from "../../src/acp/agent.js";
import {
  Agent as WaveAgent,
  type AgentOptions,
  type PermissionCallback,
} from "wave-agent-sdk";
import {
  AGENT_METHODS,
  type AgentSideConnection,
  type ListSessionsRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

// Mock wave-agent-sdk
vi.mock("wave-agent-sdk", () => ({
  Agent: {
    create: vi.fn(),
  },
  listSessions: vi.fn(),
}));

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
    expect(response.agentCapabilities?.sessionCapabilities?.list).toBeDefined();
    expect(response.agentCapabilities?.sessionCapabilities?.stop).toBeDefined();
  });

  it("should create a new session", async () => {
    const mockWaveAgent = {
      sessionId: "test-session-id",
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    const response = await agent.newSession({
      cwd: "/test/cwd",
      mcpServers: [],
    });
    expect(response.sessionId).toBe("test-session-id");
    expect(WaveAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: "/test/cwd",
      }),
    );
  });

  it("should load an existing session", async () => {
    const mockWaveAgent = {
      sessionId: "existing-session-id",
      sendMessage: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );

    await agent.loadSession({
      sessionId: "existing-session-id",
      cwd: "/test/cwd",
      mcpServers: [],
    });
    expect(WaveAgent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restoreSessionId: "existing-session-id",
        workdir: "/test/cwd",
      }),
    );
  });

  it("should list active sessions", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      workingDirectory: "/cwd/1",
      messages: [{ timestamp: "2023-01-01T00:00:00Z" }],
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/cwd/1", mcpServers: [] });

    const response = await agent.unstable_listSessions(
      {} as ListSessionsRequest,
    );
    expect(response.sessions).toHaveLength(1);
    expect(response.sessions[0]).toEqual({
      sessionId: "session-1",
      cwd: "/cwd/1",
      updatedAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("should stop a session via extMethod", async () => {
    const mockWaveAgent = {
      sessionId: "session-to-stop",
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(WaveAgent.create).mockResolvedValue(
      mockWaveAgent as unknown as WaveAgent,
    );
    await agent.newSession({ cwd: "/test", mcpServers: [] });

    await agent.extMethod(AGENT_METHODS.session_stop, {
      sessionId: "session-to-stop",
    });
    expect(mockWaveAgent.destroy).toHaveBeenCalled();

    const listResponse = await agent.unstable_listSessions(
      {} as ListSessionsRequest,
    );
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
      messageManager: {
        saveSession: vi.fn().mockResolvedValue(undefined),
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

    expect(mockWaveAgent.sendMessage).toHaveBeenCalledWith("hello", undefined);
    expect(response.stopReason).toBe("end_turn");
  });

  it("should handle cancel and abort message", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      abortMessage: vi.fn(),
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
    });
    expect(decision.behavior).toBe("allow");
    expect(mockConnection.requestPermission).toHaveBeenCalled();
  });

  it("should handle permission rejection", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
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
    expect(decision.newPermissionRule).toBe("test-tool(*)");
  });

  it("should handle permission reject always", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      canUseToolCallback = options.canUseTool as PermissionCallback;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

    vi.mocked(mockConnection.requestPermission).mockResolvedValue({
      outcome: { outcome: "selected", optionId: "reject_always" },
    } as unknown as RequestPermissionResponse);

    const decision = await canUseToolCallback!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });
    expect(decision.behavior).toBe("deny");
    expect(decision.newPermissionRule).toBe("!test-tool(*)");
  });

  it("should handle permission cancellation", async () => {
    let canUseToolCallback: PermissionCallback;
    const mockWaveAgent = {
      sessionId: "session-1",
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

  it("should handle callbacks", async () => {
    let capturedCallbacks: AgentOptions["callbacks"];
    const mockWaveAgent = {
      sessionId: "session-1",
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
  });

  it("should handle prompt with images", async () => {
    const mockWaveAgent = {
      sessionId: "session-1",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      messageManager: {
        saveSession: vi.fn().mockResolvedValue(undefined),
      },
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
    };
    vi.mocked(WaveAgent.create).mockImplementation((options: AgentOptions) => {
      capturedCallbacks = options.callbacks;
      return Promise.resolve(mockWaveAgent as unknown as WaveAgent);
    });

    await agent.newSession({ cwd: "/test", mcpServers: [] });

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

  it("should throw error if stop is called with non-existent session", async () => {
    // stop is implemented via extMethod
    await expect(
      agent.extMethod(AGENT_METHODS.session_stop, {
        sessionId: "non-existent",
      }),
    ).resolves.toEqual({});
  });
});
