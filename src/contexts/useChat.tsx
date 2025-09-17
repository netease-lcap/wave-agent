import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useFiles } from "./useFiles";
import type { Message } from "../types";
import type { SessionData } from "../services/sessionManager";
import {
  addUserMessageToMessages,
  addMemoryBlockToMessage,
} from "../utils/messageOperations";
import { createBashManager, type BashManager } from "../services/bashManager";
import { createMemoryManager } from "../services/memoryManager";
import { AIManager, AIManagerCallbacks } from "../services/aiManager";

// Input History Hook
export interface InputHistoryContextType {
  userInputHistory: string[];
  addToInputHistory: (input: string) => void;
  clearInputHistory: () => void;
}

export const useInputHistory = (
  initialHistory?: string[],
): InputHistoryContextType => {
  const [userInputHistory, setUserInputHistory] = useState<string[]>(
    initialHistory || [],
  );

  const addToInputHistory = useCallback((input: string) => {
    setUserInputHistory((prev) => {
      // 避免重复添加相同的输入
      if (prev.length > 0 && prev[prev.length - 1] === input) {
        return prev;
      }
      // 限制历史记录数量，保留最近的100条
      const newHistory = [...prev, input];
      return newHistory.slice(-100);
    });
  }, []);

  const clearInputHistory = useCallback(() => {
    setUserInputHistory([]);
  }, []);

  return {
    userInputHistory,
    addToInputHistory,
    clearInputHistory,
  };
};

// Input Insert Hook
export interface InputInsertContextType {
  insertToInput: (text: string) => void;
  inputInsertHandler: ((text: string) => void) | null;
  setInputInsertHandler: (handler: (text: string) => void) => void;
}

export const useInputInsert = (): InputInsertContextType => {
  const [inputInsertHandler, setInputInsertHandler] = useState<
    ((text: string) => void) | null
  >(null);

  const insertToInput = useCallback(
    (text: string) => {
      if (inputInsertHandler) {
        inputInsertHandler(text);
      }
    },
    [inputInsertHandler],
  );

  const setInputInsertHandlerCallback = useCallback(
    (handler: (text: string) => void) => {
      setInputInsertHandler(() => handler);
    },
    [],
  );

  return {
    insertToInput,
    inputInsertHandler,
    setInputInsertHandler: setInputInsertHandlerCallback,
  };
};

// AI Hook
export interface UseAIReturn {
  sessionId: string;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sendAIMessage: (recursionDepth?: number) => Promise<void>;
  abortAIMessage: () => void;
  resetSession: () => void;
  totalTokens: number;
}

