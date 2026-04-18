import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
  useMemo,
  useReducer,
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
  isCompressing: boolean;
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
  allowBypassInCycle: boolean;
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

// --- Reducer Types & Functions ---

// 1. Agent Reducer
interface AgentState {
  messages: Message[];
  isLoading: boolean;
  isCommandRunning: boolean;
  isCompressing: boolean;
  latestTotalTokens: number;
}

type AgentAction =
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_COMMAND_RUNNING"; isCommandRunning: boolean }
  | { type: "SET_COMPRESSING"; isCompressing: boolean }
  | { type: "SET_TOKENS"; latestTotalTokens: number }
  | {
      type: "SET_AGENT_STATE";
      messages: Message[];
      isLoading: boolean;
      isCommandRunning: boolean;
      isCompressing: boolean;
      latestTotalTokens: number;
    };

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_MESSAGES":
      return { ...state, messages: action.messages };
    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };
    case "SET_COMMAND_RUNNING":
      return { ...state, isCommandRunning: action.isCommandRunning };
    case "SET_COMPRESSING":
      return { ...state, isCompressing: action.isCompressing };
    case "SET_TOKENS":
      return { ...state, latestTotalTokens: action.latestTotalTokens };
    case "SET_AGENT_STATE":
      return {
        messages: action.messages,
        isLoading: action.isLoading,
        isCommandRunning: action.isCommandRunning,
        isCompressing: action.isCompressing,
        latestTotalTokens: action.latestTotalTokens,
      };
    default:
      return state;
  }
}

// 2. Session Reducer
interface SessionState {
  sessionId: string;
  workingDirectory: string;
  currentModel: string;
  configuredModels: string[];
}

type SessionAction =
  | { type: "SET_SESSION_ID"; sessionId: string }
  | { type: "SET_WORKING_DIRECTORY"; workingDirectory: string }
  | { type: "SET_CURRENT_MODEL"; currentModel: string }
  | { type: "SET_CONFIGURED_MODELS"; configuredModels: string[] }
  | {
      type: "SET_SESSION_STATE";
      sessionId: string;
      workingDirectory: string;
      currentModel: string;
      configuredModels: string[];
    };

function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.sessionId };
    case "SET_WORKING_DIRECTORY":
      return { ...state, workingDirectory: action.workingDirectory };
    case "SET_CURRENT_MODEL":
      return { ...state, currentModel: action.currentModel };
    case "SET_CONFIGURED_MODELS":
      return { ...state, configuredModels: action.configuredModels };
    case "SET_SESSION_STATE":
      return {
        sessionId: action.sessionId,
        workingDirectory: action.workingDirectory,
        currentModel: action.currentModel,
        configuredModels: action.configuredModels,
      };
    default:
      return state;
  }
}

// 3. Confirmation Reducer
interface ConfirmationItem {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  planContent?: string;
  resolver: (decision: PermissionDecision) => void;
  reject: () => void;
}

interface ConfirmationState {
  isConfirmationVisible: boolean;
  confirmingTool:
    | {
        name: string;
        input?: Record<string, unknown>;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
        planContent?: string;
      }
    | undefined;
  confirmationQueue: ConfirmationItem[];
  currentConfirmation: ConfirmationItem | null;
}

type ConfirmationAction =
  | { type: "SHOW_CONFIRMATION"; item: ConfirmationItem }
  | { type: "PROCESS_NEXT" }
  | { type: "HIDE_CONFIRMATION" }
  | { type: "CANCEL_CONFIRMATION" }
  | { type: "SET_CONFIRMATION_DECISION"; decision: PermissionDecision };

