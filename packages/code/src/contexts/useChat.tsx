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

  // 监听 Ctrl+O 快捷键切换折叠/展开状态
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setIsExpanded((prev) => !prev);
    }
  });

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
        onUserInputHistoryChange: (history) => {
          if (isMounted) {
            setUserInputHistory([...history]);
          }
        },
        onBackgroundShellsChange: (shells) => {
          if (isMounted) {
            setBackgroundShells([...shells]);
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

  // 发送消息函数 (包含判断逻辑)
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
          agentRef.current?.addToInputHistory(content);

          // 在bash模式下，不添加用户消息到UI，直接执行命令
          // 执行bash命令会自动添加助手消息

          // 设置 command running 状态
          setIsCommandRunning(true);

          try {
            await agentRef.current?.executeBashCommand(command);
          } finally {
            // 清除 command running 状态
            setIsCommandRunning(false);
          }

          return;
        }

        // Handle normal AI message

        // 设置 loading 状态
        setIsLoading(true);

        try {
          await agentRef.current?.sendMessage(content, images);
        } finally {
          // 清除 loading 状态
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        // Loading state will be automatically updated by the useEffect that watches messages
      }
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
