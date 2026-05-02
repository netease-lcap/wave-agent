import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
  useMemo,
} from "react";
import { useInput, useStdout } from "ink";
import { useAppConfig } from "./useAppConfig.js";
import type {
  Message,
  McpServerStatus,
  BackgroundTask,
  Task,
  SlashCommand,
  PermissionDecision,
  PermissionMode,
  QueuedMessage,
} from "wave-agent-sdk";
import {
  Agent,
  AgentCallbacks,
  type ToolPermissionContext,
  OPERATION_CANCELLED_BY_USER,
  extractLatestTotalTokens,
} from "wave-agent-sdk";
import { logger } from "../utils/logger.js";
import { throttle } from "../utils/throttle.js";
import { displayUsageSummary } from "../utils/usageSummary.js";
import { expandLongTextPlaceholders } from "../managers/inputHandlers.js";

import { BaseAppProps } from "../types.js";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  isCommandRunning: boolean;
  isCompacting: boolean;
  // Message display state
  isExpanded: boolean;
  isTaskListVisible: boolean;
  setIsTaskListVisible: (visible: boolean) => void;
  queuedMessages: QueuedMessage[];
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => Promise<void>;
  askBtw: (question: string) => Promise<string>;
  abortMessage: () => void;
  latestTotalTokens: number;
  // Model functionality
  currentModel: string;
  configuredModels: string[];
  getConfiguredModels: () => string[];
  setModel: (model: string) => void;
  // MCP functionality
  mcpServers: McpServerStatus[];
  connectMcpServer: (serverName: string) => Promise<boolean>;
  disconnectMcpServer: (serverName: string) => Promise<boolean>;
  // Background tasks
  backgroundTasks: BackgroundTask[];
  // Tasks
  tasks: Task[];
  getBackgroundTaskOutput: (taskId: string) => {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
  } | null;
  stopBackgroundTask: (taskId: string) => boolean;
  // Slash Command functionality
  slashCommands: SlashCommand[];
  hasSlashCommand: (commandId: string) => boolean;
  // Permission functionality
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  // Permission confirmation state
  isConfirmationVisible: boolean;
  hasPendingConfirmations: boolean;
  confirmingTool?: {
    name: string;
    input?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
    planContent?: string;
  };
  showConfirmation: (
    toolName: string,
    toolInput?: Record<string, unknown>,
    suggestedPrefix?: string,
    hidePersistentOption?: boolean,
    planContent?: string,
  ) => Promise<PermissionDecision>;
  hideConfirmation: () => void;
  handleConfirmationDecision: (decision: PermissionDecision) => void;
  handleConfirmationCancel: () => void;
  // Background current task
  backgroundCurrentTask: () => void;
  // Remount functionality
  remountKey: number;
  requestRemount: () => void;
  // Rewind functionality
  handleRewindSelect: (index: number) => Promise<void>;
  getFullMessageThread: () => Promise<{
    messages: Message[];
    sessionIds: string[];
  }>;
  // Status metadata
  getGatewayConfig: () => import("wave-agent-sdk").GatewayConfig;
  getModelConfig: () => import("wave-agent-sdk").ModelConfig;
  workingDirectory: string;
  version?: string;
  workdir?: string;
  // Agent recreation (e.g. after plugin install)
  recreateAgent: () => void;
  // Trigger WorktreeRemove hook BEFORE agent destruction
  triggerWorktreeRemoveHook: (worktreePath: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
};

