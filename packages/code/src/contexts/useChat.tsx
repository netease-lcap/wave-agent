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
  BackgroundTask,
  Task,
  SlashCommand,
  PermissionDecision,
  PermissionMode,
} from "wave-agent-sdk";
import {
  Agent,
  AgentCallbacks,
  type ToolPermissionContext,
} from "wave-agent-sdk";
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
  isTaskListVisible: boolean;
  setIsTaskListVisible: (visible: boolean) => void;
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => Promise<void>;
  abortMessage: () => void;
  latestTotalTokens: number;
  // MCP functionality
  mcpServers: McpServerStatus[];
  connectMcpServer: (serverName: string) => Promise<boolean>;
  disconnectMcpServer: (serverName: string) => Promise<boolean>;
  // Background tasks
  backgroundTasks: BackgroundTask[];
  // Session tasks
  sessionTasks: Task[];
  getBackgroundTaskOutput: (
    taskId: string,
  ) => { stdout: string; stderr: string; status: string } | null;
  stopBackgroundTask: (taskId: string) => boolean;
  // Slash Command functionality
  slashCommands: SlashCommand[];
  hasSlashCommand: (commandId: string) => boolean;
  // Subagent messages
  subagentMessages: Record<string, Message[]>;
  subagentLatestTokens: Record<string, number>;
  // Permission functionality
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  // Permission confirmation state
  isConfirmationVisible: boolean;
  confirmingTool?: {
    name: string;
    input?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
  };
  showConfirmation: (
    toolName: string,
    toolInput?: Record<string, unknown>,
    suggestedPrefix?: string,
    hidePersistentOption?: boolean,
  ) => Promise<PermissionDecision>;
  hideConfirmation: () => void;
  handleConfirmationDecision: (decision: PermissionDecision) => void;
  handleConfirmationCancel: () => void;
  // Background current task
  backgroundCurrentTask: () => void;
  // Rewind functionality
  rewindId: number;
  handleRewindSelect: (index: number) => Promise<void>;
  getFullMessageThread: () => Promise<{
    messages: Message[];
    sessionIds: string[];
  }>;
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
  bypassPermissions?: boolean;
  pluginDirs?: string[];
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  bypassPermissions,
  pluginDirs,
}) => {
  const { restoreSessionId, continueLastSession } = useAppConfig();

  // Message Display State
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTaskListVisible, setIsTaskListVisible] = useState(true);

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

  // Background tasks state
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  // Session tasks state
  const [sessionTasks, setSessionTasks] = useState<Task[]>([]);

  // Command state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // Subagent messages state
  const [subagentMessages, setSubagentMessages] = useState<
    Record<string, Message[]>
  >({});
  const [subagentLatestTokens, setSubagentLatestTokens] = useState<
    Record<string, number>
  >({});

  // Permission state
  const [permissionMode, setPermissionModeState] =
    useState<PermissionMode>("default");

  // Confirmation state with queue-based architecture
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false);
  const [confirmingTool, setConfirmingTool] = useState<
    | {
        name: string;
        input?: Record<string, unknown>;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
      }
    | undefined
  >();
  const [confirmationQueue, setConfirmationQueue] = useState<
    Array<{
      toolName: string;
      toolInput?: Record<string, unknown>;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      resolver: (decision: PermissionDecision) => void;
      reject: () => void;
    }>
  >([]);
  const [currentConfirmation, setCurrentConfirmation] = useState<{
    toolName: string;
    toolInput?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
    resolver: (decision: PermissionDecision) => void;
    reject: () => void;
  } | null>(null);

  // Rewind state
  const [rewindId, setRewindId] = useState(0);

  const agentRef = useRef<Agent | null>(null);

  // Permission confirmation methods with queue support
  const showConfirmation = useCallback(
    async (
      toolName: string,
      toolInput?: Record<string, unknown>,
      suggestedPrefix?: string,
      hidePersistentOption?: boolean,
    ): Promise<PermissionDecision> => {
      return new Promise<PermissionDecision>((resolve, reject) => {
        const queueItem = {
          toolName,
          toolInput,
          suggestedPrefix,
          hidePersistentOption,
          resolver: resolve,
          reject,
        };

        setConfirmationQueue((prev) => [...prev, queueItem]);
        // processNextConfirmation will be called via useEffect
      });
    },
    [],
  );

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
        onTasksChange: (tasks) => {
          setBackgroundTasks([...tasks]);
        },
        onSessionTasksChange: (tasks) => {
          setSessionTasks([...tasks]);
        },
        onSubagentMessagesChange: (subagentId: string, messages: Message[]) => {
          logger.debug("onSubagentMessagesChange", subagentId, messages.length);
          setSubagentMessages((prev) => ({
            ...prev,
            [subagentId]: [...messages],
          }));
        },
        onSubagentLatestTotalTokensChange: (
          subagentId: string,
          tokens: number,
        ) => {
          setSubagentLatestTokens((prev) => ({
            ...prev,
            [subagentId]: tokens,
          }));
        },
        onPermissionModeChange: (mode) => {
          setPermissionModeState(mode);
        },
        onSlashCommandsChange: (commands) => {
          setSlashCommands([...commands]);
        },
      };

      try {
        // Create the permission callback inside the try block to access showConfirmation
        const permissionCallback = bypassPermissions
          ? undefined
          : async (
              context: ToolPermissionContext,
            ): Promise<PermissionDecision> => {
              try {
                return await showConfirmation(
                  context.toolName,
                  context.toolInput,
                  context.suggestedPrefix,
                  context.hidePersistentOption,
                );
              } catch {
                // If confirmation was cancelled or failed, deny the operation
                return {
                  behavior: "deny",
                  message: "Operation cancelled by user",
                };
              }
            };

        const agent = await Agent.create({
          callbacks,
          restoreSessionId,
          continueLastSession,
          logger,
          permissionMode: bypassPermissions ? "bypassPermissions" : undefined,
          canUseTool: permissionCallback,
          stream: false, // 关闭流式模式
          plugins: pluginDirs?.map((path) => ({ type: "local", path })),
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
        setPermissionModeState(agent.getPermissionMode());

        // Get initial MCP servers state
        const mcpServers = agent.getMcpServers?.() || [];
        setMcpServers(mcpServers);

        // Get initial commands
        const agentSlashCommands = agent.getSlashCommands?.() || [];
        setSlashCommands(agentSlashCommands);
      } catch (error) {
        console.error("Failed to initialize AI manager:", error);
      }
    };

    initializeAgent();
  }, [
    restoreSessionId,
    continueLastSession,
    bypassPermissions,
    showConfirmation,
    pluginDirs,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (agentRef.current) {
        try {
          // Display usage summary before cleanup
          const usages = agentRef.current.usages;
          const sessionFilePath = agentRef.current.sessionFilePath;
          displayUsageSummary(usages, sessionFilePath);
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

  // Permission management methods
  const setPermissionMode = useCallback((mode: PermissionMode) => {
    setPermissionModeState((prev) => {
      if (prev === mode) return prev;
      if (agentRef.current && agentRef.current.getPermissionMode() !== mode) {
        agentRef.current.setPermissionMode(mode);
      }
      return mode;
    });
  }, []);

  // MCP management methods - delegate to Agent
  const connectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.connectMcpServer(serverName)) ?? false;
  }, []);

  const disconnectMcpServer = useCallback(async (serverName: string) => {
    return (await agentRef.current?.disconnectMcpServer(serverName)) ?? false;
  }, []);

  // Background task management methods - delegate to Agent
  const getBackgroundTaskOutput = useCallback((taskId: string) => {
    if (!agentRef.current) return null;
    return agentRef.current.getBackgroundTaskOutput(taskId);
  }, []);

  const stopBackgroundTask = useCallback((taskId: string) => {
    if (!agentRef.current) return false;
    return agentRef.current.stopBackgroundTask(taskId);
  }, []);

  const hasSlashCommand = useCallback((commandId: string) => {
    if (!agentRef.current) return false;
    return agentRef.current.hasSlashCommand(commandId);
  }, []);

  // Queue processing helper
  const processNextConfirmation = useCallback(() => {
    if (confirmationQueue.length > 0 && !isConfirmationVisible) {
      const next = confirmationQueue[0];
      setCurrentConfirmation(next);
      setConfirmingTool({
        name: next.toolName,
        input: next.toolInput,
        suggestedPrefix: next.suggestedPrefix,
        hidePersistentOption: next.hidePersistentOption,
      });
      setIsConfirmationVisible(true);
      setConfirmationQueue((prev) => prev.slice(1));
    }
  }, [confirmationQueue, isConfirmationVisible]);

  // Process queue when queue changes or confirmation is hidden
  useEffect(() => {
    processNextConfirmation();
  }, [processNextConfirmation]);

  const hideConfirmation = useCallback(() => {
    setIsConfirmationVisible(false);
    setConfirmingTool(undefined);
    setCurrentConfirmation(null);
  }, []);

  const handleConfirmationDecision = useCallback(
    (decision: PermissionDecision) => {
      if (currentConfirmation) {
        currentConfirmation.resolver(decision);
      }
      hideConfirmation();
    },
    [currentConfirmation, hideConfirmation],
  );

  const handleConfirmationCancel = useCallback(() => {
    if (currentConfirmation) {
      currentConfirmation.reject();
    }
    hideConfirmation();
  }, [currentConfirmation, hideConfirmation]);

  const backgroundCurrentTask = useCallback(() => {
    agentRef.current?.backgroundCurrentTask();
  }, []);

  const handleRewindSelect = useCallback(async (index: number) => {
    if (agentRef.current) {
      try {
        await agentRef.current.truncateHistory(index);

        // Clear terminal screen after rewind
        setRewindId((prev) => prev + 1);
      } catch (error) {
        logger.error("Failed to rewind:", error);
      }
    }
  }, []);

  const getFullMessageThread = useCallback(async () => {
    if (agentRef.current) {
      return await agentRef.current.getFullMessageThread();
    }
    return { messages: [], sessionIds: [] };
  }, []);

  // Listen for Ctrl+O hotkey to toggle collapse/expand state and ESC to cancel confirmation
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      // Clear terminal screen when expanded state changes
      setIsExpanded((prev) => {
        const newExpanded = !prev;
        return newExpanded;
      });
    }

    if (key.ctrl && input === "t") {
      setIsTaskListVisible((prev) => !prev);
    }

    // Handle ESC key to cancel confirmation
    if (key.escape && isConfirmationVisible) {
      handleConfirmationCancel();
    }
  });

  const contextValue: ChatContextType = {
    messages,
    isLoading,
    isCommandRunning,
    userInputHistory,
    isExpanded,
    isTaskListVisible,
    setIsTaskListVisible,
    sessionId,
    sendMessage,
    abortMessage,
    latestTotalTokens,
    isCompressing,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    backgroundTasks,
    sessionTasks,
    getBackgroundTaskOutput,
    stopBackgroundTask,
    slashCommands,
    hasSlashCommand,
    subagentMessages,
    subagentLatestTokens,
    permissionMode,
    setPermissionMode,
    isConfirmationVisible,
    confirmingTool,
    showConfirmation,
    hideConfirmation,
    handleConfirmationDecision,
    handleConfirmationCancel,
    backgroundCurrentTask,
    rewindId,
    handleRewindSelect,
    getFullMessageThread,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
