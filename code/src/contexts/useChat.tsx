import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import { useAppConfig } from "./useAppConfig.js";
import type { Message } from "wave-agent-sdk";
import { AIManager, AIManagerCallbacks } from "wave-agent-sdk";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  clearMessages: () => void;
  isCommandRunning: boolean;
  userInputHistory: string[];
  insertToInput: (text: string) => void;
  inputInsertHandler: ((text: string) => void) | null;
  setInputInsertHandler: (handler: (text: string) => void) => void;
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => Promise<void>;
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

  // Get command running state from AI manager
  const isCommandRunning = aiManagerRef.current?.getIsCommandRunning() ?? false;

  // Get user input history from AI manager
  const userInputHistory =
    aiManagerRef.current?.getState().userInputHistory ?? [];

  // 发送消息函数 (简化，逻辑移动到 AIManager)
  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
    ) => {
      await aiManagerRef.current?.sendMessage(content, images);
    },
    [],
  );

  const clearMessages = useCallback(() => {
    aiManagerRef.current?.clearMessages();
  }, []);

  // 统一的中断方法，同时中断AI消息和命令执行
  const abortMessage = useCallback(() => {
    aiManagerRef.current?.abortMessage();
  }, []);

  // 记忆保存函数 - 委托给 AIManager
  const saveMemory = useCallback(
    async (message: string, type: "project" | "user") => {
      await aiManagerRef.current?.saveMemory(message, type);
    },
    [],
  );

  const contextValue: ChatContextType = {
    messages,
    isLoading,
    clearMessages,
    isCommandRunning,
    userInputHistory,
    insertToInput,
    inputInsertHandler,
    setInputInsertHandler,
    sessionId,
    sendMessage,
    abortMessage,
    resetSession,
    totalTokens,
    saveMemory,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
