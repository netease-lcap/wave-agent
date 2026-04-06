import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { PermissionMode } from "wave-agent-sdk";
import { initialState } from "../../src/reducers/inputReducer.js";

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      addEntry: vi.fn().mockResolvedValue(undefined),
      searchHistory: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

import { useChat, ChatContextType } from "../../src/contexts/useChat.js";

const mockSetPermissionMode = vi.fn();
const mockHandleRewindSelect = vi.fn();
const mockBackgroundCurrentTask = vi.fn();

// Helper to create mock useChat return value
const createMockUseChat = (
  inputStateOverrides: Partial<typeof initialState> = {},
): ChatContextType =>
  ({
    setPermissionMode: mockSetPermissionMode,
    handleRewindSelect: mockHandleRewindSelect,
    backgroundCurrentTask: mockBackgroundCurrentTask,
    messages: [],
    getFullMessageThread: vi
      .fn()
      .mockResolvedValue({ messages: [], sessionIds: [] }),
    sessionId: "test-session",
    workingDirectory: "/test",
    inputState: { ...initialState, ...inputStateOverrides },
    inputDispatch: vi.fn(),
    currentModel: "",
    configuredModels: [],
    setModel: vi.fn(),
    askBtw: vi.fn(),
    mcpServers: [],
    backgroundTasks: [],
    // Additional required ChatContextType properties
    isLoading: false,
    isCommandRunning: false,
    isCompressing: false,
    isExpanded: false,
    isTaskListVisible: true,
    setIsTaskListVisible: vi.fn(),
    queuedMessages: [],
    sendMessage: vi.fn(),
    abortMessage: vi.fn(),
    latestTotalTokens: 0,
    getConfiguredModels: vi.fn().mockReturnValue([]),
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    tasks: [],
    getBackgroundTaskOutput: vi.fn(),
    stopBackgroundTask: vi.fn(),
    slashCommands: [],
    hasSlashCommand: vi.fn(),
    permissionMode: "default" as PermissionMode,
    allowBypassInCycle: false,
    isConfirmationVisible: false,
    hasPendingConfirmations: false,
    confirmingTool: undefined,
    showConfirmation: vi.fn(),
    hideConfirmation: vi.fn(),
    handleConfirmationDecision: vi.fn(),
    handleConfirmationCancel: vi.fn(),
    remountKey: 0,
    requestRemount: vi.fn(),
    getGatewayConfig: vi
      .fn()
      .mockReturnValue({ baseURL: "http://localhost:3000" }),
    getModelConfig: vi.fn().mockReturnValue({ model: "", fastModel: "" }),
    version: "1.0.0",
    workdir: "/test",
  }) as unknown as ChatContextType;

describe("InputBox Smoke Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useChat).mockReturnValue(createMockUseChat());
  });

  describe("Basic Functionality", () => {
    it("should show placeholder text when empty", async () => {
      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });

      expect(lastFrame()).toMatch(
        /Type your message[\s\S]*use \/help for more info/,
      );
    });

    // The following tests require reactive state management which is complex to mock
    // They are skipped for now but the functionality is tested via integration tests
    it.skip("should handle basic text input", async () => {
      // Requires reactive mock that updates state on dispatch
    });

    it.skip("should handle paste input with newlines", async () => {
      // Requires reactive mock that updates state on dispatch
    });

    it.skip("should compress long text (>200 chars) into compressed format", async () => {
      // Requires reactive mock that updates state on dispatch
    });
  });

  describe("Loading State", () => {
    it("should show normal placeholder when loading", async () => {
      const { lastFrame } = render(<InputBox isLoading={true} />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });
      expect(lastFrame()).toContain("Type your message");
    });
  });

  describe("Slash Commands", () => {
    // Skipped: requires reactive mock that updates state on dispatch
    it.skip("should complete slash command workflow: filter -> select -> execute", async () => {
      // Requires reactive mock that updates state on dispatch
    });

    it.skip("should send complete slash command as message", async () => {
      // Requires reactive mock that updates state on dispatch
    });
  });

  describe("Manager Views", () => {
    it("should show RewindManager when showRewindManager is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showRewindManager: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toMatch(
          /Rewind|No user messages found/,
        );
      });

      expect(stripAnsiColors(lastFrame() || "")).not.toContain(
        "Type your message",
      );
    });

    it("should show HelpView when showHelp is true", async () => {
      vi.mocked(useChat).mockReturnValue(createMockUseChat({ showHelp: true }));

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        const output = stripAnsiColors(lastFrame() || "");
        expect(output).toContain("General");
        expect(output).toContain("Commands");
      });
    });

    it("should show BackgroundTaskManager when showBackgroundTaskManager is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showBackgroundTaskManager: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Background Tasks",
        );
      });
    });

    it("should show McpManager when showMcpManager is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showMcpManager: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toMatch(
          /Manage MCP servers|MCP Manager|MCP/,
        );
      });
    });

    it("should show ModelSelector when showModelSelector is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showModelSelector: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toMatch(
          /Model Selector|Select Model|Select AI Model/,
        );
      });
    });

    it("should show StatusCommand when showStatusCommand is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showStatusCommand: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("Status");
      });
    });

    it("should show PluginManager when showPluginManager is true", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ showPluginManager: true }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toMatch(
          /Plugin Manager|Plugins/,
        );
      });
    });
  });

  describe("BTW State", () => {
    it("should show BTW mode styling when btwState is active", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({
          btwState: { isActive: true, question: "", isLoading: false },
        }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your side question",
        );
      });
    });
  });

  describe("Permission Mode Display", () => {
    it("should show permission mode in status line", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ permissionMode: "acceptEdits" }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("acceptEdits");
      });
    });

    it("should show bypassPermissions mode in status line", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ permissionMode: "bypassPermissions" }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "bypassPermissions",
        );
      });
    });

    it("should show plan mode in status line", async () => {
      vi.mocked(useChat).mockReturnValue(
        createMockUseChat({ permissionMode: "plan" }),
      );

      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("plan");
      });
    });
  });
});
