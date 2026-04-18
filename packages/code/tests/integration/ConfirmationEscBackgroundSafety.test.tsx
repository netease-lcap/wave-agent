import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ChatProvider,
  useChat,
  ChatContextType,
} from "../../src/contexts/useChat.js";
import { Agent } from "wave-agent-sdk";
import { AppProvider } from "../../src/contexts/useAppConfig.js";

// Mock ink
vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
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

describe("Confirmation Escape - Background Safety", () => {
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
    bang: vi.fn(),
    abortMessage: vi.fn(), // We'll verify this IS called
    abortBashCommand: vi.fn(), // We'll verify this IS called (it stops the current foreground bang)
    abortSlashCommand: vi.fn(), // We'll verify this IS called
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    getBackgroundTaskOutput: vi.fn(),
    stopBackgroundTask: vi.fn(), // This is the key: it should NOT be called for background tasks
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
      fastModel: "test-fast",
    })),
    getConfiguredModels: vi.fn(() => []),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderWithProvider = (
    onHookValue: (value: ChatContextType) => void,
  ) => {
    return render(
      <AppProvider>
        <ChatProvider>
          <TestComponent onHookValue={onHookValue} />
        </ChatProvider>
      </AppProvider>,
    );
  };

  it("Esc on confirmation should call abortMessage but NOT stopBackgroundTask", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    // Simulate an ongoing confirmation
    const decisionPromise = lastValue?.showConfirmation("Bash", {
      command: "ls",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    // Simulate Escape key
    lastValue?.handleConfirmationCancel();

    await decisionPromise?.catch(() => {});

    // Verify it aborted the AI circle
    expect(mockAgent.abortMessage).toHaveBeenCalled();

    // CRITICAL: Verify it did NOT stop background tasks
    // backgroundTaskManager.stopTask is used for killing long-running background processes
    expect(mockAgent.stopBackgroundTask).not.toHaveBeenCalled();
  });
});
