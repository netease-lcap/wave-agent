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
  SkillMetadata,
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
import { displayUsageSummary } from "../utils/usageSummary.js";
import { expandLongTextPlaceholders } from "../managers/inputHandlers.js";

import { BaseAppProps } from "../types.js";

// Main Chat Context
export interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  isCommandRunning: boolean;
  isCompacting: boolean;
  /** Accumulated streaming text from the compaction fork, shown as the
   * last-30-chars tail on the CLI compacting loading indicator. */
  compactionStream: string;
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
  // Skill metadata (for /skills overlay)
  skills: SkillMetadata[];
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
 * Snapshot a SDK message for consumer state. The SDK mutates its internal
 * message blocks in-place BEFORE firing the delta callback (it writes the full
 * accumulated value to the shared block, then computes the chunk delta by
 * slicing the new value). A consumer that pushed the SDK message object by
 * live reference would read the already-updated block and append the delta
 * again — the first delta is double-counted ("LetLet me think..."), affecting
 * reasoning and text content alike. See docs/specs/core/stream-content-updates.md.
 * The clone must be at least one layer deep (message + blocks) so the in-place
 * block mutation never leaks into consumer state.
 *
 * IMPORTANT: the caller must invoke this EAGERLY at callback time and capture
 * the result before scheduling any state update. React batches setState calls
 * that happen in the same synchronous tick and runs the updater functions only
 * at flush time — after the SDK has already written the first chunk into the
 * shared message. A snapshot evaluated inside the updater (lazily) would copy
 * the post-mutation blocks, and the first delta append would then double-count
 * the first word ("HelloHello") whenever `onAssistantMessageAdded` and the
 * first delta callback land in the same batch.
 */
const snapshotMessage = (message: Message): Message => ({
  ...message,
  blocks: message.blocks.map((block) => ({ ...block })),
});

/**
 * Pure updater: appends a text-content delta to the target message's text
 * block (creating it on first delta), applying the stage signal.
 */
const applyContentDelta = (
  prev: Message[],
  params: StreamingUpdateParams,
): Message[] => {
  const { messageId, chunk, stage } = params;
  return prev.map((m) => {
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
  });
};

/**
 * Pure updater: appends a reasoning delta to the target message's reasoning
 * block (creating it on first delta), applying the stage signal.
 */
const applyReasoningDelta = (
  prev: Message[],
  params: StreamingUpdateParams,
): Message[] => {
  const { messageId, chunk, stage } = params;
  return prev.map((m) => {
    if (m.id !== messageId) return m;
    const reasoningBlockIndex = m.blocks.findIndex(
      (b) => b.type === "reasoning",
    );
    if (reasoningBlockIndex === -1) {
      return {
        ...m,
        blocks: [...m.blocks, { type: "reasoning", content: chunk, stage }],
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
  });
};

/**
 * Pure updater: applies a tool block update. Streaming carries only the
 * `parametersChunk` delta, appended to the accumulated parameters;
 * start/running/end carry the authoritative value and replace wholesale.
 */
const applyToolBlockUpdate = (
  prev: Message[],
  params: ToolBlockUpdateCallbackParams,
): Message[] => {
  const { messageId, id: toolBlockId, parametersChunk, ...updates } = params;
  return prev.map((m) => {
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
            parameters: (updates.parameters || "") + (parametersChunk || ""),
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
          ? {
              ...b,
              ...updates,
              parameters: parametersChunk
                ? (b.parameters || "") + parametersChunk
                : updates.parameters !== undefined
                  ? updates.parameters
                  : b.parameters,
            }
          : b,
      ),
    };
  });
};

/**
 * Single throttled updater entry for ALL message-state updates. The one
 * 500ms window-concat window replaces the previous three-channel throttles
 * (content/reasoning/tool), so every message-state update — including the
 * tool `running` stage's high-frequency `shortResult`/`result` updates from
 * bash — coalesces into the same window.
 *
 * Semantics: leading edge applies immediately and opens a window; updates
 * arriving within the window are queued in arrival order (FIFO) and applied
 * at the trailing edge as ONE composed updater, so no update is lost and no
 * update is reordered. `flush` applies queued updates immediately (used by
 * end signals and one-shot structural updates); `cancel` drops queued
 * updates (used by refreshMessages after pulling the authoritative snapshot —
 * the queued updates are already contained in it).
 *
 * The FIFO queue structurally replaces the old tool throttle's "drop a
 * tool's buffered streaming deltas when running arrives" logic: a running
 * updater is queued BEHIND the streaming chunks that preceded it and applies
 * after them, so a stale streaming event can never flush after running and
 * regress the stage (yellow dot -> gray). See
 * docs/specs/core/stream-content-updates.md.
 */
