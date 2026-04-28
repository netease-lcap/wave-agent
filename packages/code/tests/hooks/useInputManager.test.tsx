import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { Box, Key } from "ink";
import { PromptHistoryManager } from "wave-agent-sdk";
import { InputManagerCallbacks } from "../../src/managers/inputReducer.js";

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      addEntry: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue([]),
      searchFiles: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: vi.fn().mockResolvedValue({ success: false }),
}));

type InputManagerResult = ReturnType<typeof useInputManager>;

interface TesterProps {
  callbacks: Partial<InputManagerCallbacks>;
  managerRef: React.MutableRefObject<InputManagerResult | null>;
}

function InputManagerTester({ callbacks, managerRef }: TesterProps) {
  const manager = useInputManager(callbacks);
  useEffect(() => {
    managerRef.current = manager;
  }, [manager, managerRef]);
  return <Box />;
}

describe("useInputManager", () => {
  const mockOnSendMessage = vi.fn();
  const mockOnPermissionModeChange = vi.fn();
  const mockOnHasSlashCommand = vi.fn().mockReturnValue(false);
  const mockOnAbortMessage = vi.fn();
  const mockOnBackgroundCurrentTask = vi.fn();

  const callbacks: Partial<InputManagerCallbacks> = {
    onSendMessage: mockOnSendMessage,
    onPermissionModeChange: mockOnPermissionModeChange,
    onHasSlashCommand: mockOnHasSlashCommand,
    onAbortMessage: mockOnAbortMessage,
    onBackgroundCurrentTask: mockOnBackgroundCurrentTask,
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as InputManagerCallbacks["logger"],
  };

  let managerRef: React.MutableRefObject<InputManagerResult | null>;

  beforeEach(() => {
    vi.clearAllMocks();
    managerRef = { current: null };
  });

  function renderManager() {
    render(
      <InputManagerTester callbacks={callbacks} managerRef={managerRef} />,
    );
  }

  function getManager(): InputManagerResult {
    return managerRef.current!;
  }

  it("should call onSendMessage when submitting text", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    // Type "hello" character by character
    for (const char of "hello") {
      await getManager().handleInput(char, {} as Key, []);
    }
    // Press return
    await getManager().handleInput("\n", { return: true } as Key, []);

    await vi.waitFor(() => {
      expect(PromptHistoryManager.addEntry).toHaveBeenCalledWith(
        "hello",
        undefined,
        {},
        undefined,
      );
      expect(mockOnSendMessage).toHaveBeenCalledWith("hello", undefined, {});
    });
  });

  it("should call onPermissionModeChange when cycling permissions", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    await getManager().handleInput("\t", { tab: true, shift: true } as Key, []);

    await vi.waitFor(() => {
      expect(mockOnPermissionModeChange).toHaveBeenCalledWith("acceptEdits");
    });
  });

  it("should call onAbortMessage when escape pressed with no managers active", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    await getManager().handleInput("\u001b", { escape: true } as Key, []);

    await vi.waitFor(() => {
      expect(mockOnAbortMessage).toHaveBeenCalled();
    });
  });

  it("should update inputText and cursorPosition after handleCommandInsert", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    // Activate command selector first
    getManager().activateCommandSelector(0);

    // Wait for state to update (slashPosition should be 0)
    await vi.waitFor(() => {
      expect(getManager().slashPosition).toBe(0);
    });

    // Now call handleCommandInsert
    getManager().handleCommandInsert("tasks");

    await vi.waitFor(() => {
      expect(getManager().inputText).toBe("/tasks ");
      expect(getManager().cursorPosition).toBe(7);
      expect(getManager().showCommandSelector).toBe(false);
    });
  });

  it("should update inputText after handleFileSelect", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    // Activate file selector first
    getManager().activateFileSelector(0);

    // Wait for state to update
    await vi.waitFor(() => {
      expect(getManager().showFileSelector).toBe(true);
    });

    // Now call handleFileSelect
    getManager().handleFileSelect("test.txt");

    await vi.waitFor(() => {
      expect(getManager().inputText).toBe("@test.txt ");
      expect(getManager().showFileSelector).toBe(false);
    });
  });

  it("should handle pendingCommand for non-slash-command (e.g. tasks opens manager)", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("tasks");

    await vi.waitFor(() => {
      expect(getManager().showBackgroundTaskManager).toBe(true);
    });
  });

  it("should handle pendingCommand for mcp command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("mcp");

    await vi.waitFor(() => {
      expect(getManager().showMcpManager).toBe(true);
    });
  });

  it("should handle pendingCommand for rewind command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("rewind");

    await vi.waitFor(() => {
      expect(getManager().showRewindManager).toBe(true);
    });
  });

  it("should handle pendingCommand for help command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("help");

    await vi.waitFor(() => {
      expect(getManager().showHelp).toBe(true);
    });
  });

  it("should handle pendingCommand for status command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("status");

    await vi.waitFor(() => {
      expect(getManager().showStatusCommand).toBe(true);
    });
  });

  it("should handle pendingCommand for plugin command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("plugin");

    await vi.waitFor(() => {
      expect(getManager().showPluginManager).toBe(true);
    });
  });

  it("should handle pendingCommand for model command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("model");

    await vi.waitFor(() => {
      expect(getManager().showModelSelector).toBe(true);
    });
  });

  it("should handle pendingCommand for btw command", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(false);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("btw");

    await vi.waitFor(() => {
      expect(getManager().btwState.isActive).toBe(true);
    });
  });

  it("should handle pendingCommand for slash command (executes via onSendMessage)", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    mockOnHasSlashCommand.mockReturnValue(true);
    getManager().activateCommandSelector(0);
    await getManager().handleCommandSelect("git-commit");

    await vi.waitFor(() => {
      expect(mockOnSendMessage).toHaveBeenCalledWith(
        "/git-commit",
        undefined,
        {},
      );
    });
  });

  it("should handle history search activation via ctrl+r", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    await getManager().handleInput("r", { ctrl: true } as Key, []);

    await vi.waitFor(() => {
      expect(getManager().showHistorySearch).toBe(true);
    });
  });

  it("should handle background task request via ctrl+b", async () => {
    renderManager();
    await vi.waitFor(() => expect(managerRef.current).not.toBeNull());

    await getManager().handleInput("b", { ctrl: true } as Key, []);

    await vi.waitFor(() => {
      expect(mockOnBackgroundCurrentTask).toHaveBeenCalled();
    });
  });
});
