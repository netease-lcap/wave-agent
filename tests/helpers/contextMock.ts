import { vi } from "vitest";
import type { ChatContextType } from "@/contexts/useChat";
import type { AppConfig } from "@/contexts/useAppConfig";

// 创建 mock 函数
export const createMockFunctions = () => ({
  sendMessage: vi.fn(),
  abortMessage: vi.fn(),
  setMessages: vi.fn(),
  setIsLoading: vi.fn(),
  clearMessages: vi.fn(),
  executeCommand: vi.fn(),
  abortCommand: vi.fn(),
  addToInputHistory: vi.fn(),
  insertToInput: vi.fn(),
  setInputInsertHandler: vi.fn(),
  sendAIMessage: vi.fn(),
  abortAIMessage: vi.fn(),
  resetSession: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue(undefined),
});

// 创建默认的 Chat Context Mock
export const createMockChatContext = (
  mockFunctions: ReturnType<typeof createMockFunctions>,
): ChatContextType => ({
  messages: [],
  setMessages: mockFunctions.setMessages,
  isLoading: false,
  setIsLoading: mockFunctions.setIsLoading,
  clearMessages: mockFunctions.clearMessages,
  executeCommand: mockFunctions.executeCommand,
  abortCommand: mockFunctions.abortCommand,
  isCommandRunning: false,
  userInputHistory: [],
  addToInputHistory: mockFunctions.addToInputHistory,
  insertToInput: mockFunctions.insertToInput,
  inputInsertHandler: null,
  setInputInsertHandler: mockFunctions.setInputInsertHandler,
  sessionId: "test-session",
  sendMessage: mockFunctions.sendMessage,
  sendAIMessage: mockFunctions.sendAIMessage,
  abortAIMessage: mockFunctions.abortAIMessage,
  abortMessage: mockFunctions.abortMessage,
  resetSession: mockFunctions.resetSession,
  totalTokens: 0,
  saveMemory: mockFunctions.saveMemory,
});

// 创建默认的 App Config Mock
export const createMockAppConfig = (): AppConfig => ({
  workdir: "/mock/workdir",
});

// 全局变量存储 mock 实例
let mockFunctions: ReturnType<typeof createMockFunctions>;
let mockChatContext: ChatContextType;
let mockAppConfig: AppConfig;

// 设置 mocks 的函数
export const setupMocks = () => {
  mockFunctions = createMockFunctions();
  mockChatContext = createMockChatContext(mockFunctions);
  mockAppConfig = createMockAppConfig();

  // Mock chat context
  vi.doMock("@/contexts/useChat", () => ({
    ChatProvider: ({ children }: { children: React.ReactNode }) => children,
    useChat: () => mockChatContext,
  }));

  // Mock app config
  vi.doMock("@/contexts/useAppConfig", () => ({
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
    useAppConfig: () => mockAppConfig,
  }));

  // Mock logger
  vi.doMock("@/utils/logger", () => ({
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }));

  return {
    mockFunctions,
    mockChatContext,
    mockAppConfig,
  };
};

// 重置 mocks 的函数
export const resetMocks = () => {
  if (mockFunctions) {
    vi.clearAllMocks();
  }
  if (mockChatContext) {
    mockChatContext.userInputHistory = [];
    mockChatContext.isLoading = false;
    mockChatContext.isCommandRunning = false;
  }
};

// 导出当前的 mock 实例（用于测试中访问）
export const getMocks = () => ({
  mockFunctions,
  mockChatContext,
  mockAppConfig,
});
