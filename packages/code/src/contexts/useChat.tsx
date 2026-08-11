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
  SubagentConfiguration,
  PermissionDecision,
  PermissionMode,
  QueuedMessage,
  WorkflowRun,
  ToolBlockUpdateCallbackParams,
} from "wave-agent-sdk";
import {
  Agent,
  AgentCallbacks,
  type ToolPermissionContext,
  type WorktreeSession,
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
  // True while the /btw side-question overlay is on display
  isBtwActive: boolean;
  setIsBtwActive: (active: boolean) => void;
  queuedMessages: QueuedMessage[];
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => Promise<void>;
  askBtw: (
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
  ) => Promise<string>;
  clearMessages: () => Promise<void>;
  compact: (instructions?: string) => Promise<void>;
  addDir: (args?: string) => Promise<void>;
  abortMessage: () => void;
  recallQueuedMessage: () => QueuedMessage | null;
  removeQueuedMessageById: (id: string) => boolean;
  latestTotalTokens: number;
  maxInputTokens: number;
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
  // Workflow runs
  workflowRuns: WorkflowRun[];
  stopWorkflowRun: (runId: string) => void;
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
  // Agent definitions (for /agents overlay)
  agentDefinitions: SubagentConfiguration[];
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
    permissionMode?: PermissionMode;
    warning?: string;
  };
  showConfirmation: (
    toolName: string,
    toolInput?: Record<string, unknown>,
    suggestedPrefix?: string,
    hidePersistentOption?: boolean,
    planContent?: string,
    permissionMode?: PermissionMode,
    warning?: string,
  ) => Promise<PermissionDecision>;
  hideConfirmation: () => void;
  handleConfirmationDecision: (decision: PermissionDecision) => void;
  handleConfirmationCancel: () => void;
  // Background current task
  backgroundCurrentTask: () => void;
  // Remount functionality
  remountKey: number;
  forceRemount: () => void;
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

interface StreamingUpdateParams {
  messageId: string;
  chunk: string;
  stage: "streaming" | "end";
}

/**
 * Window-concat throttle for pure-delta streaming updates: chunks arriving
 * within the cooldown window are merged so no delta is lost (a dropped delta
 * would permanently lose content, unlike the accumulated-payload throttle it
 * replaces). Leading edge fires immediately; the trailing edge carries only
 * chunks that arrived within the window. `end` flushes any pending deltas
 * first, then forwards the end signal right away.
 */
