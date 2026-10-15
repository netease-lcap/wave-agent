import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import { useInput, useStdout } from "ink";
import { useAppConfig } from "./useAppConfig.js";
import {
  useRemoteControl,
  type RemoteControlApi,
} from "../hooks/useRemoteControl.js";
import type {
  Message,
  McpServerStatus,
  BackgroundTask,
  Task,
  SlashCommand,
  SubagentConfiguration,
  SkillMetadata,
  HookEventConfig,
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
  PLUGIN_CHANGE_PENDING_MESSAGE,
  PLUGIN_RELOADED_MESSAGE,
} from "wave-agent-sdk";
import { toString as qrToString } from "qrcode";
import { logger } from "../utils/logger.js";
import { displayUsageSummary } from "../utils/usageSummary.js";
import { expandLongTextPlaceholders } from "../managers/inputHandlers.js";
import { readFile } from "node:fs/promises";

import { BaseAppProps } from "../types.js";

/** How long `/remote-control` waits for the relay's registration round trip. */
const REMOTE_PAGE_WAIT_MS = 5_000;
const REMOTE_PAGE_POLL_MS = 250;

/**
 * Wait for the page address. It is assembled from this machine's channel key
 * after the relay registers it (an HTTP call) — nothing is pushed down the
 * WebSocket — so the first snapshot may not carry it yet.
 */
async function waitForRemotePageUrl(
  api: RemoteControlApi,
): Promise<string | undefined> {
  const deadline = Date.now() + REMOTE_PAGE_WAIT_MS;
  while (Date.now() < deadline) {
    const snapshot = api.getSnapshot();
    if (snapshot.pageUrl) return snapshot.pageUrl;
    if (snapshot.state === "error") return undefined;
    await new Promise((resolve) => setTimeout(resolve, REMOTE_PAGE_POLL_MS));
  }
  return api.getSnapshot().pageUrl;
}

/**
 * The result block a TUI session shows: the same address and the same QR that
 * `wave remote-control on` prints, because that pair is the whole contract with
 * the phone — the two entry points must not diverge on how it is rendered.
 */
async function describeRemotePage(pageUrl: string): Promise<string> {
  const lines = [
    "Remote control is on — this terminal's session is now served to your phone.",
    `Page: ${pageUrl}`,
  ];
  try {
    lines.push(
      "",
      await qrToString(pageUrl, {
        type: "utf8",
        errorCorrectionLevel: "L",
      }),
    );
  } catch {
    // The address above already carries the contract; a missing QR is not worth
    // failing the command over.
  }
  lines.push("", "Turn it off with /remote-control off");
  return lines.join("\n");
}

