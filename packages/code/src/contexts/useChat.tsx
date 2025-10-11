import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import { useInput } from "ink";
import { useAppConfig } from "./useAppConfig.js";
import type {
  Message,
  McpServerStatus,
  BackgroundShell,
  BackgroundBashManager,
} from "wave-agent-sdk";
import { Agent, AgentCallbacks } from "wave-agent-sdk";
import { logger } from "../utils/logger.js";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  clearMessages: () => void;
  isCommandRunning: boolean;
  userInputHistory: string[];
  // Message display state
  isExpanded: boolean;
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
  // Background bash shells
  backgroundShells: BackgroundShell[];
  getBackgroundShellOutput: (
    shellId: string,
  ) => { stdout: string; stderr: string; status: string } | null;
  killBackgroundShell: (shellId: string) => boolean;
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

  // Message Display State
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(isExpanded);

  // 记录在展开状态时被阻止的状态更新
  const pendingUpdatesRef = useRef<{
    messages?: Message[];
    isLoading?: boolean;
    latestTotalTokens?: number;
    isCommandRunning?: boolean;
    mcpServers?: McpServerStatus[];
    sessionId?: string;
    userInputHistory?: string[];
    backgroundShells?: BackgroundShell[];
  }>({});

  // AI State
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [latestTotalTokens, setlatestTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [userInputHistory, setUserInputHistory] = useState<string[]>([]);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  // Background bash shells state
  const [backgroundShells, setBackgroundShells] = useState<BackgroundShell[]>(
    [],
  );

  // Background bash manager ref
  const backgroundBashManagerRef = useRef<BackgroundBashManager | null>(null);

  const agentRef = useRef<Agent | null>(null);

  // 监听 Ctrl+R 快捷键切换折叠/展开状态
  useInput((input, key) => {
    if (key.ctrl && input === "r") {
      setIsExpanded((prev) => {
        const newValue = !prev;
        isExpandedRef.current = newValue;

        // 如果从展开状态切换到收起状态，应用pending的更新
        if (prev && !newValue) {
          const pending = pendingUpdatesRef.current;
          if (pending.messages !== undefined) {
            setMessages([...pending.messages]);
          }
          if (pending.isLoading !== undefined) {
            setIsLoading(pending.isLoading);
          }
          if (pending.latestTotalTokens !== undefined) {
            setlatestTotalTokens(pending.latestTotalTokens);
          }
          if (pending.isCommandRunning !== undefined) {
            setIsCommandRunning(pending.isCommandRunning);
          }
          if (pending.mcpServers !== undefined) {
            setMcpServers([...pending.mcpServers]);
          }
          if (pending.sessionId !== undefined) {
            setSessionId(pending.sessionId);
          }
          if (pending.userInputHistory !== undefined) {
            setUserInputHistory([...pending.userInputHistory]);
          }
          if (pending.backgroundShells !== undefined) {
            setBackgroundShells([...pending.backgroundShells]);
          }
          // 清空pending更新
          pendingUpdatesRef.current = {};
        }

        return newValue;
      });
    }
  });

  // Initialize AI manager
  useEffect(() => {
    let isMounted = true;

    const initializeAgent = async () => {
      const callbacks: AgentCallbacks = {
        onMessagesChange: (newMessages) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setMessages([...newMessages]);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.messages = newMessages;
            }
          }
        },
        onLoadingChange: (loading) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setIsLoading(loading);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.isLoading = loading;
            }
          }
        },
        onMcpServersChange: (servers) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setMcpServers([...servers]);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.mcpServers = servers;
            }
          }
        },
        onSessionIdChange: (sessionId) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setSessionId(sessionId);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.sessionId = sessionId;
            }
          }
        },
        onLatestTotalTokensChange: (tokens) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setlatestTotalTokens(tokens);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.latestTotalTokens = tokens;
            }
          }
        },
        onCommandRunningChange: (running) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setIsCommandRunning(running);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.isCommandRunning = running;
            }
          }
        },
        onUserInputHistoryChange: (history) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setUserInputHistory([...history]);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.userInputHistory = history;
            }
          }
        },
        onBackgroundShellsChange: (shells) => {
          if (isMounted) {
            if (!isExpandedRef.current) {
              setBackgroundShells([...shells]);
            } else {
              // 记录pending更新
              pendingUpdatesRef.current.backgroundShells = shells;
            }
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

          // Get background bash manager
          backgroundBashManagerRef.current = agent.getBackgroundBashManager();
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

  // Background bash 管理方法 - 委托给 Agent 的 BackgroundBashManager
  const getBackgroundShellOutput = useCallback((shellId: string) => {
    const manager = backgroundBashManagerRef.current;
    if (!manager) return null;
    return manager.getOutput(shellId);
  }, []);

  const killBackgroundShell = useCallback((shellId: string) => {
    const manager = backgroundBashManagerRef.current;
    if (!manager) return false;
    return manager.killShell(shellId);
  }, []);

  const contextValue: ChatContextType = {
    messages,
    isLoading,
    clearMessages,
    isCommandRunning,
    userInputHistory,
    isExpanded,
    sessionId,
    sendMessage,
    abortMessage,
    latestTotalTokens,
    saveMemory,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    reconnectMcpServer,
    backgroundShells,
    getBackgroundShellOutput,
    killBackgroundShell,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
