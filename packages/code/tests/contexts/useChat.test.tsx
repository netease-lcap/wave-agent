import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ChatProvider,
  useChat,
  ChatContextType,
} from "../../src/contexts/useChat.js";
import { Agent, BackgroundShell } from "wave-agent-sdk";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { useInput } from "ink";

// Mock ink
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
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
    isCompressing: false,
    userInputHistory: [],
    getPermissionMode: vi.fn(() => "default"),
    getMcpServers: vi.fn(() => []),
    getSlashCommands: vi.fn(() => []),
    sendMessage: vi.fn(),
    executeBashCommand: vi.fn(),
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
    usages: [],
    sessionFilePath: "test-path",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
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

    // Test onMessagesChange
    const newMessages = [
      {
        role: "user" as const,
        blocks: [{ type: "text" as const, content: "test" }],
      },
    ];
    callbacks.onMessagesChange!(newMessages);
    await vi.waitFor(() => {
      expect(lastValue?.messages).toEqual(newMessages);
    });

    // Test onServersChange
    const newServers = [
      {
        name: "test-server",
        status: "connected" as const,
        config: { command: "test" },
      },
    ];
    callbacks.onServersChange!(newServers);
    await vi.waitFor(() => {
      expect(lastValue?.mcpServers).toEqual(newServers);
    });

    // Test onSessionIdChange
    callbacks.onSessionIdChange!("new-session");
    await vi.waitFor(() => {
      expect(lastValue?.sessionId).toBe("new-session");
    });

    // Test onLatestTotalTokensChange
    callbacks.onLatestTotalTokensChange!(100);
    await vi.waitFor(() => {
      expect(lastValue?.latestTotalTokens).toBe(100);
    });

    // Test onCompressionStateChange
    callbacks.onCompressionStateChange!(true);
    await vi.waitFor(() => {
      expect(lastValue?.isCompressing).toBe(true);
    });

    // Test onTasksChange
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
    callbacks.onTasksChange!(newTasks);
    await vi.waitFor(() => {
      expect(lastValue?.backgroundTasks).toEqual(newTasks);
    });

    // Test onSubagentMessagesChange
    callbacks.onSubagentMessagesChange?.("sub1", [
      {
        role: "assistant" as const,
        blocks: [{ type: "text" as const, content: "sub-msg" }],
      },
    ]);
    await vi.waitFor(() => {
      expect(lastValue?.subagentMessages["sub1"]).toHaveLength(1);
    });

    // Test onPermissionModeChange
    callbacks.onPermissionModeChange!("bypassPermissions");
    await vi.waitFor(() => {
      expect(lastValue?.permissionMode).toBe("bypassPermissions");
    });

    // Test onSlashCommandsChange
    const newCommands = [
      { id: "cmd", description: "desc", name: "cmd", handler: vi.fn() },
    ];
    callbacks.onSlashCommandsChange!(newCommands);
    await vi.waitFor(() => {
      expect(lastValue?.slashCommands).toEqual(newCommands);
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

    expect(mockAgent.executeBashCommand).toHaveBeenCalledWith("ls -la");
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
    expect(mockAgent.executeBashCommand).not.toHaveBeenCalled();
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
    const onHookValue = () => {};

    renderWithProvider(onHookValue, { bypassPermissions: true });

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: "bypassPermissions",
          canUseTool: undefined,
        }),
      );
    });
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

  it("handles executeBashCommand error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    mockAgent.executeBashCommand.mockRejectedValue(new Error("Bash failed"));

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
    expect(mockAgent.executeBashCommand).not.toHaveBeenCalled();
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
  });

  it("toggles isExpanded with Ctrl+O", async () => {
    const onHookValue = () => {};

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      // Get the useInput callback
      const useInputMock = vi.mocked(useInput);
      expect(useInputMock).toHaveBeenCalled();
    });

    // Get the useInput callback
    const useInputMock = vi.mocked(useInput);
    const inputCallback = useInputMock.mock.calls[0][0];

    // Simulate Ctrl+O
    inputCallback("o", { ctrl: true } as Parameters<typeof inputCallback>[1]);
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
});