export const useAI = (
  sessionToRestore?: SessionData | null,
  getCurrentInputHistory?: () => string[],
): UseAIReturn => {
  const filesContext = useFiles();
  const { workdir, setFlatFiles, fileManager } = filesContext;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");

  const aiManagerRef = useRef<AIManager | null>(null);

  // Initialize AI manager
  useEffect(() => {
    // Only initialize if fileManager is available
    if (!fileManager) return;

    const callbacks: AIManagerCallbacks = {
      onMessagesChange: (newMessages) => {
        setMessages([...newMessages]);
      },
      onLoadingChange: (loading) => {
        setIsLoading(loading);
      },
      onFlatFilesChange: (updater) => {
        setFlatFiles(updater);
      },
      getCurrentInputHistory,
    };

    aiManagerRef.current = new AIManager(workdir, callbacks, fileManager);

    // Initialize from session or default state
    if (sessionToRestore) {
      // Restore from session data
      aiManagerRef.current.initializeFromSession(
        sessionToRestore.id,
        sessionToRestore.state.messages,
        sessionToRestore.metadata.totalTokens,
      );

      setSessionId(sessionToRestore.id);
      setMessages(sessionToRestore.state.messages);
      setTotalTokens(sessionToRestore.metadata.totalTokens);
      setIsLoading(false);
    } else {
      // Initialize with default state
      const state = aiManagerRef.current.getState();
      setSessionId(state.sessionId);
      setMessages(state.messages);
      setIsLoading(state.isLoading);
      setTotalTokens(state.totalTokens);
    }
  }, [
    workdir,
    setFlatFiles,
    fileManager,
    sessionToRestore,
    getCurrentInputHistory,
  ]);

  // Update totalTokens when AI manager state changes
  useEffect(() => {
    if (aiManagerRef.current) {
      const state = aiManagerRef.current.getState();
      setTotalTokens(state.totalTokens);
      setSessionId(state.sessionId);
    }
  }, [messages, isLoading]);

  const sendAIMessage = useCallback(
    async (recursionDepth?: number): Promise<void> => {
      if (aiManagerRef.current) {
        await aiManagerRef.current.sendAIMessage(recursionDepth);
      }
    },
    [],
  );

  const abortAIMessage = useCallback(() => {
    if (aiManagerRef.current) {
      aiManagerRef.current.abortAIMessage();
    }
  }, []);

  const resetSession = useCallback(() => {
    if (aiManagerRef.current) {
      aiManagerRef.current.resetSession();
      const state = aiManagerRef.current.getState();
      setSessionId(state.sessionId);
      setTotalTokens(state.totalTokens);
    }
  }, []);

  // Custom setMessages that updates the AI manager
  const setMessagesWrapper = useCallback(
    (messages: Message[] | ((prev: Message[]) => Message[])) => {
      if (aiManagerRef.current) {
        if (typeof messages === "function") {
          const currentState = aiManagerRef.current.getState();
          const newMessages = messages(currentState.messages);
          aiManagerRef.current.setMessages(newMessages);
        } else {
          aiManagerRef.current.setMessages(messages);
        }
      }
    },
    [],
  );

  // Custom setIsLoading that updates the AI manager
  const setIsLoadingWrapper = useCallback(
    (loading: boolean | ((prev: boolean) => boolean)) => {
      if (aiManagerRef.current) {
        if (typeof loading === "function") {
          const currentState = aiManagerRef.current.getState();
          const newLoading = loading(currentState.isLoading);
          aiManagerRef.current.setIsLoading(newLoading);
        } else {
          aiManagerRef.current.setIsLoading(loading);
        }
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aiManagerRef.current) {
        // Save session before cleanup
        aiManagerRef.current.saveSession().catch((error) => {
          console.error("Failed to save session during cleanup:", error);
        });
        aiManagerRef.current.destroy();
      }
    };
  }, []);

  return {
    sessionId,
    isLoading,
    setIsLoading: setIsLoadingWrapper,
    messages,
    setMessages: setMessagesWrapper,
    sendAIMessage,
    abortAIMessage,
    resetSession,
    totalTokens,
  };
};

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  clearMessages: () => void;
  executeCommand: (command: string) => Promise<number>;
  abortCommand: () => void;
  isCommandRunning: boolean;
  userInputHistory: string[];
  addToInputHistory: (input: string) => void;
  insertToInput: (text: string) => void;
  inputInsertHandler: ((text: string) => void) | null;
  setInputInsertHandler: (handler: (text: string) => void) => void;
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
    options?: {
      isMemoryMode?: boolean;
      isBashMode?: boolean;
    },
  ) => Promise<void>;
  sendAIMessage: (recursionDepth?: number) => Promise<void>;
  abortAIMessage: () => void;
  abortMessage: () => void;
  resetSession: () => void;
  totalTokens: number;
  // Memory functionality
  saveMemory: (message: string, type: "project" | "user") => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
};