function createStreamingWindowThrottle(
  fn: (params: StreamingUpdateParams) => void,
  wait: number,
): {
  (params: StreamingUpdateParams): void;
  cancel: () => void;
  flush: () => void;
} {
  let timer: NodeJS.Timeout | null = null;
  let pending: { messageId: string; chunk: string } | null = null;

  const fire = (stage: "streaming" | "end") => {
    if (pending) {
      fn({ ...pending, stage });
      pending = null;
    }
  };

  const throttled = (params: StreamingUpdateParams) => {
    if (params.stage === "end") {
      // Flush any deltas still pending inside the cooldown window first
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fire("streaming");
      fn(params);
      return;
    }
    if (pending) {
      pending.chunk += params.chunk;
    } else {
      pending = { messageId: params.messageId, chunk: params.chunk };
    }
    if (!timer) {
      // Leading edge: fire the current delta immediately, then reset pending so
      // the trailing edge only carries chunks arriving within this window
      fire("streaming");
      timer = setTimeout(() => {
        timer = null;
        fire("streaming");
      }, wait);
    }
  };

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fire("streaming");
  };

  return throttled;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  bypassPermissions,
  permissionMode: initialPermissionMode,
  pluginDirs,
  additionalDirectories,
  tools,
  allowedTools,
  disallowedTools,
  workdir,
  worktreeSession,
  originalCwd,
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
  const [isBtwActive, setIsBtwActive] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [latestTotalTokens, setLatestTotalTokens] = useState(0);
  const [maxInputTokens, setMaxInputTokens] = useState(200000);

  // Throttled incremental streaming updaters — 500ms window-concat, the same
  // interval as the pre-incremental throttledSetMessages. Chunks are pure
  // deltas: within-window chunks are merged so none is dropped, and
  // `stage === "end"` flushes pending deltas + applies the end signal
  // immediately so completion results are never delayed.
  const throttledContentUpdate = useMemo(
    () =>
      createStreamingWindowThrottle((params) => {
        const { messageId, chunk, stage } = params;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const textBlockIndex = m.blocks.findIndex((b) => b.type === "text");
            if (textBlockIndex === -1) {
              return {
                ...m,
                blocks: [...m.blocks, { type: "text", content: chunk, stage }],
              };
            }
            return {
              ...m,
              blocks: m.blocks.map((b, idx) =>
                idx === textBlockIndex && b.type === "text"
                  ? {
                      ...b,
                      content: (b.content || "") + chunk,
                      stage,
                    }
                  : b,
              ),
            };
          }),
        );
      }, 500),
    [],
  );

  const throttledReasoningUpdate = useMemo(
    () =>
      createStreamingWindowThrottle((params) => {
        const { messageId, chunk, stage } = params;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const reasoningBlockIndex = m.blocks.findIndex(
              (b) => b.type === "reasoning",
            );
            if (reasoningBlockIndex === -1) {
              return {
                ...m,
                blocks: [
                  ...m.blocks,
                  { type: "reasoning", content: chunk, stage },
                ],
              };
            }
            return {
              ...m,
              blocks: m.blocks.map((b, idx) =>
                idx === reasoningBlockIndex && b.type === "reasoning"
                  ? {
                      ...b,
                      content: (b.content || "") + chunk,
                      stage,
                    }
                  : b,
              ),
            };
          }),
        );
      }, 500),
    [],
  );

  const throttledToolBlockUpdate = useMemo(
    () =>
      throttle((params: ToolBlockUpdateCallbackParams) => {
        const { messageId, id: toolBlockId, ...updates } = params;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const toolBlockIndex = m.blocks.findIndex(
              (b) => b.type === "tool" && b.id === toolBlockId,
            );
            if (toolBlockIndex === -1) {
              return {
                ...m,
                blocks: [
                  ...m.blocks,
                  {
                    type: "tool",
                    id: toolBlockId,
                    name: updates.name || "",
                    stage: updates.stage || "start",
                    parameters: updates.parameters || "",
                    result: updates.result || "",
                    ...updates,
                  },
                ],
              };
            }
            return {
              ...m,
              blocks: m.blocks.map((b, idx) =>
                idx === toolBlockIndex && b.type === "tool"
                  ? { ...b, ...updates }
                  : b,
              ),
            };
          }),
        );
      }, 500),
    [],
  );

  useEffect(() => {
    isExpandedRef.current = isExpanded;
    if (isExpanded) {
      // Cancel pending throttled updates so the frozen expanded view isn't overwritten
      throttledContentUpdate.cancel();
      throttledReasoningUpdate.cancel();
      throttledToolBlockUpdate.cancel();
    }
  }, [
    isExpanded,
    throttledContentUpdate,
    throttledReasoningUpdate,
    throttledToolBlockUpdate,
  ]);

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
  // Workflow runs state
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);

  // Command state
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);

  // Agent definitions (for /agents overlay)
  const [agentDefinitions, setAgentDefinitions] = useState<
    SubagentConfiguration[]
  >([]);

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
        permissionMode?: PermissionMode;
        warning?: string;
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
      permissionMode?: PermissionMode;
      warning?: string;
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
    permissionMode?: PermissionMode;
    warning?: string;
    resolver: (decision: PermissionDecision) => void;
    reject: () => void;
  } | null>(null);

  // Remount state
  const [remountKey, setRemountKey] = useState(0);

  // Full terminal clear + remount so Ink's append-only <Static> re-renders.
  // Used on structural actions (/clear, /compact, rewind, ctrl-o, forceStatic
  // exit) where stale Static output must not linger on screen.
  const forceRemount = useCallback(() => {
    stdout?.write("\u001b[2J\u001b[3J\u001b[0;0H", () => {
      setRemountKey((prev) => prev + 1);
    });
  }, [stdout]);

  // Status metadata state
  const [workingDirectory, setWorkingDirectory] = useState("");

  const agentRef = useRef<Agent | null>(null);

  // Full-list refresh — one-shot pull from the agent, used only for structural
  // changes (compact/clear/rewind/collapse/init). Streaming updates flow through
  // the incremental callbacks in initializeAgent below.
  const refreshMessages = useCallback(() => {
    if (!isExpandedRef.current && agentRef.current) {
      const msgs = [...agentRef.current.messages];
      setMessages(msgs);
      setLatestTotalTokens(extractLatestTotalTokens(msgs));
    }
  }, []);

  // Permission confirmation methods with queue support
  const showConfirmation = useCallback(
    async (
      toolName: string,
      toolInput?: Record<string, unknown>,
      suggestedPrefix?: string,
      hidePersistentOption?: boolean,
      planContent?: string,
      permissionMode?: PermissionMode,
      warning?: string,
    ): Promise<PermissionDecision> => {
      return new Promise<PermissionDecision>((resolve, reject) => {
        const queueItem = {
          toolName,
          toolInput,
          suggestedPrefix,
          hidePersistentOption,
          planContent,
          permissionMode,
          warning,
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
        // ── Incremental message updates (no full-list pushes) ──────
        onUserMessageAdded: () => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msgs = agentRef.current.messages;
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "user") return;
          setMessages((prev) =>
            prev.some((m) => m.id === last.id) ? prev : [...prev, last],
          );
        },
        onAssistantMessageAdded: (messageId: string) => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msg = agentRef.current.messages.find((m) => m.id === messageId);
          if (!msg) return;
          setMessages((prev) =>
            prev.some((m) => m.id === messageId) ? prev : [...prev, msg],
          );
        },
        onAssistantContentUpdated: (params) => {
          if (isExpandedRef.current) return;
          throttledContentUpdate(params);
        },
        onAssistantReasoningUpdated: (params) => {
          if (isExpandedRef.current) return;
          throttledReasoningUpdate(params);
        },
        onToolBlockUpdated: (params) => {
          if (isExpandedRef.current) return;
          throttledToolBlockUpdate(params);
          if (params.stage === "end") throttledToolBlockUpdate.flush();
        },
        onErrorBlockAdded: (error: string) => {
          if (isExpandedRef.current) return;
          setMessages((prev) => {
            // Append to the last assistant message, or create one if none exists
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === "assistant") {
                return prev.map((m, idx) =>
                  idx === i
                    ? {
                        ...m,
                        blocks: [
                          ...m.blocks,
                          { type: "error", content: error },
                        ],
                      }
                    : m,
                );
              }
            }
            return [
              ...prev,
              {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                role: "assistant",
                timestamp: new Date().toISOString(),
                blocks: [{ type: "error", content: error }],
              },
            ];
          });
        },
        onAddBangMessage: (command, messageId) => {
          if (isExpandedRef.current) return;
          setMessages((prev) =>
            prev.some((m) => m.id === messageId)
              ? prev
              : [
                  ...prev,
                  {
                    id: messageId,
                    role: "user",
                    timestamp: new Date().toISOString(),
                    blocks: [
                      {
                        type: "bang",
                        command,
                        output: "",
                        stage: "running",
                        exitCode: null,
                      },
                    ],
                  },
                ],
          );
        },
        onUpdateBangMessage: (command, output, messageId) => {
          if (isExpandedRef.current) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    blocks: m.blocks.map((b, idx) =>
                      idx === m.blocks.length - 1 && b.type === "bang"
                        ? { ...b, command, output }
                        : b,
                    ),
                  }
                : m,
            ),
          );
        },
        onCompleteBangMessage: (command, exitCode, messageId, output) => {
          if (isExpandedRef.current) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    blocks: m.blocks.map((b, idx) =>
                      idx === m.blocks.length - 1 && b.type === "bang"
                        ? {
                            ...b,
                            command,
                            exitCode,
                            stage: "end",
                            ...(output !== undefined ? { output } : {}),
                          }
                        : b,
                    ),
                  }
                : m,
            ),
          );
        },
        onLatestTotalTokensChange: (tokens) => {
          setLatestTotalTokens(tokens);
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
        onBackgroundTasksChange: async (tasks) => {
          setBackgroundTasks([...tasks]);
          // Also refresh workflow runs since workflows are background tasks
          const runs = await agentRef.current?.getWorkflowRuns();
          if (runs) setWorkflowRuns([...runs]);
        },
        onTasksChange: (newTasks) => {
          setTasks((prev) => {
            if (
              prev.length === newTasks.length &&
              prev.every(
                (t, i) =>
                  t.id === newTasks[i].id && t.status === newTasks[i].status,
              )
            ) {
              return prev;
            }
            return [...newTasks];
          });
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
              context.permissionMode,
              context.warning,
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
          additionalDirectories,
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

        // Inject worktree session into this agent's own DI container so system
        // prompts and permission checks reflect the CLI -w worktree. This state is
        // per-session, not process-global (see docs/specs/multi-agent/worktree.md FR-042).
        if (worktreeSession) {
          const session: WorktreeSession = {
            originalCwd: originalCwd ?? worktreeSession.repoRoot,
            worktreePath: worktreeSession.path,
            worktreeBranch: worktreeSession.branch,
            worktreeName: worktreeSession.name,
            isNew: worktreeSession.isNew,
            repoRoot: worktreeSession.repoRoot,
          };
          agent.setWorktreeSession(session);
        }

        // Get initial state
        setSessionId(agent.sessionId);
        setMessages(agent.messages);
        setIsLoading(agent.isLoading);
        setLatestTotalTokens(extractLatestTotalTokens(agent.messages));
        setIsCommandRunning(agent.isCommandRunning);
        setIsCompacting(agent.isCompacting);
        setPermissionModeState(agent.getPermissionMode());
        setWorkingDirectory(agent.workingDirectory);
        setCurrentModelState(agent.getModelConfig().model || "");
        setConfiguredModels(agent.getConfiguredModels());
        setMaxInputTokens(agent.getMaxInputTokens());

        // Get initial MCP servers state
        const initialMcpServers = agent.getMcpServers?.() || [];
        setMcpServerStatuses(initialMcpServers);

        // Get initial commands
        const agentSlashCommands = agent.getSlashCommands?.() || [];
        setSlashCommands(agentSlashCommands);

        // Get initial agent definitions
        const initialAgentDefinitions =
          agent.getSubagentConfigurations?.() || [];
        setAgentDefinitions(initialAgentDefinitions);
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
      additionalDirectories,
      tools,
      allowedTools,
      disallowedTools,
      workdir,
      worktreeSession,
      originalCwd,
      model,
      initialPermissionMode,
      throttledContentUpdate,
      throttledReasoningUpdate,
      throttledToolBlockUpdate,
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
    setAgentDefinitions([]);
    setSessionId("");
    setIsLoading(false);
    setLatestTotalTokens(0);
    setMaxInputTokens(200000);
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
      throttledContentUpdate.cancel();
      throttledReasoningUpdate.cancel();
      throttledToolBlockUpdate.cancel();
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
  }, [
    throttledContentUpdate,
    throttledReasoningUpdate,
    throttledToolBlockUpdate,
  ]);

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

  const askBtw = useCallback(
    async (
      question: string,
      abortSignal?: AbortSignal,
      onContent?: (content: string) => void,
    ) => {
      if (!agentRef.current) {
        throw new Error("Agent not initialized");
      }
      return await agentRef.current.askBtw(question, abortSignal, onContent);
    },
    [],
  );

  const clearMessages = useCallback(async () => {
    await agentRef.current?.clearMessages();
    refreshMessages();
    forceRemount();
  }, [refreshMessages, forceRemount]);

  const compact = useCallback(
    async (instructions?: string) => {
      await agentRef.current?.compact(instructions);
      refreshMessages();
      forceRemount();
    },
    [refreshMessages, forceRemount],
  );

  // /add-dir: add a directory to the session Safe Zone (session-level, with
  // optional --remember persistence). Bare command shows usage + current list.
  const addDir = useCallback(async (args?: string) => {
    const agent = agentRef.current;
    if (!agent) return;

    // Show the result as a UI-only assistant text message (same display path
    // as error blocks; not persisted to session history).
    const showResult = (content: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          role: "assistant",
          timestamp: new Date().toISOString(),
          blocks: [{ type: "text", content, stage: "end" }],
        },
      ]);
    };

    const rawArgs = (args ?? "").trim();
    if (!rawArgs) {
      const dirs = agent.getAdditionalDirectories();
      const list =
        dirs.length > 0
          ? dirs.map((dir) => `  - ${dir}`).join("\n")
          : "  (none)";
      showResult(
        `Usage: /add-dir <path> [--remember]\n\nAdditional working directories:\n${list}`,
      );
      return;
    }

    const remember = rawArgs.includes("--remember");
    const dir = rawArgs.replace("--remember", "").trim();
    if (!dir) {
      showResult("Usage: /add-dir <path> [--remember]");
      return;
    }

    await agent.addAdditionalDirectory(dir, { remember });
    showResult(
      `Added ${dir} to the session Safe Zone${remember ? " (remembered)" : ""}.`,
    );
  }, []);

  // Unified interrupt method, interrupt both AI messages and command execution
  const abortMessage = useCallback(() => {
    agentRef.current?.abortMessage();
  }, []);

  const recallQueuedMessage = useCallback((): QueuedMessage | null => {
    return agentRef.current?.recallQueuedMessage() ?? null;
  }, []);

  const removeQueuedMessageById = useCallback((id: string): boolean => {
    return agentRef.current?.removeQueuedMessageById(id) ?? false;
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

  const stopWorkflowRun = useCallback((runId: string) => {
    agentRef.current?.stopWorkflowRun(runId);
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
        permissionMode: next.permissionMode,
        warning: next.warning,
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
          refreshMessages();
          forceRemount();
        } catch (error) {
          logger.error("Failed to rewind:", error);
        }
      }
    },
    [forceRemount, refreshMessages],
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
      // Use ref to get the current value to avoid stale closure
      const nextExpanded = !isExpandedRef.current;
      setIsExpanded(nextExpanded);
      isExpandedRef.current = nextExpanded;

      if (nextExpanded) {
        // Transitioning to EXPANDED: Freeze the current view
        // Incremental updates are skipped while expanded (isExpandedRef guard)
      } else {
        // Transitioning to COLLAPSED: Restore from agent's actual state
        refreshMessages();
      }
      // Force remount to ensure Static items re-render
      forceRemount();
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
    isBtwActive,
    setIsBtwActive,
    queuedMessages,
    sessionId,
    sendMessage,
    askBtw,
    clearMessages,
    compact,
    addDir,
    abortMessage,
    recallQueuedMessage,
    removeQueuedMessageById,
    latestTotalTokens,
    maxInputTokens,
    currentModel,
    configuredModels,
    getConfiguredModels,
    setModel,
    isCompacting,
    mcpServers: mcpServerStatuses,
    connectMcpServer,
    disconnectMcpServer,
    backgroundTasks,
    workflowRuns,
    stopWorkflowRun,
    tasks,
    getBackgroundTaskOutput,
    stopBackgroundTask,
    slashCommands,
    hasSlashCommand,
    agentDefinitions,
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
    forceRemount,
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
