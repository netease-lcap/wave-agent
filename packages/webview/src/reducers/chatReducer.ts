import type {
  ChatState,
  ChatAction,
  Message,
  MessageBlock,
  TextBlock,
  ToolBlock,
  ErrorBlock,
} from "../types";
import { pinSessionTitle } from "../utils/session";

export const initialState: ChatState = {
  messages: [],
  historyExhausted: false,
  // 能力位默认关：认不得分页的宿主（老版本）不推这个字段，页面就不装分页。
  supportsMessagePaging: false,
  tasks: [],
  backgroundTasks: [],
  workflowRuns: [],
  isTaskListCollapsed: false,
  isQueueCollapsed: true,
  editingQueuedId: null,
  isStreaming: false,
  isCompacting: false,
  isRestoring: false,
  isCommandRunning: false,
  shouldClearInput: false,
  sessions: [],
  currentSession: undefined,
  sessionsLoading: false,
  pendingConfirmations: [],
  // 会话列表的状态标记（远控 Web 页）：读不到任何状态时不标任何对话——空集是
  // 「没有对话在等 / 没有对话在跑」，与 undefined 区分开（后者是宿主没给）。
  sessionStatus: { waiting: [], running: [] },
  // 机器侧最近打开的工作目录（远控 Web 页「新建会话」）：会话全删光之后它是
  // 唯一还记得旧目录的来源，与活会话派生的目录合并后进弹窗。
  recentWorkdirs: [],
  queuedMessages: [],
  // Dialog state
  activeDialog: null,
  configurationData: undefined,
  configurationLoading: false,
  configurationError: undefined,
  projectSettings: undefined,
  // Mirror of the last accepted projectSettings reply: the value plus the
  // workdir it belongs to (host 归属键原样带回). Keyed snapshots live in
  // SessionUiStore (workdir 维度); this pair only feeds the 项目设置 view's
  // render-time guard (SettingsPage: mismatch = treat as unloaded).
  projectSettingsWorkdir: undefined,
  // Permission mode state
  permissionMode: "default",
  // Attached images state
  attachedImages: [],
  // Auth state
  isAuthenticated: false,
  initialized: false,
  // 只有 SET_INITIAL_STATE 会置真（见 types/index.ts 的同名字段注释）——预填提示词
  // 等它翻转后才写，避免写进「authStatus 已到、快照未到」的半就绪窗口被快照重置。
  initialStateReceived: false,
  workdir: undefined,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_MESSAGES": {
      return {
        ...state,
        messages: action.payload,
        // A replacement list is a new window: whatever the previous one knew
        // about the beginning of the history no longer describes this one
        // (session switch, a re-read, a structural truncation). The window the
        // host just sent says whether there is more before it — `hasMore`
        // absent means an old host that ships the whole thread, i.e. the
        // beginning is right there.
        historyExhausted: action.hasMore === false,
        currentSession: pinSessionTitle(state.currentSession, action.payload),
      };
    }
    case "PREPEND_MESSAGES": {
      const { messages, hasMore } = action.payload;
      // The host's window is exclusive of the anchor the page sent, so a
      // well-behaved page comes back with messages this list has never seen. The
      // filter is for the case it does not: ids repeat in this list (a compacted
      // message is added back), and the anchor resolves to its LAST occurrence
      // host-side, so a page can legitimately include rows that are already here.
      // Dropping them by id keeps the older-rows-first order without a duplicate.
      const held = new Set(state.messages.map((m) => m.id));
      const older = messages.filter((m) => !held.has(m.id));
      return {
        ...state,
        messages: older.length ? [...older, ...state.messages] : state.messages,
        historyExhausted: !hasMore,
      };
    }
    case "SET_TASKS":
      return {
        ...state,
        tasks: action.payload,
        // Auto-expand task list when tasks are first created
        isTaskListCollapsed:
          state.tasks.length === 0 && action.payload.length > 0
            ? false
            : state.isTaskListCollapsed,
      };
    case "SET_BACKGROUND_TASKS":
      return { ...state, backgroundTasks: action.payload };
    case "SET_WORKFLOW_RUNS":
      return { ...state, workflowRuns: action.payload };
    case "TOGGLE_TASK_LIST_COLLAPSE":
      return {
        ...state,
        isTaskListCollapsed: !state.isTaskListCollapsed,
      };
    case "SET_TASK_LIST_COLLAPSED":
      return {
        ...state,
        isTaskListCollapsed: action.payload,
      };
    case "TOGGLE_QUEUE_COLLAPSE":
      return {
        ...state,
        isQueueCollapsed: !state.isQueueCollapsed,
      };
    case "START_STREAMING":
      return {
        ...state,
        isStreaming: true,
      };
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
      };
    case "SET_COMPACTING":
      return {
        ...state,
        isCompacting: action.payload,
      };
    case "INPUT_CLEARED":
      return {
        ...state,
        shouldClearInput: false,
      };
    case "SET_SESSIONS":
      return {
        ...state,
        sessions: action.payload,
        sessionsLoading: false,
      };
    // 会话列表的两类标记（远控 Web 页）：两个集合一起给——它们是同一次重读的
    // 两半（待确认来自 listPendingPermissions、忙闲来自会话注册表），分开给会让
    // 没变的那一半在到达时被清空。
    case "SET_SESSION_STATUS":
      return {
        ...state,
        sessionStatus: action.payload,
      };
    case "SET_RECENT_WORKDIRS":
      return {
        ...state,
        recentWorkdirs: action.payload,
      };
    case "SET_CURRENT_SESSION": {
      const session = action.payload;
      if (!session) {
        return { ...state, currentSession: undefined };
      }
      // The backend pushes a currentSession without firstMessage on session
      // switch, but the sessions list carries the authoritative firstMessage
      // (from JSONL). Backfill it so the header title stays consistent with the
      // session list. New sessions (not yet in the list) keep an empty
      // firstMessage so getSessionTitle falls back to deriving from messages.
      // Same for customTitle: the pushed session may predate a rename, and the
      // sessions list (from listSessions → JSONL custom-title entry) is the
      // authoritative copy — without this the header would lose the custom
      // title after a pane/session switch or an IDE reload.
      let currentSession = session;
      const existing = state.sessions.find((s) => s.id === session.id);
      if (existing && (!session.firstMessage || !session.customTitle)) {
        currentSession = {
          ...session,
          firstMessage: session.firstMessage || existing.firstMessage,
          customTitle: session.customTitle || existing.customTitle,
        };
      }
      return { ...state, currentSession };
    }
    case "RENAME_SESSION": {
      const { sessionId, title } = action.payload;
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, customTitle: title } : s,
        ),
        currentSession:
          state.currentSession?.id === sessionId
            ? { ...state.currentSession, customTitle: title }
            : state.currentSession,
      };
    }
    case "SET_SESSIONS_LOADING":
      return {
        ...state,
        sessionsLoading: action.payload,
      };
    case "SHOW_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: [...state.pendingConfirmations, action.payload],
      };
    case "HIDE_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: state.pendingConfirmations.filter(
          (c) => c.confirmationId !== action.payload,
        ),
      };
    case "SHOW_DIALOG":
      return {
        ...state,
        activeDialog: action.payload.type,
      };
    case "HIDE_DIALOG":
      return {
        ...state,
        activeDialog: null,
        configurationError: undefined,
      };
    case "SET_AUTHENTICATED":
      return {
        ...state,
        isAuthenticated: action.payload,
        initialized: true,
      };
    case "SET_CONFIGURATION_LOADING":
      return {
        ...state,
        configurationLoading: action.payload,
      };
    case "SET_CONFIGURATION_ERROR":
      return {
        ...state,
        configurationError: action.payload,
        configurationLoading: false,
      };
    case "SET_CONFIGURATION_DATA":
      return {
        ...state,
        configurationData: action.payload,
        configurationError: undefined,
        configurationLoading: false,
      };
    case "SET_PROJECT_SETTINGS":
      return {
        ...state,
        projectSettings: {
          enabledPlugins: action.payload.enabledPlugins,
        },
        // Mirror write: only reached for replies whose attribution workdir
        // matched the pane's current workdir (ChatApp 过期即弃已过滤)，workdir
        // 原样落镜像供 SettingsPage 渲染期守卫比对。
        projectSettingsWorkdir: action.payload.workdir,
      };
    case "SET_INITIAL_STATE": {
      // rewind 路径带 keepMessages：宿主已按同一条规则切过自己的缓存，这份快照
      // 只为更新其余字段，列表必须保留 webview 切好的那份 —— 否则整份列表会被
      // 重传覆盖，本地切等于白做。
      const messages = action.payload.keepMessages
        ? state.messages
        : action.payload.messages;
      return {
        ...state,
        messages,
        // rewind 那条快照没带列表：手上这份是 webview 自己切的，宿主对它没有
        // 发言权，「到底了没有」沿用现值。其余快照按宿主给的窗口判定（三端首屏
        // 只推一页，`historyExhausted` 由宿主的 `hasMore` 决定初值）。
        historyExhausted: action.payload.keepMessages
          ? state.historyExhausted
          : (action.payload.historyExhausted ?? false),
        // 能力位：老宿主不带 ⇒ 关掉。硬编码 true 会让只推了一页的页面向一个不认
        // 这条命令的宿主反复要「更早」，而它那边是静默失败。
        supportsMessagePaging: action.payload.supportsMessagePaging ?? false,
        tasks: action.payload.tasks || [],
        isTaskListCollapsed:
          action.payload.isTaskListCollapsed !== undefined
            ? action.payload.isTaskListCollapsed
            : state.isTaskListCollapsed,
        isStreaming:
          action.payload.isStreaming !== undefined
            ? action.payload.isStreaming
            : state.isStreaming,
        isCommandRunning:
          action.payload.isCommandRunning !== undefined
            ? action.payload.isCommandRunning
            : state.isCommandRunning,
        // A session switch must not inherit the previous session's compaction
        // hint; the host pushes the activated session's own state (or omits
        // it, meaning "not compacting").
        isCompacting: action.payload.isCompacting ?? false,
        // Same for the desktop restore overlay: each host push carries the
        // current restore state, defaulting to "not restoring".
        isRestoring: action.payload.isRestoring ?? false,
        sessions: action.payload.sessions || state.sessions || [],
        // Re-pin from the same-snapshot messages: hosts re-push the session
        // object without firstMessage on pane/webview re-init.
        currentSession: pinSessionTitle(
          action.payload.currentSession || state.currentSession,
          messages,
        ),
        configurationData:
          action.payload.configurationData || state.configurationData,
        pendingConfirmations: action.payload.pendingConfirmations || [],
        // 快照里没有这两组 id 时保留现值，而不是清空：缺席只说明宿主那份快照
        // 早于本字段（或该宿主根本没有会话列表），把它当「没有对话在等/在跑」
        // 会给出一个比事实更安静的画面。
        sessionStatus: action.payload.sessionStatus || state.sessionStatus,
        queuedMessages: action.payload.queuedMessages || [],
        backgroundTasks: action.payload.backgroundTasks ?? [],
        workflowRuns: action.payload.workflowRuns ?? [],
        inputContent: action.payload.inputContent,
        selection: action.payload.selection,
        permissionMode: action.payload.permissionMode || state.permissionMode,
        attachedImages: action.payload.attachedImages || [],
        sessionsLoading: false,
        configurationLoading: false,
        initialized: true,
        // 权威快照落地（预填提示词的写入闸门，见 ChatState 注释）。
        initialStateReceived: true,
        isAuthenticated:
          action.payload.isAuthenticated !== undefined
            ? action.payload.isAuthenticated
            : state.isAuthenticated,
        workdir:
          action.payload.workdir !== undefined
            ? action.payload.workdir
            : state.workdir,
      };
    }
    case "UPDATE_SELECTION":
      return {
        ...state,
        selection: action.payload,
      };
    case "SET_QUEUED_MESSAGES":
      // A queue arrives from another process, so "is it a list" is a runtime
      // question the type cannot answer. Writing an undefined here reaches
      // `QueuedMessageList`, throws on `.slice`, and takes the whole tree down
      // (no error boundary); keeping the current queue is also the honest
      // answer — a malformed update says nothing about the real queue.
      return {
        ...state,
        queuedMessages: Array.isArray(action.payload)
          ? action.payload
          : state.queuedMessages,
      };
    case "SET_EDITING_QUEUED_ID":
      return {
        ...state,
        editingQueuedId: action.payload,
      };
    case "SET_COMMAND_RUNNING":
      return {
        ...state,
        isCommandRunning: action.payload,
      };
    case "SET_PERMISSION_MODE":
      return {
        ...state,
        permissionMode: action.payload,
      };
    case "SET_WORKDIR":
      return {
        ...state,
        workdir: action.payload,
      };
    // Incremental update actions for streaming optimization
    case "APPEND_MESSAGE": {
      const messages = [...state.messages, action.payload];
      return {
        ...state,
        messages,
        // Hosts that deliver user messages incrementally (desktop, VSCE) never
        // route them through SET_MESSAGES, so the title pin must happen here
        // too — otherwise compaction wipes the derivation material.
        currentSession: pinSessionTitle(state.currentSession, messages),
      };
    }
    case "REMOVE_MESSAGE": {
      // Streamed attempt died mid-body and was re-issued without streaming: the
      // half message the host already rendered must go away rather than linger
      // above the real answer.
      const messages = state.messages.filter(
        (m) => m.id !== action.payload.messageId,
      );
      if (messages.length === state.messages.length) return state;
      return { ...state, messages };
    }
    case "TRUNCATE_MESSAGES": {
      // rewind：保留到 `messageId` 最后一次出现之前。用 lastIndexOf 与服务端
      // 同规则（压缩后同 id 会重复出现，用户看到的是最后一次那份），因此两边
      // 各自本地切完的结果一致。锚点不在列表里就 no-op —— 交回宿主的下一次快照。
      const index = state.messages
        .map((m) => m.id)
        .lastIndexOf(action.payload.messageId);
      if (index === -1) return state;
      return { ...state, messages: state.messages.slice(0, index) };
    }
    case "UPDATE_STREAMING_CONTENT": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const textBlockIndex = message.blocks.findIndex((b) => b.type === "text");

      let newBlocks: MessageBlock[];
      if (textBlockIndex === -1) {
        // No text block yet, append one
        const newTextBlock: TextBlock = {
          type: "text",
          content: chunk,
          stage,
        };
        newBlocks = [...message.blocks, newTextBlock];
      } else {
        // Append the delta chunk to the existing text block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === textBlockIndex && block.type === "text") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
            } as TextBlock;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_STREAMING_REASONING": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const reasoningBlockIndex = message.blocks.findIndex(
        (b) => b.type === "reasoning",
      );

      let newBlocks: MessageBlock[];
      if (reasoningBlockIndex === -1) {
        // No reasoning block yet, append one. Record startTime so the UI can show
        // elapsed thinking time during streaming (SET_MESSAGES later overrides it
        // with the SDK's persisted value).
        const newReasoningBlock = {
          type: "reasoning" as const,
          content: chunk,
          stage,
          startTime: Date.now(),
          ...(stage === "end" ? { endTime: Date.now() } : {}),
        };
        newBlocks = [...message.blocks, newReasoningBlock];
      } else {
        // Append the delta chunk to the existing reasoning block, preserving
        // startTime and stamping endTime when the reasoning finishes.
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === reasoningBlockIndex && block.type === "reasoning") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
              startTime: block.startTime ?? Date.now(),
              ...(stage === "end"
                ? { endTime: block.endTime ?? Date.now() }
                : {}),
            };
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_TOOL_BLOCK": {
      const {
        messageId,
        id: toolBlockId,
        parametersChunk,
        ...rest
      } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const toolBlockIndex = message.blocks.findIndex(
        (b) => b.type === "tool" && b.id === toolBlockId,
      );

      let newBlocks: MessageBlock[];
      if (toolBlockIndex === -1) {
        // Tool block doesn't exist yet, add it as a new block
        const newToolBlock: ToolBlock = {
          type: "tool",
          id: toolBlockId,
          name: rest.name || "",
          stage: rest.stage || "start",
          result: rest.result || "",
          success: rest.success ?? false,
          ...rest,
          parameters: (rest.parameters || "") + (parametersChunk || ""),
        };
        newBlocks = [...message.blocks, newToolBlock];
      } else {
        // Update existing tool block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === toolBlockIndex && block.type === "tool") {
            const merged: ToolBlock = { ...block, ...rest };
            if (parametersChunk) {
              // Delta form (streaming): append the chunk to the accumulated parameters
              merged.parameters = (block.parameters || "") + parametersChunk;
            }
            return merged;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "APPEND_ERROR_BLOCK": {
      const { error } = action.payload;
      const newErrorBlock: ErrorBlock = { type: "error", content: error };

      // Append to the LAST message only if it is an assistant message — that
      // message is the current turn's in-flight reply. If the last message is
      // a user message (the previous turn's assistant already finished), the
      // error belongs BELOW that user message: create a new assistant message
      // to carry it instead of polluting the stale assistant from an earlier
      // turn (which surfaced the error above the latest user message).
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        const newBlocks = [...lastMessage.blocks, newErrorBlock];
        return {
          ...state,
          messages: state.messages.map((m, idx) =>
            idx === state.messages.length - 1 ? { ...m, blocks: newBlocks } : m,
          ),
        };
      }

      // Last message is a user message (or none yet). Create a new assistant
      // message to carry the error block instead of silently dropping it.
      const errorMessage: Message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        role: "assistant",
        timestamp: new Date().toISOString(),
        blocks: [newErrorBlock],
      };
      return {
        ...state,
        messages: [...state.messages, errorMessage],
      };
    }
    // Bang output rides on user-message tool blocks via the generic
    // APPEND_USER_MESSAGE / UPDATE_TOOL_BLOCK actions (bash mode adds a
    // user message + bash tool block; no dedicated bang actions needed).
    default:
      return state;
  }
}
