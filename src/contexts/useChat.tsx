import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAppConfig } from "./useAppConfig";
import type { Message } from "../types";
import {
  addMemoryBlockToMessage,
  extractUserInputHistory,
} from "../utils/messageOperations";
import { createBashManager, type BashManager } from "../services/bashManager";
import { createMemoryManager } from "../services/memoryManager";
import { AIManager, AIManagerCallbacks } from "../services/aiManager";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isLoading: boolean;
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
  ) => Promise<void>;
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
}

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const { sessionToRestore } = useAppConfig();

  // Extract user input history from session messages
  const initialHistory = useMemo(() => {
    if (sessionToRestore?.state?.messages) {
      return extractUserInputHistory(sessionToRestore.state.messages);
    }
    return undefined;
  }, [sessionToRestore]);

  // Input History State
  const [userInputHistory, setUserInputHistory] = useState<string[]>(
    initialHistory || [],
  );

  // Input Insert State
  const [inputInsertHandler, setInputInsertHandler] = useState<
    ((text: string) => void) | null
  >(null);

  // AI State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");

  const aiManagerRef = useRef<AIManager | null>(null);

  // Input History Functions
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

  // Input Insert Functions
  const insertToInput = useCallback(
    (text: string) => {
      if (inputInsertHandler) {
        inputInsertHandler(text);
      }
    },
    [inputInsertHandler],
  );

  // Initialize AI manager
  useEffect(() => {
    const callbacks: AIManagerCallbacks = {
      onMessagesChange: (newMessages) => {
        setMessages([...newMessages]);
      },
      onLoadingChange: (loading) => {
        setIsLoading(loading);
      },
    };

    aiManagerRef.current = new AIManager(callbacks);

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
  }, [sessionToRestore]);

  // Update totalTokens and sessionId when messages change
  useEffect(() => {
    if (aiManagerRef.current) {
      const state = aiManagerRef.current.getState();
      setTotalTokens(state.totalTokens);
      setSessionId(state.sessionId);
    }
  }, [messages]);

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

  // Create bash manager
  const bashManagerRef = useRef<BashManager | null>(null);

  // Initialize bash manager
  useEffect(() => {
    if (!bashManagerRef.current) {
      bashManagerRef.current = createBashManager({
        onMessagesUpdate: setMessages,
      });
    }
  }, [setMessages]);

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
  const memoryManager = useMemo(() => createMemoryManager(), []);

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
    ) => {
      // 检查是否有内容可以发送（文本内容或图片附件）
      const hasTextContent = content.trim();
      const hasImageAttachments = images && images.length > 0;

      if (!hasTextContent && !hasImageAttachments) return;

      try {
        // Handle memory mode - 检查是否是记忆消息（以#开头且只有一行）
        if (content.startsWith("#") && !content.includes("\n")) {
          const memoryText = content.substring(1).trim();
          if (!memoryText) return;

          // 在记忆模式下，不添加用户消息，只等待用户选择记忆类型后添加助手消息
          // 不自动保存，等待用户选择记忆类型
          return;
        }

        // Handle bash mode - 检查是否是bash命令（以!开头且只有一行）
        if (content.startsWith("!") && !content.includes("\n")) {
          const command = content.substring(1).trim();
          if (!command) return;

          // 添加用户消息到历史记录（但不显示在UI中）
          addToInputHistory(content);

          // 在bash模式下，不添加用户消息到UI，直接执行命令
          // 执行bash命令会自动添加助手消息
          await executeCommand(command);
          return;
        }

        // Handle normal AI message
        // 添加用户消息到历史记录
        addToInputHistory(content);

        // 添加用户消息，会自动同步到 UI
        aiManagerRef.current?.addUserMessage(content, images);

        // 发送AI消息
        await aiManagerRef.current?.sendAIMessage();
      } catch (error) {
        console.error("Failed to send message:", error);
        // Loading state will be automatically updated by the useEffect that watches messages
      }
    },
    [addToInputHistory, executeCommand],
  );

  const contextValue: ChatContextType = {
    messages,
    setMessages,
    isLoading,
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