export interface ChatProviderProps {
  children: React.ReactNode;
  sessionToRestore?: SessionData | null;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  sessionToRestore,
}) => {
  const { workdir } = useFiles();

  // Use the Input History hook
  const { userInputHistory, addToInputHistory, clearInputHistory } =
    useInputHistory(sessionToRestore?.state.inputHistory);

  // Create stable callback to get current input history
  const getCurrentInputHistoryRef = useRef<() => string[]>(() => []);

  useEffect(() => {
    getCurrentInputHistoryRef.current = () => userInputHistory;
  }, [userInputHistory]);

  const getCurrentInputHistory = useCallback(() => {
    return getCurrentInputHistoryRef.current?.() || [];
  }, []);

  // Use the AI hook
  const {
    sessionId,
    isLoading,
    setIsLoading,
    messages,
    setMessages,
    sendAIMessage,
    abortAIMessage,
    resetSession,
    totalTokens,
  } = useAI(sessionToRestore, getCurrentInputHistory);

  // Create bash manager
  const bashManagerRef = useRef<BashManager | null>(null);

  // Initialize bash manager
  useEffect(() => {
    if (!bashManagerRef.current) {
      bashManagerRef.current = createBashManager({
        workdir,
        onMessagesUpdate: setMessages,
      });
    } else {
      // Update workdir when it changes
      bashManagerRef.current.updateWorkdir(workdir);
    }
  }, [workdir, setMessages]);

  // Command execution functions
  const executeCommand = useCallback(
    async (command: string): Promise<number> => {
      if (!bashManagerRef.current) {
        throw new Error("Bash manager not initialized");
      }
      return bashManagerRef.current.executeCommand(command);
    },
    [],
  );

  const abortCommand = useCallback(() => {
    if (bashManagerRef.current) {
      bashManagerRef.current.abortCommand();
    }
  }, []);

  const isCommandRunning =
    bashManagerRef.current?.getIsCommandRunning() ?? false;

  // Use the Memory hook
  const memoryManager = useMemo(() => createMemoryManager(workdir), [workdir]);

  // Use the Input Insert hook
  const { insertToInput, inputInsertHandler, setInputInsertHandler } =
    useInputInsert();

  const clearMessages = useCallback(() => {
    setMessages([]);
    clearInputHistory(); // 也清空历史记录
    resetSession();
  }, [setMessages, clearInputHistory, resetSession]);

  // 统一的中断方法，同时中断AI消息和命令执行
  const abortMessage = useCallback(() => {
    abortAIMessage();
    abortCommand();
  }, [abortAIMessage, abortCommand]);

  // 记忆保存函数
  const saveMemory = useCallback(
    async (message: string, type: "project" | "user") => {
      try {
        if (type === "project") {
          await memoryManager.addMemory(message);
        } else {
          await memoryManager.addUserMemory(message);
        }

        // 添加成功的 MemoryBlock 到最后一个助手消息
        const memoryText = message.substring(1).trim();
        const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
        const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

        setMessages((prev) =>
          addMemoryBlockToMessage(
            prev,
            `${typeLabel}: ${memoryText}`,
            true,
            type,
            storagePath,
          ),
        );
      } catch (error) {
        // 添加失败的 MemoryBlock 到最后一个助手消息
        const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
        const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

        setMessages((prev) =>
          addMemoryBlockToMessage(
            prev,
            `${typeLabel}添加失败: ${error instanceof Error ? error.message : String(error)}`,
            false,
            type,
            storagePath,
          ),
        );
      }
    },
    [memoryManager, setMessages],
  );

  // 发送消息函数
  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
      options?: {
        isMemoryMode?: boolean;
        isBashMode?: boolean;
      },
    ) => {
      // 检查是否有内容可以发送（文本内容或图片附件）
      const hasTextContent = content.trim();
      const hasImageAttachments = images && images.length > 0;

      if (!hasTextContent && !hasImageAttachments) return;

      try {
        // Handle memory mode
        if (options?.isMemoryMode && content.startsWith("#")) {
          const memoryText = content.substring(1).trim();
          if (!memoryText) return;

          // 添加用户消息到UI
          setMessages((prev) =>
            addUserMessageToMessages(
              prev,
              content,
              images?.map((img) => ({
                path: img.path,
                mimeType: img.mimeType,
              })),
            ),
          );

          // 不自动保存，等待用户选择记忆类型
          return;
        }

        // Handle bash mode
        if (options?.isBashMode && content.startsWith("!")) {
          const command = content.substring(1).trim();
          if (!command) return;

          // 添加用户消息到历史记录
          addToInputHistory(content);

          // 添加用户消息到UI
          setMessages((prev) =>
            addUserMessageToMessages(
              prev,
              content,
              images?.map((img) => ({
                path: img.path,
                mimeType: img.mimeType,
              })),
            ),
          );

          // 执行bash命令
          await executeCommand(command);
          return;
        }

        // Handle normal AI message
        // 添加用户消息到历史记录
        addToInputHistory(content);

        // 添加用户消息到UI
        setMessages((prev) =>
          addUserMessageToMessages(
            prev,
            content,
            images?.map((img) => ({
              path: img.path,
              mimeType: img.mimeType,
            })),
          ),
        );

        // 发送AI消息
        await sendAIMessage();
      } catch (error) {
        console.error("Failed to send message:", error);
        setIsLoading(false);
      }
    },
    [
      addToInputHistory,
      setMessages,
      executeCommand,
      sendAIMessage,
      setIsLoading,
    ],
  );

  const contextValue: ChatContextType = {
    messages,
    setMessages,
    isLoading,
    setIsLoading,
    clearMessages,
    executeCommand,
    abortCommand,
    isCommandRunning,
    userInputHistory,
    addToInputHistory,
    insertToInput,
    inputInsertHandler,
    setInputInsertHandler,
    sessionId,
    sendMessage,
    sendAIMessage,
    abortAIMessage,
    abortMessage,
    resetSession,
    totalTokens,
    saveMemory,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
