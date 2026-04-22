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
import { useInput } from "ink";
import {
  ConfirmationDetails,
  type ConfirmationDetailsProps,
} from "../../src/components/ConfirmationDetails.js";
import {
  ConfirmationSelector,
  type ConfirmationSelectorProps,
} from "../../src/components/ConfirmationSelector.js";
import { stripAnsiColors } from "wave-agent-sdk";

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

// Mock usageSummary
vi.mock("../../src/utils/usageSummary.js", () => ({
  displayUsageSummary: vi.fn(),
}));

const Confirmation = (
  props: ConfirmationSelectorProps & ConfirmationDetailsProps,
) => (
  <>
    <ConfirmationDetails {...props} />
    <ConfirmationSelector {...props} />
  </>
);

// Component that renders ConfirmationSelector when confirmation is visible
function ConfirmationView() {
  const {
    isConfirmationVisible,
    confirmingTool,
    handleConfirmationDecision,
    handleConfirmationCancel,
  } = useChat();

  if (!isConfirmationVisible || !confirmingTool) {
    return null;
  }

  return (
    <Confirmation
      toolName={confirmingTool.name}
      toolInput={confirmingTool.input}
      planContent={confirmingTool.planContent}
      onDecision={handleConfirmationDecision}
      onCancel={handleConfirmationCancel}
    />
  );
}

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

describe("ConfirmationSelector Esc Integration", () => {
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
    props = {},
  ) => {
    return render(
      <AppProvider>
        <ChatProvider {...props}>
          <TestComponent onHookValue={onHookValue} />
          <ConfirmationView />
        </ChatProvider>
      </AppProvider>,
    );
  };

  /**
   * Get the ConfirmationSelector's useInput handler.
   * ChatProvider registers one handler (Ctrl+O).
   * ConfirmationSelector registers a second handler (handles Esc, arrows, Enter, etc).
   * We want the ConfirmationSelector handler since that's where the Esc->onCancel flow lives.
   */
  function getConfirmationSelectorInputHandler() {
    const useInputMock = vi.mocked(useInput);
    const handlers = useInputMock.mock.calls;
    // The last registered handler should be from ConfirmationSelector
    if (handlers.length === 0) return undefined;
    return handlers[handlers.length - 1][0];
  }

  it("Esc on ConfirmationSelector should cancel but NOT call abortMessage", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    const { lastFrame } = renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    // Show a confirmation prompt
    const decisionPromise = lastValue?.showConfirmation("Bash", {
      command: "ls -la",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
      expect(lastValue?.confirmingTool?.name).toBe("Bash");
    });

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("> Yes, proceed");
    });

    // Simulate Esc via ConfirmationSelector's useInput handler
    const handler = getConfirmationSelectorInputHandler()!;
    handler!("", { escape: true } as Parameters<typeof handler>[1]);

    // Catch the rejection to avoid unhandled promise rejection warnings
    await decisionPromise!.catch(() => {
      // Expected: the promise rejects when confirmation is cancelled
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });

    // CRITICAL: Esc cancel MUST call abortMessage to stop the AI execution cycle
    expect(mockAgent.abortMessage).toHaveBeenCalled();
  });

  it("Esc on ExitPlanMode ConfirmationSelector should only cancel, not abort", async () => {
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    const { lastFrame } = renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const decisionPromise = lastValue?.showConfirmation("ExitPlanMode", {});

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "> Yes, clear context",
      );
    });

    const handler = getConfirmationSelectorInputHandler()!;
    handler!("", { escape: true } as Parameters<typeof handler>[1]);

    await decisionPromise!.catch(() => {
      // Expected: the promise rejects when confirmation is cancelled
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });

    expect(mockAgent.abortMessage).toHaveBeenCalled();
  });

  it("Confirming via handleConfirmationDecision should NOT call abortMessage", async () => {
    // This verifies the full confirmation flow (Enter key on "Yes, proceed")
    // goes through handleConfirmationDecision which should not trigger abortMessage.
    let lastValue: ChatContextType | undefined;
    const onHookValue = (val: ChatContextType) => {
      lastValue = val;
    };

    renderWithProvider(onHookValue);

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const decisionPromise = lastValue?.showConfirmation("Bash", {
      command: "pwd",
    });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(true);
    });

    // Simulate confirming (same as pressing Enter on "Yes, proceed")
    lastValue?.handleConfirmationDecision({ behavior: "allow" });

    await vi.waitFor(() => {
      expect(lastValue?.isConfirmationVisible).toBe(false);
    });

    const decision = await decisionPromise!;
    expect(decision).toEqual({ behavior: "allow" });
    expect(mockAgent.abortMessage).not.toHaveBeenCalled();
  });
});