export interface ChatProviderProps extends BaseAppProps {
  children: React.ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  bypassPermissions,
  permissionMode: initialPermissionMode,
  pluginDirs,
  tools,
  allowedTools,
  disallowedTools,
  workdir,
  worktreeSession,
  version,
  model,
  mcpServers,
}) => {
  const { restoreSessionId, continueLastSession } = useAppConfig();
  const { stdout } = useStdout();

  // Message Display State
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(isExpanded);

  const [isTaskListVisible, setIsTaskListVisible] = useState(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [latestTotalTokens, setLatestTotalTokens] = useState(0);

  const throttledSetMessages = useMemo(
    () =>
      throttle(
        () => {
          if (!isExpandedRef.current && agentRef.current) {
            const msgs = [...agentRef.current.messages];
            setMessages(msgs);
            setLatestTotalTokens(extractLatestTotalTokens(msgs));
          }
        },
        500,
        { leading: true, trailing: true },
      ),
    [],
  );

  useEffect(() => {
    isExpandedRef.current = isExpanded;
    if (isExpanded) {
      throttledSetMessages.cancel();
    }
  }, [isExpanded, throttledSetMessages]);

  useEffect(() => {
    return () => {
      throttledSetMessages.cancel();
    };
  }, [throttledSetMessages]);

  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [currentModel, setCurrentModelState] = useState("");
  const [configuredModels, setConfiguredModels] = useState<string[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

  // MCP State
  const [mcpServerStatuses, setMcpServerStatuses] = useState<McpServerStatus[]>(
    [],
  );

  // Background tasks state
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);

  // Command state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // Permission state
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    initialPermissionMode ||
      (bypassPermissions ? "bypassPermissions" : "default"),
  );

  // Confirmation state with queue-based architecture
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false);
  const [confirmingTool, setConfirmingTool] = useState<
    | {
        name: string;
        input?: Record<string, unknown>;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
        planContent?: string;
      }
    | undefined
  >();
  const [confirmationQueue, setConfirmationQueue] = useState<
    Array<{
      toolName: string;
      toolInput?: Record<string, unknown>;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      planContent?: string;
      resolver: (decision: PermissionDecision) => void;
      reject: () => void;
    }>
  >([]);
  const [currentConfirmation, setCurrentConfirmation] = useState<{
    toolName: string;
    toolInput?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
    planContent?: string;
    resolver: (decision: PermissionDecision) => void;
    reject: () => void;
  } | null>(null);

  // Remount state
  const [remountKey, setRemountKey] = useState(0);
  const prevSessionId = useRef<string | null>(null);

  const requestRemount = useMemo(
    () =>
      throttle(
        () => {
          logger.info("requesting remount");
          stdout?.write("\u001b[2J\u001b[3J\u001b[0;0H", () => {
            setRemountKey((prev) => prev + 1);
          });
        },
        1000,
        { leading: true, trailing: false },
      ),
    [stdout],
  );

  useEffect(() => {
    return () => {
      requestRemount.cancel();
    };
  }, [requestRemount]);

  // Track sessionId changes to trigger remount
  useEffect(() => {
    if (
      prevSessionId.current &&
      sessionId &&
      prevSessionId.current !== sessionId
    ) {
      requestRemount();
    }
    if (sessionId) {
      prevSessionId.current = sessionId;
    }
  }, [sessionId, requestRemount]);

  // Status metadata state
  const [workingDirectory, setWorkingDirectory] = useState("");

  const agentRef = useRef<Agent | null>(null);

  // Permission confirmation methods with queue support
  const showConfirmation = useCallback(
    async (
      toolName: string,
      toolInput?: Record<string, unknown>,
      suggestedPrefix?: string,
      hidePersistentOption?: boolean,
      planContent?: string,
    ): Promise<PermissionDecision> => {
      return new Promise<PermissionDecision>((resolve, reject) => {
        const queueItem = {
          toolName,
          toolInput,
          suggestedPrefix,
          hidePersistentOption,
          planContent,
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
  const initializeAgent = useCallback(
    async (restoreSessionIdOverride?: string) => {
      const effectiveRestoreSessionId =
        restoreSessionIdOverride ?? restoreSessionId;

      const callbacks: AgentCallbacks = {
        onMessagesChange: () => {
          throttledSetMessages();
        },
        onMcpServersChange: (servers) => {
          setMcpServerStatuses([...servers]);
        },
        onSessionIdChange: (sessionId) => {
          setSessionId(sessionId);
        },
        onCompactionStateChange: (isCompactingState) => {
          setIsCompacting(isCompactingState);
        },
        onBackgroundTasksChange: (tasks) => {
          setBackgroundTasks([...tasks]);
        },
        onTasksChange: (tasks) => {
          setTasks([...tasks]);
        },
        onPermissionModeChange: (mode) => {
          setPermissionModeState(mode);
        },
        onModelChange: (model) => {
          setCurrentModelState(model);
        },
        onConfiguredModelsChange: (models) => {
          setConfiguredModels(models);
        },
        onLoadingChange: (loading) => {
          setIsLoading(loading);
        },
        onCommandRunningChange: (running) => {
          setIsCommandRunning(running);
        },
        onQueuedMessagesChange: (messages) => {
          setQueuedMessages([...messages]);
        },
      };

      try {
        // Create the permission callback inside the try block to access showConfirmation
        const permissionCallback = async (
          context: ToolPermissionContext,
        ): Promise<PermissionDecision> => {
          try {
            return await showConfirmation(
              context.toolName,
              context.toolInput,
              context.suggestedPrefix,
              context.hidePersistentOption,
              context.planContent,
            );
          } catch {
            // If confirmation was cancelled or failed, deny the operation
            return {
              behavior: "deny",
              message: OPERATION_CANCELLED_BY_USER,
            };
          }
        };

        const agent = await Agent.create({
          callbacks,
          restoreSessionId: effectiveRestoreSessionId,
          continueLastSession,
          logger,
          permissionMode:
            initialPermissionMode ||
            (bypassPermissions ? "bypassPermissions" : undefined),
          canUseTool: permissionCallback,
          stream: true,
          plugins: pluginDirs?.map((path) => ({ type: "local", path })),
          tools,
          allowedTools,
          disallowedTools,
          workdir,
          worktreeName: worktreeSession?.name,
          isNewWorktree: worktreeSession?.isNew,
          model,
          mcpServers,
        });

        agentRef.current = agent;

        // Get initial state
        setSessionId(agent.sessionId);
        setMessages(agent.messages);
        setIsLoading(agent.isLoading);
        setLatestTotalTokens(extractLatestTotalTokens(agent.messages));
        setIsCommandRunning(agent.isCommandRunning);
        setIsCompacting(agent.isCompacting);
        setPermissionModeState(agent.getPermissionMode());
        setWorkingDirectory(agent.workingDirectory);
        setCurrentModelState(agent.getModelConfig().model);
        setConfiguredModels(agent.getConfiguredModels());

        // Get initial MCP servers state
        const initialMcpServers = agent.getMcpServers?.() || [];
        setMcpServerStatuses(initialMcpServers);

        // Get initial commands
        const agentSlashCommands = agent.getSlashCommands?.() || [];
        setSlashCommands(agentSlashCommands);
      } catch (error) {
        console.error("Failed to initialize AI manager:", error);
      }
    },
    [
      restoreSessionId,
      continueLastSession,
      bypassPermissions,
      showConfirmation,
      pluginDirs,
      tools,
      allowedTools,
      disallowedTools,
      workdir,
      worktreeSession,
      model,
      initialPermissionMode,
      throttledSetMessages,
      mcpServers,
    ],
  );

  // Recreate agent (e.g. after plugin install) — destroys current agent and reinitializes
  const recreateAgent = useCallback(() => {
    const currentSessionId = agentRef.current?.sessionId;
    if (agentRef.current) {
      try {
        agentRef.current.destroy();
      } catch {
        // Ignore destroy errors
      }
    }
    agentRef.current = null;
    setMessages([]);
    setMcpServerStatuses([]);
    setSlashCommands([]);
    setSessionId("");
    setIsLoading(false);
    setLatestTotalTokens(0);
    setIsCommandRunning(false);
    setIsCompacting(false);
    if (currentSessionId) {
      initializeAgent(currentSessionId);
    }
  }, [initializeAgent]);

  // Run initial agent creation
  useEffect(() => {
    initializeAgent();
  }, [initializeAgent]);

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

  // Trigger WorktreeRemove hook BEFORE agent destruction
  const triggerWorktreeRemoveHook = useCallback(
    async (worktreePath: string) => {
      await agentRef.current?.triggerWorktreeRemoveHook(worktreePath);
    },
    [],
  );

  // Send message function (including judgment logic)
  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
      longTextMap?: Record<string, string>,
    ) => {
      // Check if there's content to send (text content or image attachments)
      const hasTextContent = content.trim();
      const hasImageAttachments = images && images.length > 0;

      if (!hasTextContent && !hasImageAttachments) return;

      try {
        const expandedContent = longTextMap
          ? expandLongTextPlaceholders(content, longTextMap)
          : content;

        // Handle bash mode - check if it's a bash command (starts with ! and only one line)
        if (
          expandedContent.startsWith("!") &&
          !expandedContent.includes("\n") &&
          !hasImageAttachments
        ) {
          const command = expandedContent.substring(1).trim();
          if (command) {
            await agentRef.current?.bang(command);
            return;
          }
        }

        try {
          await agentRef.current?.sendMessage(expandedContent, images);
        } catch (error) {
          console.error("Failed to send message:", error);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    },
    [],
  );

  const askBtw = useCallback(async (question: string) => {
    if (!agentRef.current) {
      throw new Error("Agent not initialized");
    }
    return await agentRef.current.askBtw(question);
  }, []);

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
        planContent: next.planContent,
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
    agentRef.current?.abortMessage();
    hideConfirmation();
  }, [currentConfirmation, hideConfirmation]);

  const backgroundCurrentTask = useCallback(() => {
    agentRef.current?.backgroundCurrentTask();
  }, []);

  const handleRewindSelect = useCallback(
    async (index: number) => {
      if (agentRef.current) {
        try {
          await agentRef.current.truncateHistory(index);
          requestRemount();
        } catch (error) {
          logger.error("Failed to rewind:", error);
        }
      }
    },
    [requestRemount],
  );

  const getFullMessageThread = useCallback(async () => {
    if (agentRef.current) {
      return await agentRef.current.getFullMessageThread();
    }
    return { messages: [], sessionIds: [] };
  }, []);

  const getGatewayConfig = useCallback(() => {
    if (!agentRef.current) {
      return { baseURL: "" };
    }
    return agentRef.current.getGatewayConfig();
  }, []);

  const getModelConfig = useCallback(() => {
    if (!agentRef.current) {
      return { model: "", fastModel: "" };
    }
    return agentRef.current.getModelConfig();
  }, []);

  const getConfiguredModels = useCallback(() => {
    if (!agentRef.current) {
      return [];
    }
    return agentRef.current.getConfiguredModels();
  }, []);

  const setModel = useCallback((model: string) => {
    if (agentRef.current) {
      agentRef.current.setModel(model);
      setCurrentModelState(model);
    }
  }, []);

  // Listen for Ctrl+O hotkey to toggle collapse/expand state and ESC to cancel confirmation
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      // Clear terminal screen when expanded state changes
      // Use ref to get the current value to avoid stale closure
      const nextExpanded = !isExpandedRef.current;
      setIsExpanded(nextExpanded);
      isExpandedRef.current = nextExpanded;

      if (nextExpanded) {
        // Transitioning to EXPANDED: Freeze the current view
        // Cancel any pending throttled updates to avoid overwriting the frozen state
        throttledSetMessages.cancel();
      } else {
        // Transitioning to COLLAPSED: Restore from agent's actual state
        if (agentRef.current) {
          const msgs = [...agentRef.current.messages];
          setMessages(msgs);
          setLatestTotalTokens(extractLatestTotalTokens(msgs));
        }
      }
      // Force remount to re-render Static items with new isExpanded state
      requestRemount();
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
    isExpanded,
    isTaskListVisible,
    setIsTaskListVisible,
    queuedMessages,
    sessionId,
    sendMessage,
    askBtw,
    abortMessage,
    latestTotalTokens,
    currentModel,
    configuredModels,
    getConfiguredModels,
    setModel,
    isCompacting,
    mcpServers: mcpServerStatuses,
    connectMcpServer,
    disconnectMcpServer,
    backgroundTasks,
    tasks,
    getBackgroundTaskOutput,
    stopBackgroundTask,
    slashCommands,
    hasSlashCommand,
    permissionMode,
    setPermissionMode,
    isConfirmationVisible,
    hasPendingConfirmations: confirmationQueue.length > 0,
    confirmingTool,
    showConfirmation,
    hideConfirmation,
    handleConfirmationDecision,
    handleConfirmationCancel,
    backgroundCurrentTask,
    remountKey,
    requestRemount: requestRemount as () => void,
    handleRewindSelect,
    getFullMessageThread,

    getGatewayConfig,
    getModelConfig,
    workingDirectory,
    version,
    workdir,
    recreateAgent,
    triggerWorktreeRemoveHook,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
