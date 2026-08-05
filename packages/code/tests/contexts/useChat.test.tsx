import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ChatProvider,
  useChat,
  ChatContextType,
} from "../../src/contexts/useChat.js";
import { Agent, BackgroundShell, Task } from "wave-agent-sdk";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { useInput } from "ink";

// Mock ink
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn(() => ({
      stdout: {
        write: (_data: string, callback?: () => void) => {
          callback?.();
        },
      },
    })),
  };
});

// Mock wave-agent-sdk
vi.mock("wave-agent-sdk", async () => {
  const actual = await vi.importActual("wave-agent-sdk");
  return {
    ...actual,
    Agent: {
      create: vi.fn(),
    },
  };
});

// Mock useAppConfig
vi.mock("../../src/contexts/useAppConfig.js", async () => {
  const actual = await vi.importActual("../../src/contexts/useAppConfig.js");
  return {
    ...actual,
    useAppConfig: vi.fn(() => ({
      restoreSessionId: undefined,
      continueLastSession: false,
    })),
  };
});

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock usageSummary
vi.mock("../../src/utils/usageSummary.js", () => ({
  displayUsageSummary: vi.fn(),
}));

describe("ChatProvider", () => {
  const mockAgent = {
    sessionId: "test-session",
    messages: [],
    isLoading: false,
    latestTotalTokens: 0,
    isCommandRunning: false,
    isCompacting: false,
    userInputHistory: [],
    getPermissionMode: vi.fn(() => "default"),
    getMcpServers: vi.fn(() => []),
    getSlashCommands: vi.fn(() => []),
    sendMessage: vi.fn(),
    bang: vi.fn(),
    abortMessage: vi.fn(),
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    getBackgroundTaskOutput: vi.fn(),
    stopBackgroundTask: vi.fn(),
    hasSlashCommand: vi.fn(),
    truncateHistory: vi.fn(),
    backgroundCurrentTask: vi.fn(),
    destroy: vi.fn(),
    setPermissionMode: vi.fn(),
    askBtw: vi.fn(),
    usages: [],
    sessionFilePath: "test-path",
    triggerWorktreeRemoveHook: vi.fn(),
    getModelConfig: vi.fn(() => ({
      model: "test-model",
      fastModel: "test-fast-model",
    })),
    getConfiguredModels: vi.fn(() => []),
    getGatewayConfig: vi.fn(() => ({ serverUrl: "http://localhost:8080" })),
    getMaxInputTokens: vi.fn(() => 128000),
    getWorkflowRuns: vi.fn(() => []),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset the shared mock agent's message list — tests mutate it via
    // Object.assign and initializeAgent's initial pull reads it at mount.
    mockAgent.messages = [];
    vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper component to test the hook
  function TestComponent({
    onHookValue,
  }: {
    onHookValue: (value: ChatContextType) => void;
  }) {
    const hookValue = useChat();
    useEffect(() => {
      onHookValue(hookValue);
    }, [hookValue, onHookValue]);
    return null;
  }

  const renderWithProvider = (
    onHookValue: (value: ChatContextType) => void,
    props = {},
  ) => {
    return render(
      <AppProvider>
        <ChatProvider {...props}>
          <TestComponent onHookValue={onHookValue} />
        </ChatProvider>
      </AppProvider>,
    );
  };

  it("initializes correctly", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
      expect(lastValue?.sessionId).toBe("test-session");
    });
  });

  it("handles agent callbacks", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Test onUserMessageAdded (incremental — reads agent.messages tail)
    const newMessages = [
      {
        id: "msg-1",
        role: "user" as const,
        blocks: [{ type: "text" as const, content: "test" }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 50,
          total_tokens: 100,
        },
        timestamp: new Date().toISOString(),
      },
    ];
    Object.assign(mockAgent, { messages: newMessages });
    callbacks.onUserMessageAdded!({ content: "test" });

    // Test onLatestTotalTokensChange
    callbacks.onLatestTotalTokensChange!(100);

    // Test onMcpServersChange
    const newServers = [
      {
        name: "test-server",
        status: "connected" as const,
        config: { command: "test" },
      },
    ];
    callbacks.onMcpServersChange!(newServers);

    // Test onSessionIdChange
    callbacks.onSessionIdChange!("new-session");

    // Test onCompactionStateChange
    callbacks.onCompactionStateChange!(true);

    // Test onBackgroundTasksChange
    const newTasks = [
      {
        id: "task1",
        type: "shell" as const,
        status: "running" as const,
        stdout: "",
        stderr: "",
        startTime: 0,
        process: {} as unknown as BackgroundShell["process"],
      },
    ];
    callbacks.onBackgroundTasksChange!(newTasks);

    // Test onPermissionModeChange
    callbacks.onPermissionModeChange!("bypassPermissions");

    await vi.waitFor(() => {
      expect(lastValue?.messages).toEqual(newMessages);
      expect(lastValue?.mcpServers).toEqual(newServers);
      expect(lastValue?.sessionId).toBe("new-session");
      expect(lastValue?.latestTotalTokens).toBe(100);
      expect(lastValue?.isCompacting).toBe(true);
      expect(lastValue?.backgroundTasks).toEqual(newTasks);
      expect(lastValue?.permissionMode).toBe("bypassPermissions");
    });
  });

  it("handles sendMessage for normal AI messages", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("Hello AI");

    expect(mockAgent.sendMessage).toHaveBeenCalledWith("Hello AI", undefined);
  });

  it("handles sendMessage with long text placeholders", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const content = "Check this: [LongText#1]";
    const longTextMap = { "[LongText#1]": "Expanded content" };
    await lastValue?.sendMessage(content, undefined, longTextMap);

    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      "Check this: Expanded content",
      undefined,
    );
  });

  it("handles sendMessage for bash commands", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("!ls -la");

    expect(mockAgent.bang).toHaveBeenCalledWith("ls -la");
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it("handles sendMessage for memory messages", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("#Remember this");

    // Memory messages starting with # are now treated as normal messages
    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      "#Remember this",
      undefined,
    );
    expect(mockAgent.bang).not.toHaveBeenCalled();
  });

  it("handles MCP management", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    mockAgent.connectMcpServer.mockResolvedValue(true);
    const connected = await lastValue?.connectMcpServer("test-server");
    expect(mockAgent.connectMcpServer).toHaveBeenCalledWith("test-server");
    expect(connected).toBe(true);

    mockAgent.disconnectMcpServer.mockResolvedValue(true);
    const disconnected = await lastValue?.disconnectMcpServer("test-server");
    expect(mockAgent.disconnectMcpServer).toHaveBeenCalledWith("test-server");
    expect(disconnected).toBe(true);
  });

  it("handles background task management", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const mockOutput = { stdout: "out", stderr: "", status: "running" };
    mockAgent.getBackgroundTaskOutput.mockReturnValue(mockOutput);
    const output = lastValue?.getBackgroundTaskOutput("task-1");
    expect(mockAgent.getBackgroundTaskOutput).toHaveBeenCalledWith("task-1");
    expect(output).toEqual(mockOutput);

    mockAgent.stopBackgroundTask.mockReturnValue(true);
    const stopped = lastValue?.stopBackgroundTask("task-1");
    expect(mockAgent.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    expect(stopped).toBe(true);
  });

  it("handles rewind functionality", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.handleRewindSelect(5);
    expect(mockAgent.truncateHistory).toHaveBeenCalledWith(5);
  });

  it("handles abortMessage", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    lastValue?.abortMessage();
    expect(mockAgent.abortMessage).toHaveBeenCalled();
  });

  it("handles setPermissionMode", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    // First set it to something different from initial "default"
    lastValue?.setPermissionMode("bypassPermissions");
    await vi.waitFor(() => {
      expect(mockAgent.setPermissionMode).toHaveBeenCalledWith(
        "bypassPermissions",
      );
    });
  });

  it("handles hasSlashCommand", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    mockAgent.hasSlashCommand.mockReturnValue(true);
    const has = lastValue?.hasSlashCommand("test");
    expect(mockAgent.hasSlashCommand).toHaveBeenCalledWith("test");
    expect(has).toBe(true);
  });

  it("handles hideConfirmation", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    lastValue?.showConfirmation("test-tool");
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    lastValue?.hideConfirmation();
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });
  });

  it("handles bypassPermissions prop", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue, { bypassPermissions: true });

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: "bypassPermissions",
        }),
      );
    });

    // canUseTool callback should still be provided so it can be used
    // when the user switches to another permission mode
    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(agentCreateArgs.canUseTool).toBeDefined();
    expect(lastValue?.permissionMode).toBe("bypassPermissions");
  });

  it("provides canUseTool callback when started with bypassPermissions so mode switching works", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue, { bypassPermissions: true });

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    // Verify callback is defined even when bypassPermissions is true
    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const canUseTool = agentCreateArgs.canUseTool;
    expect(canUseTool).toBeDefined();

    // Simulate calling the callback as would happen when permissionMode is
    // changed from bypassPermissions to acceptEdits and a restricted tool
    // (Bash) needs confirmation
    const decisionPromise = canUseTool!({
      toolName: "Bash",
      toolInput: { command: "ls -la" },
      permissionMode: "acceptEdits",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    // Accept the confirmation to resolve the promise
    lastValue?.handleConfirmationDecision({ behavior: "allow" });
    const decision = await decisionPromise;
    expect(decision).toEqual({ behavior: "allow" });
  });

  it("handles pluginDirs prop", async () => {
    const onHookValue = () => {};

    renderWithProvider(onHookValue, { pluginDirs: ["/path/to/plugin"] });

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          plugins: [{ type: "local", path: "/path/to/plugin" }],
        }),
      );
    });
  });

  it("handles agent.create error", async () => {
    vi.spyOn(console, "error").mockImplementation(function () {});
    vi.mocked(Agent.create).mockRejectedValue(
      new Error("Failed to create agent"),
    );

    const onHookValue = () => {};

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        "Failed to initialize AI manager:",
        expect.any(Error),
      );
    });
  });

  it("handles sendMessage error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    mockAgent.sendMessage.mockRejectedValue(new Error("Send failed"));

    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("test");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to send message:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("handles bang error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    mockAgent.bang.mockRejectedValue(new Error("Bash failed"));

    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("!ls");
    // It should catch and log error, but we already tested sendMessage error handling
    // The important thing is it doesn't crash and resets isCommandRunning
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to send message:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("handles truncateHistory error", async () => {
    vi.spyOn(console, "error").mockImplementation(function () {});
    mockAgent.truncateHistory.mockRejectedValue(new Error("Rewind failed"));

    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.handleRewindSelect(1);
    // Should not crash
    const { logger } = await import("../../src/utils/logger.js");
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to rewind:",
      expect.any(Error),
    );
  });

  it("handles empty sendMessage", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("  ");
    expect(mockAgent.sendMessage).not.toHaveBeenCalled();
  });

  it("handles memory message with empty text", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("# ");
    // Memory messages starting with # are now treated as normal messages
    expect(mockAgent.sendMessage).toHaveBeenCalledWith("# ", undefined);
  });

  it("handles bash message with empty command", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    await lastValue?.sendMessage("! ");
    expect(mockAgent.bang).not.toHaveBeenCalled();
  });

  it("handles canUseTool callback from agent", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const canUseTool = agentCreateArgs.canUseTool;
    expect(canUseTool).toBeDefined();

    // Trigger the callback
    const decisionPromise = canUseTool!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    lastValue?.handleConfirmationDecision({ behavior: "allow" });
    const decision = await decisionPromise;
    expect(decision).toEqual({ behavior: "allow" });
  });

  it("handles canUseTool callback rejection", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const canUseTool = agentCreateArgs.canUseTool;

    // Trigger the callback
    const decisionPromise = canUseTool!({
      toolName: "test-tool",
      toolInput: {},
      permissionMode: "default",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    lastValue?.handleConfirmationCancel();
    const decision = await decisionPromise;
    expect(decision.behavior).toBe("deny");
  });

  it("handles usage summary error during cleanup", async () => {
    const displayUsageSummary = (
      await import("../../src/utils/usageSummary.js")
    ).displayUsageSummary;
    vi.mocked(displayUsageSummary).mockImplementation(function () {
      throw new Error("Summary failed");
    });

    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    const { unmount } = renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    unmount();
    expect(mockAgent.destroy).toHaveBeenCalled();
  });

  it("handles permission confirmation flow", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const decisionPromise = lastValue?.showConfirmation("test-tool", {
      arg: 1,
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
      expect(lastValue?.confirmingTool?.name).toBe("test-tool");
    });

    // Resolve confirmation
    lastValue?.handleConfirmationDecision({ behavior: "allow" });

    const decision = await decisionPromise;
    expect(decision).toEqual({ behavior: "allow" });
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });
  });

  it("handles confirmation cancellation", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const decisionPromise = lastValue?.showConfirmation("test-tool");

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    lastValue?.handleConfirmationCancel();

    await expect(decisionPromise).rejects.toBeUndefined();
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });
    expect(mockAgent.abortMessage).toHaveBeenCalled();
  });

  it("toggles isExpanded with Ctrl+O", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    // Get the useInput callback
    const useInputMock = vi.mocked(useInput);
    const inputCallback = useInputMock.mock.calls.find((call) =>
      call[0].toString().includes("ctrl"),
    )?.[0];
    expect(inputCallback).toBeDefined();
    const handler = inputCallback!;

    // Initially not expanded
    expect(lastValue?.isExpanded).toBe(false);
    const initialRemountKey = lastValue?.remountKey;

    // Simulate Ctrl+O to expand
    handler("o", { ctrl: true } as Parameters<typeof handler>[1]);

    await vi.waitFor(() => {
      expect(lastValue?.isExpanded).toBe(true);
    });

    // Remount should be requested (remountKey should increment)
    expect(lastValue?.remountKey).toBe(initialRemountKey! + 1);

    // Simulate Ctrl+O again to collapse
    handler("o", { ctrl: true } as Parameters<typeof handler>[1]);

    await vi.waitFor(() => {
      expect(lastValue?.isExpanded).toBe(false);
    });

    // Remount should be requested again
    expect(lastValue?.remountKey).toBe(initialRemountKey! + 2);
  });

  it("freezes message updates while expanded", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Deliver an assistant message incrementally (lands in state)
    const msg1 = [
      {
        id: "msg-1",
        role: "assistant" as const,
        blocks: [],
        timestamp: new Date().toISOString(),
      },
    ];
    Object.assign(mockAgent, { messages: msg1 });
    callbacks.onAssistantMessageAdded!("msg-1");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toEqual(msg1);
    });

    // Get the useInput callback
    const useInputMock = vi.mocked(useInput);
    const inputCallback =
      useInputMock.mock.calls[useInputMock.mock.calls.length - 1][0];

    // Simulate Ctrl+O to expand — the view freezes
    inputCallback("o", { ctrl: true } as Parameters<typeof inputCallback>[1]);
    await vi.waitFor(() => {
      expect(lastValue?.isExpanded).toBe(true);
    });

    // Incremental updates while expanded should be dropped (frozen snapshot)
    const msg2 = [
      {
        id: "msg-2",
        role: "assistant" as const,
        blocks: [],
        timestamp: new Date().toISOString(),
      },
    ];
    Object.assign(mockAgent, { messages: msg2 });
    callbacks.onAssistantMessageAdded!("msg-2");
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-1",
      chunk: "hi",
      accumulated: "hi",
      stage: "streaming",
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(lastValue?.messages).toEqual(msg1);

    // Collapse restores the agent's actual state (full pull)
    inputCallback("o", { ctrl: true } as Parameters<typeof inputCallback>[1]);
    await vi.waitFor(() => {
      expect(lastValue?.isExpanded).toBe(false);
      expect(lastValue?.messages).toEqual(msg2);
    });
  });

  it("cancels confirmation with ESC key", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const decisionPromise = lastValue?.showConfirmation("test-tool");

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    // Get the useInput callback
    const useInputMock = vi.mocked(useInput);
    const inputCallback =
      useInputMock.mock.calls[useInputMock.mock.calls.length - 1][0];

    // Simulate ESC
    inputCallback("", { escape: true } as Parameters<typeof inputCallback>[1]);

    await expect(decisionPromise).rejects.toBeUndefined();
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });
  });

  it("handles backgroundCurrentTask", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    lastValue?.backgroundCurrentTask();
    expect(mockAgent.backgroundCurrentTask).toHaveBeenCalled();
  });

  // it("throws error when useChat is used outside of ChatProvider", () => {
  //   const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  //   const TestComponent = () => {
  //     useChat();
  //     return null;
  //   };

  //   expect(() => {
  //     try {
  //       render(<TestComponent />);
  //     } catch (e) {
  //       throw new Error("Caught: " + (e as Error).message);
  //     }
  //   }).toThrow();
  //   consoleSpy.mockRestore();
  // });

  it("handles multiple confirmations in queue", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const decisionPromise1 = lastValue?.showConfirmation("tool1");
    const decisionPromise2 = lastValue?.showConfirmation("tool2");

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
      expect(lastValue?.confirmingTool?.name).toBe("tool1");
    });

    // Resolve first confirmation
    lastValue?.handleConfirmationDecision({ behavior: "allow" });
    await expect(decisionPromise1).resolves.toEqual({ behavior: "allow" });

    // Second confirmation should now be visible
    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
      expect(lastValue?.confirmingTool?.name).toBe("tool2");
    });

    lastValue?.handleConfirmationDecision({ behavior: "deny" });
    await expect(decisionPromise2).resolves.toEqual({ behavior: "deny" });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });
  });

  it("handles setPermissionMode when mode is same as current", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    // Initial mode is "default"
    lastValue?.setPermissionMode("default");
    expect(mockAgent.setPermissionMode).not.toHaveBeenCalled();
  });

  it("handles sendMessage with images", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const images = [{ path: "test.png", mimeType: "image/png" }];
    await lastValue?.sendMessage("", images);

    expect(mockAgent.sendMessage).toHaveBeenCalledWith("", images);
  });

  it("handles sendMessage with multiline memory message", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const multilineMemory = "#line1\nline2";
    await lastValue?.sendMessage(multilineMemory);

    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      multilineMemory,
      undefined,
    );
  });

  it("handles sendMessage with multiline bash message", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const multilineBash = "!line1\nline2";
    await lastValue?.sendMessage(multilineBash);

    expect(mockAgent.sendMessage).toHaveBeenCalledWith(
      multilineBash,
      undefined,
    );
  });

  it("handles agent.getMcpServers and agent.getSlashCommands returning undefined", async () => {
    const minimalAgent = {
      ...mockAgent,
      getMcpServers: undefined,
      getSlashCommands: undefined,
    };
    vi.mocked(Agent.create).mockResolvedValue(minimalAgent as unknown as Agent);

    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue?.mcpServers).toEqual([]);
      expect(lastValue?.slashCommands).toEqual([]);
    });
  });

  it("clears queuedMessages when abortMessage is called", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Simulate the SDK enqueueing a message (agent.sendMessage called while busy)
    callbacks.onQueuedMessagesChange!([{ content: "Second message" }]);

    await vi.waitFor(() => {
      expect(lastValue?.queuedMessages).toHaveLength(1);
      expect(lastValue?.queuedMessages[0].content).toBe("Second message");
    });

    // Call abortMessage (SDK clears queue and fires onQueuedMessagesChange)
    lastValue?.abortMessage();

    // Simulate the SDK firing the callback after clearing
    callbacks.onQueuedMessagesChange!([]);

    await vi.waitFor(() => {
      expect(lastValue?.queuedMessages).toHaveLength(0);
      expect(mockAgent.abortMessage).toHaveBeenCalled();
    });
  });

  it("updates messages incrementally on streaming callbacks", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Initial state: 0 messages
    expect(lastValue?.messages).toEqual([]);

    // Assistant message added via incremental callback
    const assistantMsg = {
      id: "msg-1",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-1");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Streaming content chunks update the text block in place
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-1",
      chunk: "Hel",
      accumulated: "Hel",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      expect(lastValue?.messages[0].blocks[0]).toEqual({
        type: "text",
        content: "Hel",
        stage: "streaming",
      });
    });

    callbacks.onAssistantContentUpdated!({
      messageId: "msg-1",
      chunk: "lo",
      accumulated: "Hello",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      expect(lastValue?.messages[0].blocks).toHaveLength(1);
      expect(
        (lastValue?.messages[0].blocks[0] as { content: string }).content,
      ).toBe("Hello");
    });

    // Tool block updates land in place
    callbacks.onToolBlockUpdated!({
      messageId: "msg-1",
      id: "tool-1",
      name: "bash",
      stage: "streaming",
      parametersChunk: "{",
    });
    await vi.waitFor(() => {
      expect(
        lastValue?.messages[0].blocks.some(
          (b) => b.type === "tool" && b.id === "tool-1",
        ),
      ).toBe(true);
    });

    // Error block is appended to the assistant message
    callbacks.onErrorBlockAdded!("boom");
    await vi.waitFor(() => {
      expect(
        lastValue?.messages[0].blocks.some(
          (b) => b.type === "error" && b.content === "boom",
        ),
      ).toBe(true);
    });
  });

  it("throttles streaming updates to 500ms and flushes immediately on end", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    const assistantMsg = {
      id: "msg-throttle",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-throttle");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Leading edge applies immediately
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: "Hel",
      accumulated: "Hel",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      expect(
        (lastValue?.messages[0].blocks[0] as { content: string }).content,
      ).toBe("Hel");
    });

    // Subsequent chunks within the 500ms window are coalesced (trailing)
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: "lo",
      accumulated: "Hello",
      stage: "streaming",
    });
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: " Wor",
      accumulated: "Hello Wor",
      stage: "streaming",
    });
    // No timer advanced yet — still shows the leading update
    expect(
      (lastValue?.messages[0].blocks[0] as { content: string }).content,
    ).toBe("Hel");

    // stage === "end" flushes the accumulated content immediately
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: "ld",
      accumulated: "Hello World",
      stage: "end",
    });
    await vi.waitFor(() => {
      expect(
        (lastValue?.messages[0].blocks[0] as { content: string }).content,
      ).toBe("Hello World");
    });

    // Tool block updates are throttled too; start applies immediately
    callbacks.onToolBlockUpdated!({
      messageId: "msg-throttle",
      id: "tool-thr",
      name: "bash",
      stage: "start",
      parameters: "",
    });
    await vi.waitFor(() => {
      expect(
        lastValue?.messages[0].blocks.some(
          (b) => b.type === "tool" && b.id === "tool-thr",
        ),
      ).toBe(true);
    });

    // Mid-stream parameter updates coalesce; end applies the final state right away
    callbacks.onToolBlockUpdated!({
      messageId: "msg-throttle",
      id: "tool-thr",
      stage: "streaming",
      parametersChunk: "{",
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-throttle",
      id: "tool-thr",
      stage: "streaming",
      parametersChunk: '"cmd"',
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-throttle",
      id: "tool-thr",
      stage: "end",
      result: "ok",
      success: true,
      parameters: '{"cmd":"ls"}',
    });
    await vi.waitFor(() => {
      const toolBlock = lastValue?.messages[0].blocks.find(
        (b) => b.type === "tool" && b.id === "tool-thr",
      );
      expect(toolBlock).toMatchObject({
        stage: "end",
        result: "ok",
        success: true,
        parameters: '{"cmd":"ls"}',
      });
    });
  });

  it("throttles reasoning streaming updates and flushes on end", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Start with a text block so the reasoning append + in-place update paths
    // both map over a multi-block message
    const assistantMsg = {
      id: "msg-reason",
      role: "assistant" as const,
      blocks: [{ type: "text" as const, content: "pre" }],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-reason");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Leading edge appends a new reasoning block immediately
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "Th",
      accumulated: "Th",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Th");
    });

    // Subsequent chunks within the 500ms window are coalesced (trailing)
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "ink",
      accumulated: "Think",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "ing",
      accumulated: "Thinking",
      stage: "streaming",
    });
    const beforeFlush = lastValue?.messages[0].blocks.find(
      (b) => b.type === "reasoning",
    ) as { content: string } | undefined;
    expect(beforeFlush?.content).toBe("Th");

    // stage === "end" flushes the accumulated reasoning as an in-place update
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "…",
      accumulated: "Thinking complete",
      stage: "end",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Thinking complete");
    });

    // Unknown messageId leaves messages untouched
    callbacks.onAssistantReasoningUpdated!({
      messageId: "nonexistent",
      chunk: "x",
      accumulated: "x",
      stage: "end",
    });
    expect(lastValue?.messages[0].blocks).toHaveLength(2);
  });

  it("handles bang message callbacks", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // onAddBangMessage appends a new user message with a bang block
    callbacks.onAddBangMessage!("ls", "bang-1");
    await vi.waitFor(() => {
      expect(lastValue?.messages.some((m) => m.id === "bang-1")).toBe(true);
    });

    // A duplicate messageId must not append a second message
    callbacks.onAddBangMessage!("ls", "bang-1");
    await vi.waitFor(() => {
      expect(lastValue?.messages.filter((m) => m.id === "bang-1")).toHaveLength(
        1,
      );
    });

    // onUpdateBangMessage patches the trailing bang block in place
    callbacks.onUpdateBangMessage!("ls -la", "file.txt\n", "bang-1");
    await vi.waitFor(() => {
      const msg = lastValue!.messages.find((m) => m.id === "bang-1")!;
      const bangBlock = msg.blocks[msg.blocks.length - 1];
      expect(bangBlock).toMatchObject({
        type: "bang",
        command: "ls -la",
        output: "file.txt\n",
      });
    });

    // onCompleteBangMessage records the exit code and final stage
    callbacks.onCompleteBangMessage!("ls -la", 0, "bang-1");
    await vi.waitFor(() => {
      const msg = lastValue!.messages.find((m) => m.id === "bang-1")!;
      const bangBlock = msg.blocks[msg.blocks.length - 1];
      expect(bangBlock).toMatchObject({
        type: "bang",
        exitCode: 0,
        stage: "end",
      });
    });

    // Unknown messageId is a no-op for update/complete
    callbacks.onUpdateBangMessage!("x", "y", "nonexistent");
    callbacks.onCompleteBangMessage!("x", 1, "nonexistent");
    expect(lastValue?.messages).toHaveLength(1);
  });

  it("updates tasks only when the task list actually changes", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    const tasks = [
      { id: "t1", subject: "Task 1", status: "pending" },
    ] as unknown as Task[];
    callbacks.onTasksChange!(tasks);
    await vi.waitFor(() => {
      expect(lastValue?.tasks).toEqual(tasks);
    });

    // Identical task list → reducer keeps the previous reference
    const before = lastValue?.tasks;
    callbacks.onTasksChange!([
      { id: "t1", subject: "Task 1", status: "pending" },
    ] as unknown as Task[]);
    await vi.waitFor(() => {
      expect(lastValue?.tasks).toBe(before);
    });

    // A task status change replaces the list
    callbacks.onTasksChange!([
      { id: "t1", subject: "Task 1", status: "running" },
    ] as unknown as Task[]);
    await vi.waitFor(() => {
      expect(lastValue?.tasks[0].status).toBe("running");
    });

    // A length change replaces the list
    callbacks.onTasksChange!([
      ...tasks,
      { id: "t2", subject: "Task 2", status: "pending" },
    ] as unknown as Task[]);
    await vi.waitFor(() => {
      expect(lastValue?.tasks).toHaveLength(2);
    });
  });

  it("forceRemount writes a full screen clear and increments remountKey on every call", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    const { useStdout } = await import("ink");
    const writeSpy = vi.fn((_data: string, callback?: () => void) => {
      callback?.();
    });
    vi.mocked(useStdout).mockReturnValue({
      stdout: {
        write: writeSpy,
      } as unknown as { write: (data: string, callback?: () => void) => void },
    } as unknown as ReturnType<typeof useStdout>);

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const initialRemountKey = lastValue?.remountKey;

    // No throttling: every call writes the screen-clear escape sequence
    // and bumps the remount key (Static items re-render).
    lastValue?.forceRemount();
    lastValue?.forceRemount();

    await vi.waitFor(() => {
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy).toHaveBeenCalledWith(
        "\u001b[2J\u001b[3J\u001b[0;0H",
        expect.any(Function),
      );
      expect(lastValue?.remountKey).toBe(initialRemountKey! + 2);
    });
  });

  it("displays queued messages from SDK via onQueuedMessagesChange callback", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(lastValue).toBeDefined();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;

    // Simulate the SDK queueing a message (via onQueuedMessagesChange)
    callbacks.onQueuedMessagesChange!([{ content: "msg2" }]);

    await vi.waitFor(() => {
      expect(lastValue?.queuedMessages).toHaveLength(1);
      expect(lastValue?.queuedMessages[0].content).toBe("msg2");
    });

    // Simulate the SDK dequeuing (message sent, queue emptied)
    callbacks.onQueuedMessagesChange!([]);

    await vi.waitFor(() => {
      expect(lastValue?.queuedMessages).toHaveLength(0);
    });
  });
});
