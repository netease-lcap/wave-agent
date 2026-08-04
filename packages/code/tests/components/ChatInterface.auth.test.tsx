import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import {
  ChatContextType,
  useChat as useChatActual,
} from "../../src/contexts/useChat.js";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { useTasks } from "../../src/hooks/useTasks.js";

// Mock authService (SSO state) while keeping the rest of the SDK real
const { mockAuthService } = vi.hoisted(() => ({
  mockAuthService: {
    isSSOAuthenticated: vi.fn<() => boolean>(() => false),
    onAuthChange:
      vi.fn<(cb: (event: "login" | "logout") => void) => () => void>(),
  },
}));

vi.mock("wave-agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("wave-agent-sdk")>("wave-agent-sdk");
  return {
    ...actual,
    authService: mockAuthService,
  };
});

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

const useChat = vi.mocked(useChatActual);

vi.mock("../../src/hooks/useInputManager.js", () => ({
  useInputManager: vi.fn(),
}));

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

describe("ChatInterface login hint", () => {
  // Captured when ChatInterface subscribes via onAuthChange
  let authChangeCallback: ((event: "login" | "logout") => void) | null = null;

  const baseContext = {
    sessionId: "test-session",
    messages: [],
    isLoading: false,
    isCommandRunning: false,
    userInputHistory: [],
    isCompacting: false,
    isExpanded: false,
    isConfirmationVisible: false,
    hasPendingConfirmations: false,
    version: "1.2.3",
    workdir: "/test/dir",
    remountKey: 0,
    requestRemount: vi.fn(),
    latestTotalTokens: 0,
    maxInputTokens: 0,
    mcpServers: [],
    slashCommands: [],
    hasSlashCommand: vi.fn(),
    isTaskListVisible: true,
    setIsBtwActive: vi.fn(),
    sendMessage: vi.fn(),
    abortMessage: vi.fn(),
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    handleConfirmationDecision: vi.fn(),
    handleConfirmationCancel: vi.fn(),
    getModelConfig: vi.fn().mockReturnValue({
      model: "test-model",
      fastModel: "test-fast-model",
    }),
    getGatewayConfig: vi.fn().mockReturnValue({
      apiKey: undefined,
      baseURL: undefined,
    }),
  } as unknown as ChatContextType;

  const mockInputManager = {
    isManagerReady: true,
    showRewindManager: false,
    btwState: { question: "", isLoading: false },
    setPermissionMode: vi.fn(),
    setAllowBypassInCycle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authChangeCallback = null;
    mockAuthService.isSSOAuthenticated.mockReturnValue(false);
    mockAuthService.onAuthChange.mockImplementation((cb) => {
      authChangeCallback = cb;
      return () => {
        authChangeCallback = null;
      };
    });
    vi.mocked(useChat).mockReturnValue({
      ...baseContext,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );
  });

  it("should show the /login hint when not authenticated and no direct API config", () => {
    const { lastFrame } = render(<ChatInterface />);

    expect(lastFrame()).toContain("Type /login to authenticate");
  });

  it("should not show the /login hint when SSO authenticated", () => {
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);

    const { lastFrame } = render(<ChatInterface />);

    expect(lastFrame()).not.toContain("Type /login to authenticate");
  });

  it("should not show the /login hint when a direct apiKey is configured", () => {
    vi.mocked(useChat).mockReturnValue({
      ...baseContext,
      getGatewayConfig: vi.fn().mockReturnValue({
        apiKey: "sk-test",
        baseURL: undefined,
      }),
    } as unknown as ChatContextType);

    const { lastFrame } = render(<ChatInterface />);

    expect(lastFrame()).not.toContain("Type /login to authenticate");
  });

  it("should not show the /login hint when a direct baseURL is configured", () => {
    vi.mocked(useChat).mockReturnValue({
      ...baseContext,
      getGatewayConfig: vi.fn().mockReturnValue({
        apiKey: undefined,
        baseURL: "http://localhost:11434",
      }),
    } as unknown as ChatContextType);

    const { lastFrame } = render(<ChatInterface />);

    expect(lastFrame()).not.toContain("Type /login to authenticate");
  });

  it("should hide the hint in real time when the user logs in", async () => {
    const { lastFrame } = render(<ChatInterface />);
    expect(lastFrame()).toContain("Type /login to authenticate");

    // Wait until the auth-change subscription is active before simulating login
    await vi.waitFor(() => expect(authChangeCallback).not.toBeNull());
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);
    authChangeCallback?.("login");

    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain("Type /login to authenticate");
    });
  });

  it("should show the hint again when the user logs out", async () => {
    mockAuthService.isSSOAuthenticated.mockReturnValue(true);

    const { lastFrame } = render(<ChatInterface />);
    expect(lastFrame()).not.toContain("Type /login to authenticate");

    await vi.waitFor(() => expect(authChangeCallback).not.toBeNull());
    mockAuthService.isSSOAuthenticated.mockReturnValue(false);
    authChangeCallback?.("logout");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Type /login to authenticate");
    });
  });
});
