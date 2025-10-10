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
import { Agent, AgentCallbacks } from "wave-agent-sdk";
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
  latestTotalTokens: number;
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
  const [latestTotalTokens, setlatestTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [userInputHistory, setUserInputHistory] = useState<string[]>([]);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  const agentRef = useRef<Agent | null>(null);

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

    const initializeAgent = async () => {
      const callbacks: AgentCallbacks = {
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
        onSessionIdChange: (sessionId) => {
          if (isMounted) {
            setSessionId(sessionId);
          }
        },
        onLatestTotalTokensChange: (tokens) => {
          if (isMounted) {
            setlatestTotalTokens(tokens);
          }
        },
        onCommandRunningChange: (running) => {
          if (isMounted) {
            setIsCommandRunning(running);
          }
        },
        onUserInputHistoryChange: (history) => {
          if (isMounted) {
            setUserInputHistory([...history]);
          }
        },
      };

      try {
        const agent = await Agent.create({
          callbacks,
          restoreSessionId,
          continueLastSession,
          logger,
        });

        if (isMounted) {
          agentRef.current = agent;

          // Get initial state
          setSessionId(agent.sessionId);
          setMessages(agent.messages);
          setIsLoading(agent.isLoading);
          setlatestTotalTokens(agent.latestTotalTokens);
          setIsCommandRunning(agent.isCommandRunning);
          setUserInputHistory(agent.userInputHistory);

          // Get initial MCP servers state
          const mcpServers = agent.getMcpServers?.() || [];
          setMcpServers(mcpServers);
        }
      } catch (error) {
        console.error("Failed to initialize AI manager:", error);
      }
    };

    initializeAgent();

    return () => {
      isMounted = false;
    };
  }, [restoreSessionId, continueLastSession]);

  // Update latestTotalTokens and sessionId when messages change
  useEffect(() => {
    if (agentRef.current) {
      setlatestTotalTokens(agentRef.current.latestTotalTokens);
      setSessionId(agentRef.current.sessionId);
    }
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (agentRef.current) {
        agentRef.current.destroy();
      }
    };
  }, []);

  // 发送消息函数 (简化，逻辑移动到 Agent)
  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
    ) => {
      await agentRef.current?.sendMessage(content, images);
    },
    [],
  );

  const clearMessages = useCallback(() => {
    agentRef.current?.clearMessages();
  }, []);

  // 统一的中断方法，同时中断AI消息和命令执行
  const abortMessage = useCallback(() => {
    agentRef.current?.abortMessage();
  }, []);

  // 记忆保存函数 - 委托给 Agent
  const saveMemory = useCallback(
    async (message: string, type: "project" | "user") => {
      await agentRef.current?.saveMemory(message, type);
    },
    [],
  );

  // MCP 管理方法 - 委托给 Agent
  const connectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.connectMcpServer(serverName)) ?? false;
  }, []);

  const disconnectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.disconnectMcpServer(serverName)) ?? false;
  }, []);

  const reconnectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.reconnectMcpServer(serverName)) ?? false;
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
    latestTotalTokens,
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
