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
  SlashCommand,
  Usage,
} from "wave-agent-sdk";
import { Agent, AgentCallbacks } from "wave-agent-sdk";
import { logger } from "../utils/logger.js";
import { displayUsageSummary } from "../utils/usageSummary.js";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  isCommandRunning: boolean;
  isCompressing: boolean;
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
  // Background bash shells
  backgroundShells: BackgroundShell[];
  getBackgroundShellOutput: (
    shellId: string,
  ) => { stdout: string; stderr: string; status: string } | null;
  killBackgroundShell: (shellId: string) => boolean;
  // Slash Command functionality
  slashCommands: SlashCommand[];
  hasSlashCommand: (commandId: string) => boolean;
  // Usage tracking
  usages: Usage[];
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
  const [isCompressing, setIsCompressing] = useState(false);
  const [userInputHistory, setUserInputHistory] = useState<string[]>([]);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  // Background bash shells state
  const [backgroundShells, setBackgroundShells] = useState<BackgroundShell[]>(
    [],
  );

  // Command state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // Usage tracking state
  const [usages, setUsages] = useState<Usage[]>([]);

  const agentRef = useRef<Agent | null>(null);

  // Listen for Ctrl+O hotkey to toggle collapse/expand state
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setIsExpanded((prev) => !prev);
    }
  });

  // Initialize AI manager
  useEffect(() => {
    const initializeAgent = async () => {
      const callbacks: AgentCallbacks = {
        onMessagesChange: (newMessages) => {
          setMessages([...newMessages]);
        },
        onServersChange: (servers) => {
          setMcpServers([...servers]);
        },
        onSessionIdChange: (sessionId) => {
          setSessionId(sessionId);
        },
        onLatestTotalTokensChange: (tokens) => {
          setlatestTotalTokens(tokens);
        },
        onUserInputHistoryChange: (history) => {
          setUserInputHistory([...history]);
        },
        onCompressionStateChange: (isCompressingState) => {
          setIsCompressing(isCompressingState);
        },
        onShellsChange: (shells) => {
          setBackgroundShells([...shells]);
        },
        onUsagesChange: (newUsages) => {
          setUsages([...newUsages]);
        },
      };

      try {
        const agent = await Agent.create({
          callbacks,
          restoreSessionId,
          continueLastSession,
          logger,
        });

        agentRef.current = agent;

        // Get initial state
        setSessionId(agent.sessionId);
        setMessages(agent.messages);
        setIsLoading(agent.isLoading);
        setlatestTotalTokens(agent.latestTotalTokens);
        setIsCommandRunning(agent.isCommandRunning);
        setIsCompressing(agent.isCompressing);
        setUserInputHistory(agent.userInputHistory);

        // Get initial MCP servers state
        const mcpServers = agent.getMcpServers?.() || [];
        setMcpServers(mcpServers);

        // Get initial commands
        const agentSlashCommands = agent.getSlashCommands?.() || [];
        setSlashCommands(agentSlashCommands);

        // Get initial usages
        setUsages(agent.usages);
      } catch (error) {
        console.error("Failed to initialize AI manager:", error);
      }
    };

    initializeAgent();
  }, [restoreSessionId, continueLastSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (agentRef.current) {
        try {
          // Display usage summary before cleanup
          const usages = agentRef.current.usages;
          displayUsageSummary(usages);
        } catch {
          // Silently ignore usage summary errors during cleanup
        }

        agentRef.current.destroy();
      }
    };
  }, []);

  // Send message function (including judgment logic)
  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
    ) => {
      // Check if there's content to send (text content or image attachments)
      const hasTextContent = content.trim();
      const hasImageAttachments = images && images.length > 0;

      if (!hasTextContent && !hasImageAttachments) return;

      try {
        // Handle memory mode - check if it's a memory message (starts with # and only one line)
        if (content.startsWith("#") && !content.includes("\n")) {
          const memoryText = content.substring(1).trim();
          if (!memoryText) return;

          // In memory mode, don't add user message, only wait for user to choose memory type then add assistant message
          // Don't auto-save, wait for user to choose memory type
          return;
        }

        // Handle bash mode - check if it's a bash command (starts with ! and only one line)
        if (content.startsWith("!") && !content.includes("\n")) {
          const command = content.substring(1).trim();
          if (!command) return;

          // In bash mode, don't add user message to UI, directly execute command
          // Executing bash command will automatically add assistant message

          // Set command running state
          setIsCommandRunning(true);

          try {
            await agentRef.current?.executeBashCommand(command);
          } finally {
            // Clear command running state
            setIsCommandRunning(false);
          }

          return;
        }

        // Handle normal AI message and slash commands
        // Slash commands are now handled internally in agent.sendMessage

        // Set loading state
        setIsLoading(true);

        try {
          await agentRef.current?.sendMessage(content, images);
        } finally {
          // Clear loading state
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        // Loading state will be automatically updated by the useEffect that watches messages
      }
    },
    [],
  );

  // Unified interrupt method, interrupt both AI messages and command execution
  const abortMessage = useCallback(() => {
    agentRef.current?.abortMessage();
  }, []);

  // Memory save function - delegate to Agent
  const saveMemory = useCallback(
    async (message: string, type: "project" | "user") => {
      await agentRef.current?.saveMemory(message, type);
    },
    [],
  );

  // MCP management methods - delegate to Agent
  const connectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.connectMcpServer(serverName)) ?? false;
  }, []);

  const disconnectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.disconnectMcpServer(serverName)) ?? false;
  }, []);

  // Background bash management methods - delegate to Agent
  const getBackgroundShellOutput = useCallback((shellId: string) => {
    if (!agentRef.current) return null;
    return agentRef.current.getBackgroundShellOutput(shellId);
  }, []);

  const killBackgroundShell = useCallback((shellId: string) => {
    if (!agentRef.current) return false;
    return agentRef.current.killBackgroundShell(shellId);
  }, []);

  const hasSlashCommand = useCallback((commandId: string) => {
    if (!agentRef.current) return false;
    return agentRef.current.hasSlashCommand(commandId);
  }, []);

  const contextValue: ChatContextType = {
    messages,
    isLoading,
    isCommandRunning,
    userInputHistory,
    isExpanded,
    sessionId,
    sendMessage,
    abortMessage,
    latestTotalTokens,
    isCompressing,
    saveMemory,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    backgroundShells,
    getBackgroundShellOutput,
    killBackgroundShell,
    slashCommands,
    hasSlashCommand,
    usages,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