function confirmationReducer(
  state: ConfirmationState,
  action: ConfirmationAction,
): ConfirmationState {
  switch (action.type) {
    case "SHOW_CONFIRMATION": {
      const newQueue = [...state.confirmationQueue, action.item];
      // If nothing is currently visible, show this one immediately
      if (!state.isConfirmationVisible) {
        const item = action.item;
        return {
          ...state,
          confirmationQueue: newQueue.slice(1),
          currentConfirmation: item,
          confirmingTool: {
            name: item.toolName,
            input: item.toolInput,
            suggestedPrefix: item.suggestedPrefix,
            hidePersistentOption: item.hidePersistentOption,
            planContent: item.planContent,
          },
          isConfirmationVisible: true,
        };
      }
      return { ...state, confirmationQueue: newQueue };
    }
    case "PROCESS_NEXT": {
      if (state.confirmationQueue.length > 0 && !state.isConfirmationVisible) {
        const next = state.confirmationQueue[0];
        return {
          ...state,
          confirmationQueue: state.confirmationQueue.slice(1),
          currentConfirmation: next,
          confirmingTool: {
            name: next.toolName,
            input: next.toolInput,
            suggestedPrefix: next.suggestedPrefix,
            hidePersistentOption: next.hidePersistentOption,
            planContent: next.planContent,
          },
          isConfirmationVisible: true,
        };
      }
      return state;
    }
    case "HIDE_CONFIRMATION":
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    case "SET_CONFIRMATION_DECISION": {
      if (state.currentConfirmation) {
        state.currentConfirmation.resolver(action.decision);
      }
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    }
    case "CANCEL_CONFIRMATION": {
      if (state.currentConfirmation) {
        state.currentConfirmation.reject();
      }
      return {
        ...state,
        isConfirmationVisible: false,
        confirmingTool: undefined,
        currentConfirmation: null,
      };
    }
    default:
      return state;
  }
}

// 4. UI Reducer
interface UIState {
  isExpanded: boolean;
  isTaskListVisible: boolean;
}

