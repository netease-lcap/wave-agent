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
    getModelConfig: vi.fn(() => ({
      model: "test-model",
      fastModel: "test-fast-model",
    })),
    getConfiguredModels: vi.fn(() => []),
    getGatewayConfig: vi.fn(() => ({ serverUrl: "http://localhost:8080" })),
    getMaxInputTokens: vi.fn(() => 128000),
    getWorkflowRuns: vi.fn(() => []),
    getAdditionalDirectories: vi.fn(() => [] as string[]),
    addAdditionalDirectory: vi.fn(),
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
      stage: "streaming",
    });
    await vi.waitFor(() => {
      expect(lastValue?.messages[0].blocks[0]).toEqual({
        type: "text",
        content: "Hel",
        stage: "streaming",
      });
    });

    // The next chunk is a pure delta — the window-concat throttle appends it
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-1",
      chunk: "lo",
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

  it("onErrorBlockAdded creates a NEW assistant message when the last message is a user message (regression: stale assistant from a previous turn)", async () => {
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

    // Build [user, assistant, user] in the UI via incremental callbacks — the
    // latest user message has no assistant reply yet when the error fires.
    const userMsg = {
      id: "u1",
      role: "user" as const,
      blocks: [{ type: "text" as const, content: "你好" }],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [userMsg] });
    callbacks.onUserMessageAdded!({ content: "你好" });
    await vi.waitFor(() => expect(lastValue?.messages).toHaveLength(1));

    const assistantMsg = {
      id: "a1",
      role: "assistant" as const,
      blocks: [{ type: "text" as const, content: "好的" }],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [userMsg, assistantMsg] });
    callbacks.onAssistantMessageAdded!("a1");
    await vi.waitFor(() => expect(lastValue?.messages).toHaveLength(2));

    const latestUserMsg = {
      id: "u2",
      role: "user" as const,
      blocks: [{ type: "text" as const, content: "帮我执行 X" }],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, {
      messages: [userMsg, assistantMsg, latestUserMsg],
    });
    callbacks.onUserMessageAdded!({ content: "帮我执行 X" });
    await vi.waitFor(() => expect(lastValue?.messages).toHaveLength(3));

    // The error belongs BELOW the latest user message: appending to the
    // previous turn's assistant would surface it above the newest message
    // and accumulate there across repeated errors.
    callbacks.onErrorBlockAdded!("boom");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(4);
    });
    const errorMessage = lastValue!.messages[3];
    expect(errorMessage.role).toBe("assistant");
    expect(errorMessage.blocks).toEqual([{ type: "error", content: "boom" }]);
    // Previous turn's assistant message is left untouched.
    expect(lastValue!.messages[1].blocks).toEqual([
      { type: "text", content: "好的" },
    ]);
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
      stage: "streaming",
    });
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: " Wor",
      stage: "streaming",
    });
    // No timer advanced yet — still shows the leading update
    expect(
      (lastValue?.messages[0].blocks[0] as { content: string }).content,
    ).toBe("Hel");

    // stage === "end" flushes pending deltas and applies the end signal
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-throttle",
      chunk: "ld",
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

  it("accumulates parametersChunk per tool during multi-tool streaming", async () => {
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
      id: "msg-multi",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-multi");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Both tool blocks are created immediately via start
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-a",
      name: "bash",
      stage: "start",
      parameters: "",
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-b",
      name: "read",
      stage: "start",
      parameters: "",
    });
    await vi.waitFor(() => {
      expect(
        lastValue?.messages[0].blocks
          .filter((b) => b.type === "tool")
          .map((b) => b.id),
      ).toEqual(["tool-a", "tool-b"]);
    });

    // Interleaved streaming deltas (pure parametersChunk, no accumulated
    // parameters) — the first tool's deltas must survive the throttle window
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-a",
      stage: "streaming",
      parametersChunk: '{"fi',
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-b",
      stage: "streaming",
      parametersChunk: '{"file',
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-a",
      stage: "streaming",
      parametersChunk: 'le": "a.txt"}',
    });
    callbacks.onToolBlockUpdated!({
      messageId: "msg-multi",
      id: "tool-b",
      stage: "streaming",
      parametersChunk: '_path": "b.txt"}',
    });

    await vi.waitFor(() => {
      const blocks = lastValue?.messages[0].blocks.filter(
        (b) => b.type === "tool",
      );
      const params = Object.fromEntries(
        (blocks ?? []).map((b) => [
          b.id,
          (b as { parameters?: string }).parameters,
        ]),
      );
      // Regression: the plain throttle's single lastArgs slot dropped tool-a's
      // deltas, so the FIRST tool never showed streaming parameters
      expect(params["tool-a"]).toBe('{"file": "a.txt"}');
      expect(params["tool-b"]).toBe('{"file_path": "b.txt"}');
    });
  });

  it("keeps a tool block running when the throttle window straddles streaming→running", async () => {
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
      id: "msg-dot",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-dot");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Tool args start streaming; the last chunk lands inside the 500ms
    // throttle window (buffered, timer still armed)
    callbacks.onToolBlockUpdated!({
      messageId: "msg-dot",
      id: "tool-dot",
      name: "bash",
      stage: "start",
      parameters: "",
    });
    await vi.waitFor(() => {
      expect(
        lastValue?.messages[0].blocks.some(
          (b) => b.type === "tool" && b.id === "tool-dot",
        ),
      ).toBe(true);
    });

    callbacks.onToolBlockUpdated!({
      messageId: "msg-dot",
      id: "tool-dot",
      stage: "streaming",
      parametersChunk: "{",
    });

    // running arrives before the window elapses — applied immediately with
    // the authoritative parameters
    callbacks.onToolBlockUpdated!({
      messageId: "msg-dot",
      id: "tool-dot",
      name: "bash",
      stage: "running",
      parameters: '{"cmd":"ls"}',
    });
    await vi.waitFor(() => {
      const toolBlock = lastValue?.messages[0].blocks.find(
        (b) => b.type === "tool" && b.id === "tool-dot",
      );
      expect(toolBlock).toMatchObject({ stage: "running" });
    });

    // Regression: the pending streaming flush must not fire late and regress
    // the block back to "streaming" (yellow dot → gray mid-execution), nor
    // append the stale buffered chunk to the authoritative parameters.
    // The stale flush (if armed) fires as soon as the 500ms window elapses;
    // a waitFor asserting "running" would early-resolve on the not-yet-committed
    // state, so instead assert the opposite: a short poll for a regressed
    // "streaming" stage must NEVER resolve.
    await vi.advanceTimersByTimeAsync(600);
    await expect(
      vi.waitFor(
        () => {
          const tb = lastValue?.messages[0].blocks.find(
            (b) => b.type === "tool" && b.id === "tool-dot",
          );
          expect((tb as { stage?: string } | undefined)?.stage).toBe(
            "streaming",
          );
        },
        { timeout: 300, interval: 50 },
      ),
    ).rejects.toThrow();
    // The block is still running with the authoritative parameters, and the
    // stale chunk was never appended
    const toolBlock = lastValue?.messages[0].blocks.find(
      (b) => b.type === "tool" && b.id === "tool-dot",
    );
    expect(toolBlock).toMatchObject({
      stage: "running",
      parameters: '{"cmd":"ls"}',
    });
  });

  it("applies reasoning streaming updates immediately without throttling", async () => {
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

    // Every delta applies immediately — no 500ms cooldown window coalesces
    // chunks (the former window-concat throttle is removed)
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "Th",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "ink",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "ing",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Thinking");
    });

    // stage === "end" appends its delta and applies the end signal
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason",
      chunk: "…",
      stage: "end",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Thinking…");
    });

    // Unknown messageId leaves messages untouched
    callbacks.onAssistantReasoningUpdated!({
      messageId: "nonexistent",
      chunk: "x",
      stage: "end",
    });
    expect(lastValue?.messages[0].blocks).toHaveLength(2);
  });

  it("does not double-count the first content chunk when the SDK mutates the shared message in place", async () => {
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
      id: "msg-dup-text",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-dup-text");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Regression (docs/specs/core/stream-content-updates.md, 2026-08-12): the
    // SDK writes the full accumulated value onto the SAME message block
    // (in-place) BEFORE firing the chunk-delta callback. A consumer that
    // pushed the SDK message object by live reference would read the already
    // updated block and append the delta again — the first chunk ("Hello")
    // appears twice. The consumer must snapshot the message at push time.
    //
    // Note: we must wait for the message object to be REPLACED (the delta
    // reducer commits) before asserting content — a pre-commit render of a
    // live-ref message already shows "Hello" via the in-place mutation, which
    // would satisfy the content assertion without exercising the reducer.
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    sdkMsg.blocks.push({ type: "text", content: "Hello", stage: "streaming" });
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-dup-text",
      chunk: "Hello",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      // Reducer commit replaces the pushed message with a fresh object
      expect(lastValue?.messages[0]).not.toBe(sdkMsg);
      // Single "Hello", never "HelloHello" (first delta double-counted)
      expect(lastValue?.messages[0].blocks[0]).toEqual({
        type: "text",
        content: "Hello",
        stage: "streaming",
      });
    });

    // State must not share the SDK's message object (live reference)
    expect(lastValue?.messages[0]).not.toBe(mockAgent.messages[0]);
  });

  it("does not double-count the first reasoning chunk when the SDK mutates the shared message in place", async () => {
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
      id: "msg-dup-reason",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-dup-reason");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Same SDK in-place mutation as the content case — reasoning blocks are
    // updated on the shared message before the delta callback fires
    // ("Let" + accumulated slice → `LetLet me think...` on the CLI pre-fix).
    // The identity wait guards against the pre-commit render already showing
    // "Let" via the in-place mutation (see content test above).
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    sdkMsg.blocks.push({
      type: "reasoning",
      content: "Let",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-dup-reason",
      chunk: "Let",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      expect(lastValue?.messages[0]).not.toBe(sdkMsg);
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Let");
    });

    // State must not share the SDK's message object (live reference)
    expect(lastValue?.messages[0]).not.toBe(mockAgent.messages[0]);
  });

  it("does not double-count the first content chunk when messageAdded and the first delta land in the same React batch", async () => {
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
      id: "msg-same-batch-text",
      role: "assistant" as const,
      blocks: [] as Array<{
        type: string;
        content: string;
        stage: string;
      }>,
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });

    // Regression (2026-08-17): the real SDK fires addAssistantMessage() →
    // updateCurrentMessageContent() back-to-back in the SAME synchronous tick
    // (aiManager.ts onContentUpdate). React batches the two setMessages calls
    // and runs the updater functions only at flush time — AFTER the SDK has
    // written the first chunk into the shared message. A snapshot evaluated
    // lazily inside the updater then copies the post-mutation blocks, and the
    // first delta append double-counts the first word ("HelloHello"). The
    // snapshot must be captured eagerly at callback time, pre-mutation. The
    // older double-count tests above await between messageAdded and the delta,
    // which commits the batch before the mutation and misses this hole.
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    // ── no await between these three calls (real SDK order) ──
    callbacks.onAssistantMessageAdded!("msg-same-batch-text");
    sdkMsg.blocks.push({
      type: "text",
      content: "Hello",
      stage: "streaming",
    });
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-same-batch-text",
      chunk: "Hello",
      stage: "streaming",
    });
    // ───────────────────────────────────────────────────────────

    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
      const text = lastValue?.messages[0].blocks[0] as
        | { content: string }
        | undefined;
      // Single "Hello", never "HelloHello"
      expect(text?.content).toBe("Hello");
    });
  });

  it("does not double-count the first reasoning chunk when messageAdded and the first delta land in the same React batch", async () => {
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
      id: "msg-same-batch-reason",
      role: "assistant" as const,
      blocks: [] as Array<{
        type: string;
        content: string;
        stage: string;
      }>,
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });

    // Same same-tick scenario as the content case, for the reasoning channel.
    // The user-visible symptom: the reasoning stream ends and the CONTENT's
    // first word shows duplicated when the first content delta joins the same
    // batch as messageAdded (short reasoning + immediate content, or coalesced
    // stream reads) — the reasoning first word double-counts under the same
    // mechanism whenever the reasoning delta opens the batch.
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    callbacks.onAssistantMessageAdded!("msg-same-batch-reason");
    sdkMsg.blocks.push({
      type: "reasoning",
      content: "Let",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-same-batch-reason",
      chunk: "Let",
      stage: "streaming",
    });

    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      // Single "Let", never "LetLet"
      expect(reasoning?.content).toBe("Let");
    });
  });

  it("does not double-count when reasoning ends and the first content chunk joins the same batch", async () => {
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
      id: "msg-reason-to-content",
      role: "assistant" as const,
      blocks: [] as Array<{
        type: string;
        content: string;
        stage: string;
      }>,
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });

    // User's reported scenario: reasoning stream ends, the content that follows
    // shows its first word duplicated. All SDK calls below are synchronous in
    // one tick — messageAdded, reasoning mutation + delta, then the reasoning
    // finalize + content mutation + first content delta (updateCurrentMessage
    // Content finalizes the reasoning block first). Neither channel may
    // double-count.
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    callbacks.onAssistantMessageAdded!("msg-reason-to-content");
    sdkMsg.blocks.push({
      type: "reasoning",
      content: "Let me think",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason-to-content",
      chunk: "Let me think",
      stage: "streaming",
    });
    // Reasoning finalized, content begins (updateCurrentMessageContent)
    sdkMsg.blocks[0].stage = "end";
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-reason-to-content",
      chunk: "",
      stage: "end",
    });
    sdkMsg.blocks.push({
      type: "text",
      content: "Hello world",
      stage: "streaming",
    });
    callbacks.onAssistantContentUpdated!({
      messageId: "msg-reason-to-content",
      chunk: "Hello world",
      stage: "streaming",
    });

    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string; stage: string } | undefined;
      expect(reasoning?.content).toBe("Let me think");
      expect(reasoning?.stage).toBe("end");
      const text = lastValue?.messages[0].blocks.find(
        (b) => b.type === "text",
      ) as { content: string } | undefined;
      // "Hello world", never "HelloHello world"
      expect(text?.content).toBe("Hello world");
    });
  });

  it("does not duplicate content when a full-list refresh interleaves mid-stream", async () => {
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
      id: "msg-refresh",
      role: "assistant" as const,
      blocks: [],
      timestamp: new Date().toISOString(),
    };
    Object.assign(mockAgent, { messages: [assistantMsg] });
    callbacks.onAssistantMessageAdded!("msg-refresh");
    await vi.waitFor(() => {
      expect(lastValue?.messages).toHaveLength(1);
    });

    // Regression (docs/specs/core/stream-content-updates.md, 2026-08-17): the
    // removed 500ms window-concat throttle could carry a pending delta across
    // a full-list refresh — the trailing-edge flush then re-appended the
    // pre-refresh chunk on top of the authoritative snapshot ("Let me me").
    // With the throttle gone every delta applies immediately, so no pending
    // window exists for this interleaving to double-count through.
    const sdkMsg = mockAgent.messages[0] as unknown as {
      blocks: Array<{ type: string; content: string; stage: string }>;
    };
    sdkMsg.blocks.push({
      type: "reasoning",
      content: "Let",
      stage: "streaming",
    });
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-refresh",
      chunk: "Let",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Let");
    });

    // SDK accumulates to "Let me" and fires the delta — under the old
    // throttle this chunk would sit in the pending cooldown window
    sdkMsg.blocks[0].content = "Let me";
    callbacks.onAssistantReasoningUpdated!({
      messageId: "msg-refresh",
      chunk: " me",
      stage: "streaming",
    });
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Let me");
    });

    // A structural action (e.g. /clear) replaces CLI state with a full
    // snapshot of the SDK's authoritative messages mid-stream
    Object.assign(mockAgent, {
      clearMessages: vi.fn().mockResolvedValue(undefined),
    });
    await lastValue?.clearMessages();
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Let me");
    });

    // Let any leftover cooldown timer (old code) fire — the content must stay
    // byte-identical to the SDK's authoritative content, never "Let me me"
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => {
      const reasoning = lastValue?.messages[0].blocks.find(
        (b) => b.type === "reasoning",
      ) as { content: string } | undefined;
      expect(reasoning?.content).toBe("Let me");
    });
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

    // onCompleteBangMessage records the exit code, final stage AND the
    // captured output (regression: output was dropped after 9cea65ea).
    // bangManager streams nothing — output arrives only at completion, so it
    // must be delivered here with a value distinct from the earlier update.
    callbacks.onCompleteBangMessage!("ls -la", 0, "bang-1", "final-output\n");
    await vi.waitFor(() => {
      const msg = lastValue!.messages.find((m) => m.id === "bang-1")!;
      const bangBlock = msg.blocks[msg.blocks.length - 1];
      expect(bangBlock).toMatchObject({
        type: "bang",
        output: "final-output\n",
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

  describe("/add-dir", () => {
    const lastAssistantText = (val?: ChatContextType): string => {
      const msgs = val?.messages ?? [];
      const last = msgs[msgs.length - 1];
      const block = last?.blocks.find((b) => b.type === "text");
      return (block as { content?: string } | undefined)?.content ?? "";
    };

    it("bare command shows usage and current additional directories", async () => {
      vi.mocked(mockAgent.getAdditionalDirectories).mockReturnValue([
        "/opt/shared",
      ]);
      let lastValue: ChatContextType | undefined;
      const onHookValue = (val: ChatContextType) => {
        lastValue = val;
      };

      renderWithProvider(onHookValue);

      await vi.waitFor(() => {
        expect(lastValue).toBeDefined();
      });

      await lastValue!.addDir();

      await vi.waitFor(() => {
        const content = lastAssistantText(lastValue);
        expect(content).toContain("Usage: /add-dir <path> [--remember]");
        expect(content).toContain("Additional working directories:");
        expect(content).toContain("  - /opt/shared");
      });
      expect(mockAgent.getAdditionalDirectories).toHaveBeenCalled();
      expect(mockAgent.addAdditionalDirectory).not.toHaveBeenCalled();
    });

    it("adds a directory session-level without persistence by default", async () => {
      let lastValue: ChatContextType | undefined;
      const onHookValue = (val: ChatContextType) => {
        lastValue = val;
      };

      renderWithProvider(onHookValue);

      await vi.waitFor(() => {
        expect(lastValue).toBeDefined();
      });

      await lastValue!.addDir("./config");

      expect(mockAgent.addAdditionalDirectory).toHaveBeenCalledWith(
        "./config",
        {
          remember: false,
        },
      );
      await vi.waitFor(() => {
        const content = lastAssistantText(lastValue);
        expect(content).toContain("Added ./config");
        expect(content).not.toContain("remembered");
      });
    });

    it("persists the directory when --remember is passed", async () => {
      let lastValue: ChatContextType | undefined;
      const onHookValue = (val: ChatContextType) => {
        lastValue = val;
      };

      renderWithProvider(onHookValue);

      await vi.waitFor(() => {
        expect(lastValue).toBeDefined();
      });

      await lastValue!.addDir("./config --remember");

      expect(mockAgent.addAdditionalDirectory).toHaveBeenCalledWith(
        "./config",
        {
          remember: true,
        },
      );
      await vi.waitFor(() => {
        expect(lastAssistantText(lastValue)).toContain(" (remembered)");
      });
    });
  });
});