// Main Chat Context
export interface PlanViewData {
  path?: string;
  content?: string;
  message?: string;
}

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
  /**
   * Set the current session's custom title (`/rename <title>`). A blank title
   * only prints the usage hint — no AI-generated titles (spec: session-management.md).
   */
  renameSession: (args?: string) => Promise<void>;
  /**
   * Switch to another conversation in-process (`/resume`). Pass `resumeWorkdir`
   * when the target session lives in a sibling worktree of the same repo — the
   * session then moves into that directory too.
   */
  resumeSession: (sessionId: string, resumeWorkdir?: string) => Promise<void>;
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
  // Hook configs per scope (for /hooks overlay)
  hooks: Partial<
    Record<"user" | "project" | "plugin", Record<string, HookEventConfig[]>>
  >;
  // Permission functionality
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  /**
   * Remote control for **this** foreground session. The process the user is
   * typing in is the one that dials out — not the daemon, which cannot reach a
   * session that only exists here.
   */
  remoteControl: RemoteControlApi;
  /**
   * `/remote-control [on|off|status] [name]` — the TUI-side switch for the hook
   * above. Its CLI namesake talks to the daemon instead; the two are not
   * interchangeable, because a session that lives in this process is reachable
   * only from this process.
   */
  remoteControlCommand: (args?: string) => Promise<void>;
  // /plan overlay state + handler
  planView: PlanViewData | null;
  setPlanView: (view: PlanViewData | null) => void;
  handlePlanCommand: (args?: string) => Promise<void>;
  // Permission confirmation state
  isConfirmationVisible: boolean;
  hasPendingConfirmations: boolean;
  confirmingTool?: {
    name: string;
    input?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
    outsideSafeZoneDirectory?: string;
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
    outsideSafeZoneDirectory?: string,
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
  // Plugin in-place reload (docs/specs/ecosystem/plugin.md「插件变更的就地重载」)
  reloadPlugins: () => Promise<void>;
  notifyPluginChange: () => void;
  pluginHint: string | null;
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

  // All message-state updates apply IMMEDIATELY via setMessages — no data-layer
  // throttling (removed 2026-10-15 after observing fully-immediate rendering in
  // a real terminal with no flicker: Ink's log-update only rewrites the dynamic
  // zone tail and its built-in maxFps:30 coalesces short-result line-count
  // oscillation). Arrival order = application order. See
  // docs/specs/core/stream-content-updates.md (2026-10-15 会议).

  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

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
  // Hook configs per scope (for /hooks overlay)
  const [hooks, setHooks] = useState<
    Partial<
      Record<"user" | "project" | "plugin", Record<string, HookEventConfig[]>>
    >
  >({});

  // Permission state
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    initialPermissionMode ||
      (bypassPermissions ? "bypassPermissions" : "default"),
  );

  // Plan view state for the /plan command overlay
  const [planView, setPlanView] = useState<PlanViewData | null>(null);

  // Confirmation state with queue-based architecture
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false);
  const [confirmingTool, setConfirmingTool] = useState<
    | {
        name: string;
        input?: Record<string, unknown>;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
        outsideSafeZoneDirectory?: string;
        planContent?: string;
        permissionMode?: PermissionMode;
        warning?: string;
      }
    | undefined
  >();
  const [confirmationQueue, setConfirmationQueue] = useState<
    Array<{
      requestId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      outsideSafeZoneDirectory?: string;
      planContent?: string;
      permissionMode?: PermissionMode;
      warning?: string;
      resolver: (decision: PermissionDecision) => void;
      reject: () => void;
    }>
  >([]);
  const [currentConfirmation, setCurrentConfirmation] = useState<{
    requestId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    suggestedPrefix?: string;
    hidePersistentOption?: boolean;
    outsideSafeZoneDirectory?: string;
    planContent?: string;
    permissionMode?: PermissionMode;
    warning?: string;
    resolver: (decision: PermissionDecision) => void;
    reject: () => void;
  } | null>(null);

  /**
   * The same approvals, keyed by id, so a phone can answer them.
   *
   * The queue above is the terminal's view of "what am I waiting on"; this map
   * is the phone's. Both resolve the same promise, so whichever side answers
   * first wins — that is the whole of the concurrency rule (spec: 前台 CLI
   * 故事场景 5), and it needs no arbitration beyond "delete on settle".
   */
  const remotePendingRef = useRef<
    Map<
      string,
      {
        context: ToolPermissionContext;
        settle: (decision: PermissionDecision) => void;
      }
    >
  >(new Map());
  const [remotePending, setRemotePending] = useState<
    Array<{ requestId: string; context: ToolPermissionContext }>
  >([]);
  const permissionCounterRef = useRef(0);

  const syncRemotePending = useCallback(() => {
    setRemotePending(
      [...remotePendingRef.current.entries()].map(([requestId, entry]) => ({
        requestId,
        context: entry.context,
      })),
    );
  }, []);

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
      // The snapshot makes the SDK state authoritative: with no throttle
      // window there is nothing pending to cancel — every pre-pull update is
      // already applied and contained in `msgs`, and post-pull deltas append
      // on top of the snapshot. See docs/specs/core/stream-content-updates.md.
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
      outsideSafeZoneDirectory?: string,
    ): Promise<PermissionDecision> => {
      const requestId = `cli_perm_${++permissionCounterRef.current}`;
      return new Promise<PermissionDecision>((resolve, reject) => {
        const context: ToolPermissionContext = {
          toolName,
          ...(toolInput ? { toolInput } : {}),
          ...(suggestedPrefix ? { suggestedPrefix } : {}),
          ...(hidePersistentOption !== undefined
            ? { hidePersistentOption }
            : {}),
          ...(outsideSafeZoneDirectory ? { outsideSafeZoneDirectory } : {}),
          ...(planContent ? { planContent } : {}),
          // Required on the context, and the phone renders it: which mode this
          // request is being judged under.
          permissionMode: permissionMode ?? "default",
          ...(warning ? { warning } : {}),
        };
        // Settling through the map is what keeps the phone's list honest: an
        // approval answered at the terminal must vanish from the phone too.
        const settle = (decision: PermissionDecision) => {
          remotePendingRef.current.delete(requestId);
          syncRemotePending();
          resolve(decision);
        };
        const cancel = () => {
          remotePendingRef.current.delete(requestId);
          syncRemotePending();
          reject();
        };
        remotePendingRef.current.set(requestId, { context, settle });
        syncRemotePending();
        const queueItem = {
          requestId,
          toolName,
          toolInput,
          suggestedPrefix,
          hidePersistentOption,
          outsideSafeZoneDirectory,
          planContent,
          permissionMode,
          warning,
          resolver: settle,
          reject: cancel,
        };

        setConfirmationQueue((prev) => [...prev, queueItem]);
        // processNextConfirmation will be called via useEffect
      });
    },
    [syncRemotePending],
  );

  // Initialize AI manager
  const initializeAgent = useCallback(
    async (restoreSessionIdOverride?: string) => {
      const effectiveRestoreSessionId =
        restoreSessionIdOverride ?? restoreSessionId;

      const callbacks: AgentCallbacks = {
        // ── Incremental message updates (no full-list pushes) ──────
        // Every update applies immediately via setMessages — no data-layer
        // throttling (removed 2026-10-15, see docs/specs/core/stream-content-updates.md).
        // Arrival order = application order; terminal write frequency is
        // bounded by Ink's built-in maxFps:30.
        onUserMessageAdded: () => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msgs = agentRef.current.messages;
          const last = msgs[msgs.length - 1];
          if (!last || last.role !== "user") return;
          // Eager snapshot at callback time — React defers updater execution to
          // the batch flush, so evaluating snapshotMessage inside the updater
          // would read the SDK message after its in-place mutations.
          const snapshot = snapshotMessage(last);
          // One-shot structural update — applied directly (a window would
          // only delay the message card, no coalescing value).
          setMessages((prev) =>
            prev.some((m) => m.id === last.id) ? prev : [...prev, snapshot],
          );
        },
        onAssistantMessageAdded: (messageId: string) => {
          if (isExpandedRef.current || !agentRef.current) return;
          const msg = agentRef.current.messages.find((m) => m.id === messageId);
          if (!msg) return;
          // Eager snapshot (see onUserMessageAdded): `addAssistantMessage()`
          // fires this callback BEFORE the first delta writes into the shared
          // message, so capturing here copies the pre-mutation (empty) blocks.
          const snapshot = snapshotMessage(msg);
          setMessages((prev) =>
            prev.some((m) => m.id === messageId) ? prev : [...prev, snapshot],
          );
        },
        onAssistantMessageDiscarded: (messageId: string) => {
          // The streamed attempt died mid-body and was re-issued without
          // streaming; its half message is void (spec: 流式响应正文中途断连时
          // 降级为非流式重发).
          if (isExpandedRef.current) return;
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
        },
        onAssistantContentUpdated: (params) => {
          if (isExpandedRef.current) return;
          // Text delta: height grows monotonically → per-delta application.
          // No flush on end: this channel has no pending updates, and the
          // tool-running window must not be cut short by a text end.
          setMessages((prev) => applyContentDelta(prev, params));
        },
        onAssistantReasoningUpdated: (params) => {
          if (isExpandedRef.current) return;
          setMessages((prev) => applyReasoningDelta(prev, params));
        },
        onToolBlockUpdated: (params) => {
          if (isExpandedRef.current) return;
          // All stages (start/streaming/running/end) apply directly —
          // `end` carries the authoritative final values.
          setMessages((prev) => applyToolBlockUpdate(prev, params));
        },
        onErrorBlockAdded: (error: string) => {
          if (isExpandedRef.current) return;
          // One-shot structural update — applied directly (errors must not be
          // delayed by the tool-running window).
          setMessages((prev) => {
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
              context.outsideSafeZoneDirectory,
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
          // This session was created from the interactive CLI → `app.entrypoint`.
          entrypoint: "cli",
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

        // Get initial hooks (user/project from settings.json, plugin from
        // the hook manager's plugin-registered set) — snapshot for /hooks.
        const [userHooks, projectHooks, pluginHooks] = await Promise.all([
          agent.getHooksByScope("user"),
          agent.getHooksByScope("project"),
          agent.getHooksByScope("plugin"),
        ]);
        setHooks({
          user: userHooks,
          project: projectHooks,
          plugin: pluginHooks,
        });
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
      mcpServers,
    ],
  );

  // 插件变更落盘后只置一个「待应用」信号并提示一次，不再重建 Agent；真正换装由
  // 用户敲 /reload-plugins 触发，在当前会话内完成（docs/specs/ecosystem/plugin.md
  // 「插件变更的就地重载」：会…不重建、不打断回合、不新建会话）。
  const [pluginHint, setPluginHint] = useState<string | null>(null);
  const pluginHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPluginHint = useCallback((message: string) => {
    setPluginHint(message);
    if (pluginHintTimer.current) {
      clearTimeout(pluginHintTimer.current);
    }
    // 一次性提示：数秒后自行消失，不留常驻标识（spec「插件变更提示」）。
    pluginHintTimer.current = setTimeout(() => setPluginHint(null), 8000);
  }, []);

  const notifyPluginChange = useCallback(() => {
    showPluginHint(PLUGIN_CHANGE_PENDING_MESSAGE);
  }, [showPluginHint]);

  const reloadPlugins = useCallback(async () => {
    const agent = agentRef.current;
    if (!agent) return;
    try {
      const result = await agent.reloadPlugins();
      // 换装后本进程各会话的能力已变，UI 侧的命令 / 子代理 / 技能列表同步重读。
      setSlashCommands(agent.getSlashCommands?.() || []);
      setAgentDefinitions(agent.getSubagentConfigurations?.() || []);
      setSkills(agent.getSkillMetadata?.() || []);
      if (result.failures.length > 0) {
        // 失败不回滚：如实提示，会话继续可用（spec 场景 11）。
        showPluginHint(
          `${PLUGIN_RELOADED_MESSAGE}部分插件加载失败：${result.failures
            .map((failure) => `${failure.path}: ${failure.error}`)
            .join("；")}`,
        );
      } else {
        showPluginHint(PLUGIN_RELOADED_MESSAGE);
      }
    } catch (error) {
      showPluginHint(
        `插件重载失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [showPluginHint]);

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

  // /rename: set the current conversation's custom title. The title is stored
  // as a reserved `custom-title` entry appended to the session's own JSONL
  // file, so `wave -r` and every GUI host read the same value. A blank title
  // only prints the usage hint — no AI-generated titles (spec:
  // session-management.md "不做 AI 自动标题").
  const renameSession = useCallback(async (args?: string) => {
    const agent = agentRef.current;
    if (!agent) return;

    const title = (args ?? "").trim();
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

    if (!title) {
      showResult("Usage: /rename <title>");
      return;
    }

    try {
      await agent.renameSession(title);
      showResult(`Conversation renamed to "${title}".`);
    } catch (error) {
      showResult(
        `Failed to rename conversation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, []);

  // /resume: switch to another conversation without leaving the process. The
  // session id and its on-disk project directory move together, so the next
  // message is appended to the target's own transcript. A failed restore leaves
  // the current session untouched and only surfaces a notice.
  const resumeSession = useCallback(
    async (sessionId: string, resumeWorkdir?: string) => {
      const agent = agentRef.current;
      if (!agent) return;

      try {
        await agent.restoreSession(
          sessionId,
          resumeWorkdir ? { workdir: resumeWorkdir } : undefined,
        );
      } catch (error) {
        // UI-only notice (same display path as /add-dir): nothing was switched,
        // so nothing about the failed target is persisted.
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            role: "assistant",
            timestamp: new Date().toISOString(),
            blocks: [
              {
                type: "error",
                content: `Failed to resume conversation: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          },
        ]);
        return;
      }

      setSessionId(agent.sessionId);
      setWorkingDirectory(agent.workingDirectory);
      setIsLoading(agent.isLoading);
      refreshMessages();
      forceRemount();
    },
    [forceRemount, refreshMessages],
  );

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

  // /plan command handler:
  // - Outside plan mode: switch to plan mode, wait for the plan file path
  //   (generated asynchronously by PlanManager), then either send the given
  //   description as a message (starting a plan query) or show a confirmation.
  // - Inside plan mode: display the current plan file contents; `/plan open`
  //   is not supported on any end (spec: plan-mode.md "三端均不支持").
  const handlePlanCommand = useCallback(
    async (args?: string) => {
      const agent = agentRef.current;
      const description = args?.trim() ?? "";
      const argList = description.split(/\s+/).filter(Boolean);
      const wantsOpen = argList[0] === "open";

      if (permissionMode !== "plan") {
        setPermissionMode("plan");
        // Wait for the plan file path to be generated before triggering a
        // query so the model always receives the plan file location (spec:
        // plan-mode.md "路径生成必须先于查询触发").
        const planPath = await agent?.awaitPlanFilePath();

        if (description && !wantsOpen) {
          await sendMessage(description);
          return;
        }
        setPlanView({ message: "Enabled plan mode", path: planPath });
        return;
      }

      // Already in plan mode — display the current plan file contents.
      const planPath =
        agent?.getPlanFilePath() ?? (await agent?.awaitPlanFilePath());
      if (!planPath) {
        setPlanView({ message: "No plan written yet." });
        return;
      }
      try {
        const content = await readFile(planPath, "utf8");
        setPlanView({ path: planPath, content });
      } catch (error) {
        logger.warn("Failed to read plan file:", error);
        setPlanView({ message: "No plan written yet." });
      }
    },
    [permissionMode, sendMessage, setPermissionMode],
  );

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
        outsideSafeZoneDirectory: next.outsideSafeZoneDirectory,
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

  // Mirrors for the remote-control host: it outlives any single render, so it
  // must read the confirmation showing *now* rather than the one captured when
  // it was built.
  const currentConfirmationRef = useRef<typeof currentConfirmation>(null);
  useEffect(() => {
    currentConfirmationRef.current = currentConfirmation;
  }, [currentConfirmation]);
  const hideConfirmationRef = useRef(hideConfirmation);
  useEffect(() => {
    hideConfirmationRef.current = hideConfirmation;
  }, [hideConfirmation]);

  /**
   * Answer an approval from the phone. It settles the same promise the terminal
   * is waiting on, so this advances the session exactly as pressing the key
   * would — and if that request is the one on screen, the dialog goes away.
   */
  const respondPermission = useCallback(
    (requestId: string, decision: PermissionDecision) => {
      const entry = remotePendingRef.current.get(requestId);
      if (!entry) return;
      entry.settle(decision);
      if (currentConfirmationRef.current?.requestId === requestId) {
        hideConfirmationRef.current();
      }
    },
    [],
  );

  const getAvailableTools = useCallback(
    () => agentRef.current?.getAvailableToolNames() ?? [],
    [],
  );

  // Serve this foreground session to a phone, if the switch allows it. The hook
  // owns the outbound connection; it reads current state through a ref, so
  // passing the values here (rather than wiring callbacks into every setter) is
  // what keeps this the whole of the integration.
  const remoteControl = useRemoteControl({
    workdir: workdir ?? process.cwd(),
    sessionId,
    messages,
    isLoading,
    permissionMode,
    latestTotalTokens,
    maxInputTokens,
    hasRunningBackgroundWork: backgroundTasks.length > 0,
    hasPendingMessages: queuedMessages.length > 0,
    // 场景 26 的会话状态族：远控页按状态重读 `getSessionInfo`，这四个是它的
    // 当前值（回调本就把它们写进 state，这里原样递给门面即可）。
    tasks,
    isCompacting,
    isCommandRunning,
    queuedMessages,
    pending: remotePending,
    availableTools: getAvailableTools,
    sendMessage: (text) => sendMessage(text),
    abort: () => agentRef.current?.abortMessage(),
    setPermissionMode,
    respondPermission,
    // 会话自身的维护动作（重命名 / 压缩 / 指令清单）：页面能直接用，且都由这一份
    // 会话状态来答，所以给的是「取当前值」的函数。重命名走 agent 而非 /rename 命令，
    // 是为了让失败以 RPC 错误回给页面（TUI 那条路径把错误渲染成一条消息）。
    renameSession: (title) => agentRef.current?.renameSession(title),
    compact: (instructions) => compact(instructions),
    slashCommands: () => agentRef.current?.getSlashCommands() ?? [],
  });

  /**
   * `/remote-control [on|off|status] [name]` — offer this terminal's session to
   * a phone. It is deliberately *not* a front end for `wave remote-control`:
   * that subcommand drives the daemon, and this session exists only in this
   * process, so the daemon could not serve it (spec: remote-control.md,
   * "前台 CLI 会话也能被手机接管").
   */
  const remoteControlCommand = useCallback(
    async (args?: string) => {
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

      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = parts[0]?.toLowerCase() ?? "";
      if (
        action &&
        action !== "on" &&
        action !== "off" &&
        action !== "status"
      ) {
        showResult("Usage: /remote-control [on|off|status] [name]");
        return;
      }

      if (!remoteControl.enabled) {
        showResult(
          'Remote control is unavailable in this process. Set "enableRemoteControl": true in ~/.wave/settings.json (or .wave/settings.json in the project), then restart the CLI — a process that is already running keeps the settings it started with.',
        );
        return;
      }

      if (action === "off") {
        remoteControl.disconnect();
        showResult(
          "Remote control is off — this terminal's session is no longer served.",
        );
        return;
      }

      const current = remoteControl.getSnapshot();
      const serving =
        current.state === "online" || current.state === "connecting";
      // A bare `/remote-control` means "start serving" the first time and
      // "what is it doing?" afterwards, so a second one cannot silently dial
      // again and cannot hide an address the user still needs.
      if (action === "status" || (!action && serving)) {
        showResult(
          current.pageUrl
            ? await describeRemotePage(current.pageUrl)
            : `Remote control status: ${current.state}${
                current.message ? ` — ${current.message}` : ""
              }`,
        );
        return;
      }

      remoteControl.connect(parts[1]);
      const pageUrl = await waitForRemotePageUrl(remoteControl);
      const after = remoteControl.getSnapshot();
      if (!pageUrl) {
        showResult(
          after.state === "error"
            ? `Remote control failed: ${after.message ?? "unknown error"}`
            : "Connected to the relay, but no page address came back yet — run /remote-control status in a moment.",
        );
        return;
      }
      showResult(await describeRemotePage(pageUrl));
    },
    [remoteControl],
  );

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
      void agentRef.current.setModel(model);
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
    renameSession,
    resumeSession,
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
    hooks,
    permissionMode,
    setPermissionMode,
    remoteControl,
    remoteControlCommand,
    planView,
    setPlanView,
    handlePlanCommand,
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
    reloadPlugins,
    notifyPluginChange,
    pluginHint,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