type UIAction =
  | { type: "TOGGLE_EXPANDED" }
  | { type: "SET_EXPANDED"; isExpanded: boolean }
  | { type: "TOGGLE_TASK_LIST" }
  | { type: "SET_TASK_LIST_VISIBLE"; isTaskListVisible: boolean };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "TOGGLE_EXPANDED":
      return { ...state, isExpanded: !state.isExpanded };
    case "SET_EXPANDED":
      return { ...state, isExpanded: action.isExpanded };
    case "TOGGLE_TASK_LIST":
      return { ...state, isTaskListVisible: !state.isTaskListVisible };
    case "SET_TASK_LIST_VISIBLE":
      return { ...state, isTaskListVisible: action.isTaskListVisible };
    default:
      return state;
  }
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
}) => {
  const { restoreSessionId, continueLastSession } = useAppConfig();
  const { stdout } = useStdout();

  // --- Reducer-based State ---

  const [agentState, agentDispatch] = useReducer(agentReducer, {
    messages: [],
    isLoading: false,
    isCommandRunning: false,
    isCompressing: false,
    latestTotalTokens: 0,
  });

  const [sessionState, sessionDispatch] = useReducer(sessionReducer, {
    sessionId: "",
    workingDirectory: "",
    currentModel: "",
    configuredModels: [],
  });

  const [confirmationState, confirmationDispatch] = useReducer(
    confirmationReducer,
    {
      isConfirmationVisible: false,
      confirmingTool: undefined,
      confirmationQueue: [],
      currentConfirmation: null,
    },
  );

  const [uiState, uiDispatch] = useReducer(uiReducer, {
    isExpanded: false,
    isTaskListVisible: true,
  });

  // --- Standalone useState (per plan) ---

  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    initialPermissionMode ||
      (bypassPermissions ? "bypassPermissions" : "default"),
  );

  const [remountKey, setRemountKey] = useState(0);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const prevSessionId = useRef<string | null>(null);

  const agentRef = useRef<Agent | null>(null);

  // --- Refs for reducer dispatch in throttles ---

  const agentDispatchRef = useRef(agentDispatch);
  useEffect(() => {
    agentDispatchRef.current = agentDispatch;
  }, [agentDispatch]);

  const isExpandedRef = useRef(uiState.isExpanded);

  // --- Throttled callbacks ---

  const throttledSetMessages = useMemo(
    () =>
      throttle(
        () => {
          if (!isExpandedRef.current && agentRef.current) {
            agentDispatchRef.current({
              type: "SET_MESSAGES",
              messages: [...agentRef.current.messages],
            });
          }
        },
        300,
        { leading: true, trailing: true },
      ),
    [],
  );

  const throttledSetTokens = useMemo(
    () =>
      throttle(
        ((tokens: number) => {
          agentDispatchRef.current({
            type: "SET_TOKENS",
            latestTotalTokens: tokens,
          });
        }) as (...args: unknown[]) => void,
        300,
        { leading: true, trailing: true },
      ),
    [],
  );

  useEffect(() => {
    isExpandedRef.current = uiState.isExpanded;
    if (uiState.isExpanded) {
      throttledSetMessages.cancel();
      throttledSetTokens.cancel();
    }
  }, [uiState.isExpanded, throttledSetMessages, throttledSetTokens]);

  useEffect(() => {
    return () => {
      throttledSetMessages.cancel();
      throttledSetTokens.cancel();
    };
  }, [throttledSetMessages, throttledSetTokens]);

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
      sessionState.sessionId &&
      prevSessionId.current !== sessionState.sessionId
    ) {
      requestRemount();
    }
    if (sessionState.sessionId) {
      prevSessionId.current = sessionState.sessionId;
    }
  }, [sessionState.sessionId, requestRemount]);

  const allowBypassInCycle =
    !!bypassPermissions || initialPermissionMode === "bypassPermissions";

  // --- Permission confirmation methods with queue support ---

  const showConfirmation = useCallback(
    async (
      toolName: string,
      toolInput?: Record<string, unknown>,
      suggestedPrefix?: string,
      hidePersistentOption?: boolean,
      planContent?: string,
    ): Promise<PermissionDecision> => {
      return new Promise<PermissionDecision>((resolve, reject) => {
        const queueItem: ConfirmationItem = {
          toolName,
          toolInput,
          suggestedPrefix,
          hidePersistentOption,
          planContent,
          resolver: resolve,
          reject,
        };

        confirmationDispatch({ type: "SHOW_CONFIRMATION", item: queueItem });
      });
    },
    [],
  );

  // Initialize AI manager
  useEffect(() => {
    const initializeAgent = async () => {
      const callbacks: AgentCallbacks = {
        onMessagesChange: () => {
          throttledSetMessages();
        },
        onServersChange: (servers) => {
          setMcpServers([...servers]);
        },
        onSessionIdChange: (sessionId) => {
          sessionDispatch({ type: "SET_SESSION_ID", sessionId });
        },
        onLatestTotalTokensChange: (tokens) => {
          throttledSetTokens(tokens);
        },
        onCompressionStateChange: (isCompressingState) => {
          agentDispatch({
            type: "SET_COMPRESSING",
            isCompressing: isCompressingState,
          });
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
        onModelChange: (currentModel) => {
          sessionDispatch({ type: "SET_CURRENT_MODEL", currentModel });
        },
        onConfiguredModelsChange: (configuredModels) => {
          sessionDispatch({ type: "SET_CONFIGURED_MODELS", configuredModels });
        },
        onLoadingChange: (isLoading) => {
          agentDispatch({ type: "SET_LOADING", isLoading });
        },
        onCommandRunningChange: (isCommandRunning) => {
          agentDispatch({ type: "SET_COMMAND_RUNNING", isCommandRunning });
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
          restoreSessionId,
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
        });

        agentRef.current = agent;

        // Get initial state (individual dispatches to match original setState behavior)
        sessionDispatch({ type: "SET_SESSION_ID", sessionId: agent.sessionId });
        agentDispatch({ type: "SET_MESSAGES", messages: agent.messages });
        agentDispatch({ type: "SET_LOADING", isLoading: agent.isLoading });
        agentDispatch({
          type: "SET_TOKENS",
          latestTotalTokens: agent.latestTotalTokens,
        });
        agentDispatch({
          type: "SET_COMMAND_RUNNING",
          isCommandRunning: agent.isCommandRunning,
        });
        agentDispatch({
          type: "SET_COMPRESSING",
          isCompressing: agent.isCompressing,
        });
        setPermissionModeState(agent.getPermissionMode());
        sessionDispatch({
          type: "SET_WORKING_DIRECTORY",
          workingDirectory: agent.workingDirectory,
        });
        sessionDispatch({
          type: "SET_CURRENT_MODEL",
          currentModel: agent.getModelConfig().model,
        });
        sessionDispatch({
          type: "SET_CONFIGURED_MODELS",
          configuredModels: agent.getConfiguredModels(),
        });

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
    tools,
    allowedTools,
    disallowedTools,
    workdir,
    worktreeSession,
    model,
    initialPermissionMode,
    throttledSetMessages,
    throttledSetTokens,
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

  // Process queue when confirmation is hidden
  useEffect(() => {
    if (!confirmationState.isConfirmationVisible) {
      confirmationDispatch({ type: "PROCESS_NEXT" });
    }
  }, [
    confirmationState.isConfirmationVisible,
    confirmationState.confirmationQueue,
  ]);

  const hideConfirmation = useCallback(() => {
    confirmationDispatch({ type: "HIDE_CONFIRMATION" });
  }, []);

  const handleConfirmationDecision = useCallback(
    (decision: PermissionDecision) => {
      confirmationDispatch({ type: "SET_CONFIRMATION_DECISION", decision });
    },
    [],
  );

  const handleConfirmationCancel = useCallback(() => {
    confirmationDispatch({ type: "CANCEL_CONFIRMATION" });
  }, []);

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
      sessionDispatch({ type: "SET_CURRENT_MODEL", currentModel: model });
    }
  }, []);

  // Listen for Ctrl+O hotkey to toggle collapse/expand state and ESC to cancel confirmation
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      // Clear terminal screen when expanded state changes
      const nextExpanded = !isExpandedRef.current;
      uiDispatch({ type: "SET_EXPANDED", isExpanded: nextExpanded });
      isExpandedRef.current = nextExpanded;

      if (nextExpanded) {
        // Transitioning to EXPANDED: Freeze the current view
        // Cancel any pending throttled updates to avoid overwriting the frozen state
        throttledSetMessages.cancel();
      } else {
        // Transitioning to COLLAPSED: Restore from agent's actual state
        if (agentRef.current) {
          agentDispatch({
            type: "SET_MESSAGES",
            messages: [...agentRef.current.messages],
          });
        }
      }
      // Force remount to re-render Static items with new isExpanded state
      requestRemount();
    }

    if (key.ctrl && input === "t") {
      uiDispatch({ type: "TOGGLE_TASK_LIST" });
    }

    // Handle ESC key to cancel confirmation
    if (key.escape) {
      if (confirmationState.isConfirmationVisible) {
        handleConfirmationCancel();
      }
    }
  });

  const contextValue: ChatContextType = {
    messages: agentState.messages,
    isLoading: agentState.isLoading,
    isCommandRunning: agentState.isCommandRunning,
    isExpanded: uiState.isExpanded,
    isTaskListVisible: uiState.isTaskListVisible,
    setIsTaskListVisible: useCallback(
      (visible: boolean) =>
        uiDispatch({
          type: "SET_TASK_LIST_VISIBLE",
          isTaskListVisible: visible,
        }),
      [],
    ),
    queuedMessages,
    sessionId: sessionState.sessionId,
    sendMessage,
    askBtw,
    abortMessage,
    latestTotalTokens: agentState.latestTotalTokens,
    currentModel: sessionState.currentModel,
    configuredModels: sessionState.configuredModels,
    getConfiguredModels,
    setModel,
    isCompressing: agentState.isCompressing,
    mcpServers,
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
    allowBypassInCycle,
    isConfirmationVisible: confirmationState.isConfirmationVisible,
    hasPendingConfirmations: confirmationState.confirmationQueue.length > 0,
    confirmingTool: confirmationState.confirmingTool,
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
    workingDirectory: sessionState.workingDirectory,
    version,
    workdir,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
