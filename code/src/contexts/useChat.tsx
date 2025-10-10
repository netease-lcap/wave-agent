import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import { useAppConfig } from "./useAppConfig.js";
import type { Message, McpServerStatus } from "wave-agent-sdk";
import { AIManager, AIManagerCallbacks } from "wave-agent-sdk";
import { logger } from "../utils/logger.js";

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
  totalTokens: number;
  // Memory functionality
  saveMemory: (message: string, type: "project" | "user") => Promise<void>;
  // MCP functionality
  mcpServers: McpServerStatus[];
  connectMcpServer: (serverName: string) => Promise<boolean>;
  disconnectMcpServer: (serverName: string) => Promise<boolean>;
  reconnectMcpServer: (serverName: string) => Promise<boolean>;
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
  const { restoreSessionId, continueLastSession } = useAppConfig();

  // Input Insert State
  const [inputInsertHandler, setInputInsertHandler] = useState<
    ((text: string) => void) | null
  >(null);

  // AI State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

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
    let isMounted = true;

    const initializeAIManager = async () => {
      const callbacks: AIManagerCallbacks = {
        onMessagesChange: (newMessages) => {
          if (isMounted) {
            setMessages([...newMessages]);
          }
        },
        onLoadingChange: (loading) => {
          if (isMounted) {
            setIsLoading(loading);
          }
        },
        onMcpServersChange: (servers) => {
          if (isMounted) {
            setMcpServers([...servers]);
          }
        },
      };

      try {
        const aiManager = await AIManager.create({
          callbacks,
          restoreSessionId,
          continueLastSession,
          logger,
        });

        if (isMounted) {
          aiManagerRef.current = aiManager;

          // Get initial state
          setSessionId(aiManager.sessionId);
          setMessages(aiManager.messages);
          setIsLoading(aiManager.isLoading);
          setTotalTokens(aiManager.totalTokens);

          // Get initial MCP servers state
          const mcpServers = aiManager.getMcpServers?.() || [];
          setMcpServers(mcpServers);
        }
      } catch (error) {
        console.error("Failed to initialize AI manager:", error);
      }
    };

    initializeAIManager();

    return () => {
      isMounted = false;
    };
  }, [restoreSessionId, continueLastSession]);

  // Update totalTokens and sessionId when messages change
  useEffect(() => {
    if (aiManagerRef.current) {
      setTotalTokens(aiManagerRef.current.totalTokens);
      setSessionId(aiManagerRef.current.sessionId);
    }
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aiManagerRef.current) {
        aiManagerRef.current.destroy();
      }
    };
  }, []);

  // Get command running state from AI manager
  const isCommandRunning = aiManagerRef.current?.getIsCommandRunning() ?? false;

  // Get user input history from AI manager
  const userInputHistory = aiManagerRef.current?.userInputHistory ?? [];

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

  // MCP 管理方法 - 委托给 AIManager
  const connectMcpServer = useCallback(async (serverName: string) => {
    return (await aiManagerRef.current?.connectMcpServer(serverName)) ?? false;
  }, []);

  const disconnectMcpServer = useCallback(async (serverName: string) => {
    return (
      (await aiManagerRef.current?.disconnectMcpServer(serverName)) ?? false
    );
  }, []);

  const reconnectMcpServer = useCallback(async (serverName: string) => {
    return (
      (await aiManagerRef.current?.reconnectMcpServer(serverName)) ?? false
    );
  }, []);

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
    totalTokens,
    saveMemory,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    reconnectMcpServer,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