export function createThrottledUpdater<T>(
  apply: (updater: (prev: T) => T) => void,
  wait: number,
): {
  (updater: (prev: T) => T): void;
  cancel: () => void;
  flush: () => void;
} {
  let timer: NodeJS.Timeout | null = null;
  let queued: Array<(prev: T) => T> = [];

  const fire = () => {
    if (queued.length === 0) return;
    const batch = queued;
    queued = [];
    // Compose the whole batch into a single updater applied in FIFO order —
    // one state commit per trailing edge, no update dropped, no reordering.
    apply((prev) => batch.reduce((acc, upd) => upd(acc), prev));
  };

  const throttled = (updater: (prev: T) => T) => {
    if (timer) {
      queued.push(updater);
      return;
    }
    // Leading edge: apply immediately, then open a window whose trailing
    // edge only carries updates arriving within the window.
    apply(updater);
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, wait);
  };

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    queued = [];
  };

  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fire();
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

  // Single throttled entry for ALL message-state updates — one 500ms
  // window-concat window shared by every callback (content/reasoning deltas,
  // tool parametersChunk, tool `running` stage shortResult/result, one-shot
  // structural updates). The tool `running` stage used to bypass throttling
  // (bash shortResult height changes per chunk → layout flicker); routing it
  // through the same window as streaming deltas coalesces it to ≤1 render per
  // window. See createThrottledUpdater + docs/specs/core/stream-content-updates.md.
  const updateMessages = useMemo(
    () =>
      createThrottledUpdater<Message[]>((updater) => setMessages(updater), 500),
    [],
  );

  useEffect(() => {
    isExpandedRef.current = isExpanded;
    if (isExpanded) {
      // Cancel pending throttled updates so the frozen expanded view isn't overwritten
      updateMessages.cancel();
    }
  }, [isExpanded, updateMessages]);

  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactionStream, setCompactionStream] = useState("");
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
  // Skill metadata (for /skills overlay)
  const [skills, setSkills] = useState<SkillMetadata[]>([]);

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
  // Used on structural actions (/clear, /compact, rewind, ctrl-o) where stale
  // Static output must not linger on screen.
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
      // Pull the full UI display stream (keeps pre-compaction history);
      // `agent.messages` would only expose the folded API context.
      const msgs = agentRef.current.displayMessages.map(snapshotMessage);
      // Snapshot-safe: the full-list replacement makes the SDK state
      // authoritative. Any update still queued inside the 500ms throttle
      // window was applied to the SDK before this pull, so it is already
      // contained in `msgs` — dropping it prevents the trailing-edge flush
      // from re-appending the pre-refresh chunk on top of the snapshot
      // (first-word duplication). Updates arriving after the pull start fresh
      // windows and append on top of the snapshot. See
      // docs/specs/core/stream-content-updates.md.
      updateMessages.cancel();
      setMessages(msgs);
      setLatestTotalTokens(extractLatestTotalTokens(msgs));
    }
  }, [updateMessages]);

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
        // All of these funnel through the single throttled `updateMessages`
        // entry, so every message-state update shares one 500ms window.
        onUserMessageAdded: () => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msgs = agentRef.current.messages;
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "user") return;
          // Eager snapshot at callback time — React defers updater execution to
          // the batch flush, so evaluating snapshotMessage inside the updater
          // would read the SDK message after its in-place mutations.
          const snapshot = snapshotMessage(last);
          updateMessages((prev) =>
            prev.some((m) => m.id === last.id) ? prev : [...prev, snapshot],
          );
          // One-shot structural update — flush immediately so the message
          // card appears at once (queuing it gains no coalescing).
          updateMessages.flush();
        },
        onAssistantMessageAdded: (messageId: string) => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msg = agentRef.current.messages.find((m) => m.id === messageId);
          if (!msg) return;
          // Eager snapshot (see onUserMessageAdded): `addAssistantMessage()`
          // fires this callback BEFORE the first delta writes into the shared
          // message, so capturing here copies the pre-mutation (empty) blocks.
          const snapshot = snapshotMessage(msg);
          updateMessages((prev) =>
            prev.some((m) => m.id === messageId) ? prev : [...prev, snapshot],
          );
          updateMessages.flush();
        },
        onAssistantContentUpdated: (params) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) => applyContentDelta(prev, params));
          if (params.stage === "end") updateMessages.flush();
        },
        onAssistantReasoningUpdated: (params) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) => applyReasoningDelta(prev, params));
          if (params.stage === "end") updateMessages.flush();
        },
        onToolBlockUpdated: (params) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) => applyToolBlockUpdate(prev, params));
          if (params.stage === "end") updateMessages.flush();
        },
        onErrorBlockAdded: (error: string) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) => {
            // Append to the LAST message only if it is an assistant message
            // (the current turn's in-flight reply). If the last message is a
            // user message, the error belongs BELOW it — create a new
            // assistant message instead of polluting the stale assistant from
            // an earlier turn (which surfaced the error above the latest
            // user message and accumulated it there).
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return prev.map((m, idx) =>
                idx === prev.length - 1
                  ? {
                      ...m,
                      blocks: [...m.blocks, { type: "error", content: error }],
                    }
                  : m,
              );
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
          // One-shot structural update — flush immediately (errors must not be
          // delayed by a streaming window).
          updateMessages.flush();
        },
        onAddBangMessage: (command, messageId) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) =>
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
          updateMessages.flush();
        },
        onUpdateBangMessage: (command, output, messageId) => {
          if (isExpandedRef.current) return;
          updateMessages((prev) =>
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
          updateMessages((prev) =>
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
          // Completion signal — flush so the final state applies immediately.
          updateMessages.flush();
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
          if (!isCompactingState) {
            setCompactionStream("");
          }
        },
        onCompactionContentUpdate: (content) => {
          // The SDK delivers the accumulated compaction text; the loading
          // indicator renders only its last 30 characters (streaming tail).
          setCompactionStream(content);
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

        // Get initial state — snapshot the SDK messages (never hold live
        // references; see snapshotMessage). Uses the full display stream so a
        // restored session shows pre-compaction history too.
        setSessionId(agent.sessionId);
        setMessages(agent.displayMessages.map(snapshotMessage));
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

        // Get initial skill metadata
        const initialSkills = agent.getSkillMetadata?.() || [];
        setSkills(initialSkills);
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
      updateMessages,
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
    setSkills([]);
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
      updateMessages.cancel();
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
  }, [updateMessages]);

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
    compactionStream,
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
    skills,
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
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
