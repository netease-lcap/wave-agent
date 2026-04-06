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
} from "wave-agent-sdk";
import {
  Agent,
  AgentCallbacks,
  type ToolPermissionContext,
  OPERATION_CANCELLED_BY_USER,
  cloneMessage,
  searchFiles,
} from "wave-agent-sdk";
import { logger } from "../utils/logger.js";
import { throttle } from "../utils/throttle.js";
import { displayUsageSummary } from "../utils/usageSummary.js";
import { expandLongTextPlaceholders } from "../reducers/inputHandlers.js";
import {
  inputReducer,
  initialState as initialInputState,
  InputState,
  InputAction,
} from "../reducers/inputReducer.js";
import {
  confirmReducer,
  initialConfirmState,
} from "../reducers/confirmReducer.js";

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
  queuedMessages: Array<{
    content: string;
    images?: Array<{ path: string; mimeType: string }>;
    longTextMap?: Record<string, string>;
  }>;
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
  inputState: InputState;
  inputDispatch: React.Dispatch<InputAction>;
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
}) => {
  const { restoreSessionId, continueLastSession } = useAppConfig();
  const { stdout } = useStdout();

  // Message Display State
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(isExpanded);

  const [isTaskListVisible, setIsTaskListVisible] = useState(true);

  const [queuedMessages, setQueuedMessages] = useState<
    Array<{
      content: string;
      images?: Array<{ path: string; mimeType: string }>;
      longTextMap?: Record<string, string>;
    }>
  >([]);

  const [messages, setMessages] = useState<Message[]>([]);

  const throttledSetMessages = useMemo(
    () =>
      throttle(() => {
        if (!isExpandedRef.current && agentRef.current) {
          setMessages([...agentRef.current.messages]);
        }
      }, 300),
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
  const [latestTotalTokens, setlatestTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [currentModel, setCurrentModelState] = useState("");
  const [configuredModels, setConfiguredModels] = useState<string[]>([]);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);

  // Background tasks state
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);

  // Command state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // Input state reducer
  const [inputState, inputDispatch] = useReducer(inputReducer, {
    ...initialInputState,
    permissionMode:
      initialPermissionMode ||
      (bypassPermissions ? "bypassPermissions" : "default"),
  });

  // Handle selectorJustUsed reset
  useEffect(() => {
    if (inputState.selectorJustUsed) {
      const timer = setTimeout(() => {
        inputDispatch({ type: "SET_SELECTOR_JUST_USED", payload: false });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [inputState.selectorJustUsed]);

  // Handle debounced file search
  useEffect(() => {
    if (inputState.showFileSelector) {
      const debounceDelay =
        inputState.fileSearchQuery === ""
          ? 0
          : parseInt(process.env.FILE_SELECTOR_DEBOUNCE_MS || "300", 10);
      const timer = setTimeout(async () => {
        try {
          const fileItems = await searchFiles(inputState.fileSearchQuery);
          inputDispatch({ type: "SET_FILTERED_FILES", payload: fileItems });
        } catch (error) {
          console.error("File search error:", error);
          inputDispatch({ type: "SET_FILTERED_FILES", payload: [] });
        }
      }, debounceDelay);
      return () => clearTimeout(timer);
    }
  }, [inputState.showFileSelector, inputState.fileSearchQuery]);

  // Handle paste debouncing
  useEffect(() => {
    if (inputState.isPasting) {
      const pasteDebounceDelay = parseInt(
        process.env.PASTE_DEBOUNCE_MS || "30",
        10,
      );
      const timer = setTimeout(() => {
        const processedInput = inputState.pasteBuffer.replace(/\r/g, "\n");
        inputDispatch({
          type: "INSERT_TEXT_WITH_PLACEHOLDER",
          payload: processedInput,
        });
        inputDispatch({ type: "END_PASTE" });
        inputDispatch({ type: "RESET_HISTORY_NAVIGATION" });
      }, pasteDebounceDelay);
      return () => clearTimeout(timer);
    }
  }, [inputState.isPasting, inputState.pasteBuffer]);

  // Handle /btw side question
  useEffect(() => {
    if (
      inputState.btwState.isActive &&
      inputState.btwState.isLoading &&
      inputState.btwState.question
    ) {
      const askBtwInternal = async () => {
        try {
          const agent = agentRef.current;
          if (!agent) return;
          const answer = await agent.askBtw(inputState.btwState.question);
          inputDispatch({
            type: "SET_BTW_STATE",
            payload: { answer, isLoading: false },
          });
        } catch (error) {
          console.error("Failed to ask side question:", error);
          inputDispatch({
            type: "SET_BTW_STATE",
            payload: {
              answer: "Error: Failed to get an answer for your side question.",
              isLoading: false,
            },
          });
        }
      };
      askBtwInternal();
    }
  }, [
    inputState.btwState.isActive,
    inputState.btwState.isLoading,
    inputState.btwState.question,
  ]);

  // Confirmation state reducer
  const [confirmState, confirmDispatch] = useReducer(
    confirmReducer,
    initialConfirmState,
  );

  // Remount state
  const [remountKey, setRemountKey] = useState(0);
  const prevSessionId = useRef<string | null>(null);

  const requestRemount = useCallback(() => {
    stdout?.write("\u001b[2J\u001b[3J\u001b[0;0H", () => {
      setRemountKey((prev) => prev + 1);
    });
  }, [stdout]);

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

  // Store initial permission mode for agent initialization (only used once on mount)
  const initialPermissionModeRef = useRef(
    initialPermissionMode ||
      (bypassPermissions ? "bypassPermissions" : "default"),
  );

  const allowBypassInCycle =
    !!bypassPermissions || inputState.permissionMode === "bypassPermissions";

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
        confirmDispatch({
          type: "QUEUE",
          item: {
            toolName,
            toolInput,
            suggestedPrefix,
            hidePersistentOption,
            planContent,
            resolver: resolve,
            reject,
          },
        });
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
          setSessionId(sessionId);
        },
        onLatestTotalTokensChange: (tokens) => {
          setlatestTotalTokens(tokens);
        },
        onCompressionStateChange: (isCompressingState) => {
          setIsCompressing(isCompressingState);
        },
        onBackgroundTasksChange: (tasks) => {
          setBackgroundTasks([...tasks]);
        },
        onTasksChange: (tasks) => {
          setTasks([...tasks]);
        },
        onPermissionModeChange: (mode) => {
          inputDispatch({ type: "SET_PERMISSION_MODE", payload: mode });
        },
        onModelChange: (model) => {
          setCurrentModelState(model);
        },
        onConfiguredModelsChange: (models) => {
          setConfiguredModels(models);
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
            initialPermissionModeRef.current === "default"
              ? undefined
              : initialPermissionModeRef.current,
          canUseTool: permissionCallback,
          stream: false, // 关闭流式模式
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

        // Get initial state
        setSessionId(agent.sessionId);
        setMessages(agent.messages);
        setIsLoading(agent.isLoading);
        setlatestTotalTokens(agent.latestTotalTokens);
        setIsCommandRunning(agent.isCommandRunning);
        setIsCompressing(agent.isCompressing);
        inputDispatch({
          type: "SET_PERMISSION_MODE",
          payload: agent.getPermissionMode(),
        });
        setWorkingDirectory(agent.workingDirectory);
        setCurrentModelState(agent.getModelConfig().model);
        setConfiguredModels(agent.getConfiguredModels());

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

      if (isLoading || isCommandRunning) {
        setQueuedMessages((prev) => [
          ...prev,
          { content, images, longTextMap },
        ]);
        return;
      }

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
            setIsCommandRunning(true);
            try {
              await agentRef.current?.bang(command);
            } finally {
              setIsCommandRunning(false);
            }
            return;
          }
        }

        // Set loading state
        setIsLoading(true);

        try {
          await agentRef.current?.sendMessage(expandedContent, images);
        } finally {
          // Clear loading state
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        // Loading state will be automatically updated by the useEffect that watches messages
      }
    },
    [isLoading, isCommandRunning],
  );

  const askBtw = useCallback(async (question: string) => {
    if (!agentRef.current) {
      throw new Error("Agent not initialized");
    }
    return await agentRef.current.askBtw(question);
  }, []);

  // Process queued messages when idle
  useEffect(() => {
    if (!isLoading && !isCommandRunning && queuedMessages.length > 0) {
      const nextMessage = queuedMessages[0];
      setQueuedMessages((prev) => prev.slice(1));
      sendMessage(
        nextMessage.content,
        nextMessage.images,
        nextMessage.longTextMap,
      );
    }
  }, [isLoading, isCommandRunning, queuedMessages, sendMessage]);

  // Unified interrupt method, interrupt both AI messages and command execution
  const abortMessage = useCallback(() => {
    setQueuedMessages([]);
    agentRef.current?.abortMessage();
  }, []);

  // Permission management methods
  const setPermissionMode = useCallback((mode: PermissionMode) => {
    inputDispatch({ type: "SET_PERMISSION_MODE", payload: mode });
    if (agentRef.current && agentRef.current.getPermissionMode() !== mode) {
      agentRef.current.setPermissionMode(mode);
    }
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

  // Process queue when queue changes or confirmation is hidden
  useEffect(() => {
    if (confirmState.queue.length > 0 && !confirmState.isVisible) {
      confirmDispatch({ type: "PROCESS_NEXT" });
    }
  }, [confirmState.queue.length, confirmState.isVisible]);

  const hideConfirmation = useCallback(() => {
    confirmDispatch({ type: "HIDE" });
  }, []);

  const handleConfirmationDecision = useCallback(
    (decision: PermissionDecision) => {
      if (confirmState.current) {
        confirmState.current.resolver(decision);
      }
      confirmDispatch({ type: "HIDE" });
    },
    [confirmState],
  );

  const handleConfirmationCancel = useCallback(() => {
    if (confirmState.current) {
      confirmState.current.reject();
    }
    confirmDispatch({ type: "CANCEL" });
  }, [confirmState]);

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
      setIsExpanded((prev) => {
        const newExpanded = !prev;
        isExpandedRef.current = newExpanded;
        if (newExpanded) {
          // Transitioning to EXPANDED: Freeze the current view
          // Cancel any pending throttled updates to avoid overwriting the frozen state
          throttledSetMessages.cancel();
          // Deep copy the last message to ensure it doesn't update if the agent is still writing to it
          setMessages((currentMessages) => {
            if (currentMessages.length === 0) return currentMessages;
            const lastMessage = currentMessages[currentMessages.length - 1];
            const frozenLastMessage = cloneMessage(lastMessage);
            return [...currentMessages.slice(0, -1), frozenLastMessage];
          });
        } else {
          // Transitioning to COLLAPSED: Restore from agent's actual state
          if (agentRef.current) {
            setMessages([...agentRef.current.messages]);
          }
        }
        return newExpanded;
      });
    }

    if (key.ctrl && input === "t") {
      setIsTaskListVisible((prev) => !prev);
    }

    // Handle ESC key to cancel confirmation or dismiss BTW
    if (key.escape) {
      if (confirmState.isVisible) {
        handleConfirmationCancel();
      } else if (inputState.btwState.isActive) {
        inputDispatch({
          type: "SET_BTW_STATE",
          payload: {
            isActive: false,
            question: "",
            answer: undefined,
            isLoading: false,
          },
        });
      }
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
    isCompressing,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    backgroundTasks,
    tasks,
    getBackgroundTaskOutput,
    stopBackgroundTask,
    slashCommands,
    hasSlashCommand,
    permissionMode: inputState.permissionMode,
    setPermissionMode,
    allowBypassInCycle,
    isConfirmationVisible: confirmState.isVisible,
    hasPendingConfirmations: confirmState.queue.length > 0,
    confirmingTool: confirmState.tool,
    showConfirmation,
    hideConfirmation,
    handleConfirmationDecision,
    handleConfirmationCancel,
    backgroundCurrentTask,
    remountKey,
    requestRemount,
    handleRewindSelect,
    getFullMessageThread,

    getGatewayConfig,
    getModelConfig,
    workingDirectory,
    version,
    workdir,
    inputState,
    inputDispatch,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
