import { vi } from 'vitest';
import type { ChatContextType } from '../../src/contexts/useChat';
import type { FileContextType } from '../../src/contexts/useFiles';
import type { AppConfig } from '../../src/contexts/useAppConfig';
import type { FileTreeNode } from '../../src/types/common';
import { flattenFiles } from '../../src/utils/flattenFiles';

// 默认的 mock 文件数据
export const defaultMockFiles: FileTreeNode[] = [
  {
    path: 'src',
    label: 'src',
    code: '',
    children: [
      { path: 'src/index.ts', label: 'index.ts', code: '', children: [] },
      {
        path: 'src/components',
        label: 'components',
        code: '',
        children: [{ path: 'src/components/App.tsx', label: 'App.tsx', code: '', children: [] }],
      },
    ],
  },
  { path: 'package.json', label: 'package.json', code: '', children: [] },
];

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
  syncFilesFromDisk: vi.fn(),
  readFileFromMemory: vi.fn(),
  writeFileToMemory: vi.fn(),
  deleteFileFromMemory: vi.fn(),
  createFileInMemory: vi.fn(),
  setFlatFiles: vi.fn(),
});

// 创建默认的 Chat Context Mock
export const createMockChatContext = (mockFunctions: ReturnType<typeof createMockFunctions>): ChatContextType => ({
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
  // Login form state
  showLoginForm: false,
  setShowLoginForm: vi.fn(),
  sessionId: 'test-session',
  sendMessage: mockFunctions.sendMessage,
  sendAIMessage: mockFunctions.sendAIMessage,
  abortAIMessage: mockFunctions.abortAIMessage,
  abortMessage: mockFunctions.abortMessage,
  resetSession: mockFunctions.resetSession,
});

// 创建默认的 Files Context Mock
export const createMockFilesContext = (
  mockFunctions: ReturnType<typeof createMockFunctions>,
  files = defaultMockFiles,
): FileContextType => ({
  flatFiles: flattenFiles(files),
  workdir: '/mock/workdir',
  syncFilesFromDisk: mockFunctions.syncFilesFromDisk,
  readFileFromMemory: mockFunctions.readFileFromMemory,
  writeFileToMemory: mockFunctions.writeFileToMemory,
  deleteFileFromMemory: mockFunctions.deleteFileFromMemory,
  createFileInMemory: mockFunctions.createFileInMemory,
  setFlatFiles: mockFunctions.setFlatFiles,
});

// 创建默认的 App Config Mock
export const createMockAppConfig = (): AppConfig => ({
  workdir: '/mock/workdir',
  ignore: [],
});

// 全局变量存储 mock 实例
let mockFunctions: ReturnType<typeof createMockFunctions>;
let mockChatContext: ChatContextType;
let mockFilesContext: FileContextType;
let mockAppConfig: AppConfig;

// 设置 mocks 的函数
export const setupMocks = (customFiles?: FileTreeNode[]) => {
  mockFunctions = createMockFunctions();
  mockChatContext = createMockChatContext(mockFunctions);
  mockFilesContext = createMockFilesContext(mockFunctions, customFiles);
  mockAppConfig = createMockAppConfig();

  // Mock chat context
  vi.doMock('../../src/contexts/useChat', () => ({
    ChatProvider: ({ children }: { children: React.ReactNode }) => children,
    useChat: () => mockChatContext,
  }));

  // Mock files context
  vi.doMock('../../src/contexts/useFiles', () => ({
    FileProvider: ({ children }: { children: React.ReactNode }) => children,
    useFiles: () => mockFilesContext,
  }));

  // Mock app config
  vi.doMock('../../src/contexts/useAppConfig', () => ({
    AppProvider: ({ children }: { children: React.ReactNode }) => children,
    useAppConfig: () => mockAppConfig,
  }));

  // Mock logger
  vi.doMock('../../src/utils/logger', () => ({
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
    mockFilesContext,
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
  mockFilesContext,
  mockAppConfig,
});
