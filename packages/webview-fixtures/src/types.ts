/**
 * Host → webview message contract.
 *
 * Single authoritative definition of the postMessage channel used by every host
 * (VS Code extension, JetBrains plugin, Electron desktop) against the shared
 * webview. Both host-side tests and webview-side tests consume this type, so a
 * contract change (renamed field, dropped field, changed shape) makes both
 * layers red at the same time instead of one layer passing on mock-defined
 * expectations.
 *
 * `paneId` is optional: the desktop host tags every pane-scoped push with the
 * target pane's id; IDE hosts never send it (untagged messages are consumed by
 * the single webview instance / self-consumed per ChatApp).
 *
 * ## 归属契约（reply-to messages，P3 键控契约）
 *
 * host→webview 消息按归属语义分三类：
 *
 * 1. **快照/广播**（desktopSessionTree、contextUsage、updateStreamingContent、
 *    mcpServersResponse…）：全量状态推送，晚到 = 更新的事实，消费侧无需过期
 *    判断；pane 级推送由 base 的 `paneId` 路由。
 * 2. **请求-响应（reply-to）**：webview 先请求、host 后回复。**必须携带归属
 *    键**（见下方 `ReplyAttribution` 注册表），消费侧按两条标准模式处理：
 *    - 过期即弃：一次性查询比对 `requestId`（MessageInput fileSuggestions）
 *      或比对请求时登记的归属值（btw 面板比对 `question`）；
 *    - 渲染期键控过滤：state 存归属值、渲染期派生比对当前作用域（#2073
 *      desktopGitBranches 按 workdir），晚到的旧回复永不匹配当前作用域——
 *      不在 effect 里清空 state，避免中间帧闪现。
 * 3. **命令事件**（showToast、focusInput、prefillPrompt、triggerShortcut…）：
 *    host 主动命令，无请求-响应配对，不需要归属键。
 *
 * 新增请求-响应消息时：接口把归属键声明为**必填**并把 `command → 键名` 登记
 * 进 `ReplyAttribution`——漏带归属键会在 fixtures 的编译期断言处直接报类型
 * 错误，而不是运行时才暴露「晚到回复覆盖新状态」。
 */

// SDK types come from the light entry (same types the UI consumers import;
// avoids deep dist paths).
import type {
  Message,
  Task,
  PermissionMode,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SessionMetadata,
  SessionData,
  ToolBlockUpdateCallbackParams,
  UserPreferenceKey,
  UserPreferenceSource,
  RemoteControlSnapshot,
} from "wave-agent-sdk/types";

export type {
  Message,
  Task,
  PermissionMode,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  ToolBlockUpdateCallbackParams,
  SessionMetadata,
  SessionData,
};

// ---- Webview-owned shapes (copied structurally — the fixtures package must
// not depend on the webview package or a dependency cycle forms). ----

export type EffectiveTheme = "light" | "dark";

/** Desktop theme preference (三态，设置页「全局设置」可选，仅 desktop 有 UI）。 */
export type ThemeSource = "system" | "light" | "dark";

/** Desktop update channel（设置页「全局设置」「接收 Beta 版更新」开关，仅
 *  desktop 有 UI）。stable = codechat 正式下载 feed，beta = desktop-beta feed。 */
export type UpdateChannel = "stable" | "beta";

/** Desktop conversation-level side panels. VSCE/JetBrains never render these. */
export type DesktopPanelKind =
  | "preview"
  | "diff"
  | "terminal"
  | "file"
  | "plan";

/** State of the desktop file panel, pushed via `desktopFileContent`. */
export interface FileViewState {
  path: string;
  host: string;
  loading?: boolean;
  error?: string;
  content?: string;
  startLine?: number;
  endLine?: number;
  truncated?: boolean;
  totalLines?: number;
  imageBase64?: string;
  /**
   * sha256 of the file's full bytes, present only when the panel holds the whole
   * text (no truncation, not an image/binary) — the optimistic-concurrency token
   * a save sends back. Absent ⇒ the file can't be edited in the panel.
   */
  contentHash?: string;
  /**
   * Host-decided: this file may be edited in the panel. Local session, path
   * inside the session workdir, complete text content. The webview never
   * derives this itself (a remote session or an out-of-workdir file is
   * read-only no matter what the webview can see).
   */
  editable?: boolean;
  /** Draft while the panel's edit mode is open. `undefined` ⇒ read-only view. */
  draft?: string;
  /** A `desktopSaveFile` request is in flight. */
  saving?: boolean;
  /**
   * The disk copy changed while a draft was open (agent write/edit succeeded, or
   * the user saved from an external editor). The draft is untouched; saving will
   * be refused by the host and needs an explicit overwrite.
   */
  diskChanged?: boolean;
  /** Last save failure, shown inside the panel (draft is kept). */
  saveError?: string;
}

export interface QueuedMessage {
  id?: string;
  type?: "message" | "bang";
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
  text?: string;
}

export interface SelectionInfo {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  selectedText: string;
  isEmpty: boolean;
}

export interface ConfirmationRequest {
  confirmationId: string;
  toolName: string;
  confirmationType: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  /** Edit/Write only: directory of an out-of-Safe-Zone target, when the host
   *  wants the dialog to offer adding it to the session Safe Zone. */
  outsideSafeZoneDirectory?: string;
}

export interface AttachedImage {
  id: string;
  data: string;
  mimeType: string;
  filename?: string;
  size?: number;
}

/**
 * 设置页配置载荷：**只有用户偏好键**（落 `~/.wave/settings.json`）。
 *
 * 模型选择（`model` / `fastModel`）不属于这里——它经底栏模型选择器走
 * `getConfiguredModels` / `setModel`。服务端地址虽为 SDK 既有状态，但其用户偏好
 * 落点（`env.WAVE_SERVER_URL`）可从设置页编辑，故 `serverUrl` 属于这里；宿主的
 * `authStatusResponse.serverUrl` 仍单独下发（由 CLI 的 `getAuthStatus` 解析）。
 */
export interface ConfigurationData {
  language?: string;
  /** Per-model input context window in K tokens (e.g. 200 = 200K), 16–1000 */
  contextLength?: number;
  /** Whether auto-memory extraction is enabled */
  autoMemoryEnabled?: boolean;
  /** Auto-memory extraction turn frequency, 1–100 */
  autoMemoryFrequency?: number;
  /** Wave 服务端地址（落 `env.WAVE_SERVER_URL`）。 */
  serverUrl?: string;
  /**
   * 行内补全使用的模型（settings.json 顶层 `completionModel`）。未设置时回退快速
   * 模型（spec ui/code-completion.md 故事 4）；候选清单与对话模型同源。
   */
  completionModel?: string;
  /** 是否启用行内补全（settings.json 顶层 `completionEnabled`，缺省为开）。 */
  completionEnabled?: boolean;
  /**
   * 每个用户偏好键的来源层（`remote` = 企业下发的组织配置 / `user` = 用户级
   * `~/.wave/settings.json` / `env` = 机器环境变量 / `default` = 谁都没提供）。
   * 设置为 `remote` 的键，设置页显示生效值 + 置灰 + 「由组织配置管理」。
   */
  preferenceSources?: Partial<Record<UserPreferenceKey, UserPreferenceSource>>;
  [key: string]: unknown;
}

export interface DesktopPaneInfo {
  paneId: string;
  sessionId?: string;
  host: string;
  width: number;
  row: number;
}

/** A session in the desktop sidebar tree, derived from the session index (FR-024). */
export interface DesktopSessionEntry {
  sessionId: string;
  title: string;
  lastActiveAt: number;
  /** 会话创建时间（毫秒）。侧边栏「创建日期」筛选按它分档；宿主恒下发（老索引
   *  条目在宿主侧回填为 lastActiveAt），缺失时筛选回落 lastActiveAt。 */
  createdAt?: number;
  /** True when this session lives in a worktree (delete also cleans up branch+dir). */
  hasWorktree: boolean;
  /** True while this session is generating — drives the per-session running dot (FR-031). */
  running?: boolean;
  /** True while a confirmation request (tool/plan/question) awaits the user — drives the waiting dot. */
  waitingConfirmation?: boolean;
  /** True when the session finished with new output the user has not viewed yet —
   *  drives the green dot (Figma 13656:5470「已完成打开后绿点消失」). The desktop
   *  host sets it when a turn ends while no pane shows this session, and clears it
   *  once the session is opened/focused in a pane.  */
  newCompleted?: boolean;
}

export interface DesktopSessionGroup {
  host: string;
  workdir: string;
  sessions: DesktopSessionEntry[];
}

/** One desktop pane's git branch state, pushed via `desktopGitBranches`. */
export interface GitBranchesResult {
  current?: string;
  branches?: string[];
  error?: unknown;
}

/** Streaming delta types shared by content/reasoning updates. */
export type StreamingStage = "start" | "streaming" | "end";

// ---- The contract union. Every case mirrors a `case` in ChatApp.tsx's
// handleMessage switch (plus host-only commands consumed outside the switch:
// desktopPanes/desktopSessionTree/desktopWorkdirState in DesktopApp.tsx,
// mcpServersResponse in McpDialog.tsx, historyResponse in HistorySearchPopup,
// desktopThemeChange in ChatApp). ----

export interface HostToWebviewMessageBase {
  paneId?: string;
}

export interface UpdateMessagesMessage extends HostToWebviewMessageBase {
  command: "updateMessages";
  messages: Message[];
  /**
   * 这份列表之前还有没有更早的消息。三端首屏只推一页（spec ui/message-rendering-system.md「首屏
   * 只进一页」），所以「整表替换」过来的也是一个窗口；缺席 = 老宿主推的是整条
   * 会话，开头就在这份列表里。
   */
  hasMore?: boolean;
}

/**
 * Reply to `loadOlderMessages` (spec remote-control.md「Web 页作为第五种宿主」场景
 * 11、spec ui/message-rendering-system.md「首屏只进一页」场景 3): the page pulled itself to the top
 * of a window it only ever had the tail of, so the host answers with the page
 * **before** that anchor — exclusive of it, chronological — for the webview to
 * prepend.
 *
 * 四个面都会问：三个本地宿主自 2026-10 起也只推一页（`supportsMessagePaging`），
 * 手机页的 shim 是这条链的原始实现。`requestId` 必须原样回传 —— 页面用它丢弃
 * 晚到的旧页。`hasMore: false` 是「这就是开头」：页面据此提示并停止再请求，而不
 * 是把一次上拉变成什么都没发生。
 */
export interface OlderMessagesMessage extends HostToWebviewMessageBase {
  command: "olderMessages";
  requestId: number;
  messages: Message[];
  hasMore: boolean;
}

/**
 * Reply to `loadOlderMessages` that could not be served (the relay link dropped,
 * the host did not answer). Its job is to end the page's in-flight state without
 * moving anything: spec 场景 12 keeps the reader's viewport where it is and
 * refuses to fall back to a tail re-pull, which would replace what they are
 * reading.
 */
export interface OlderMessagesErrorMessage extends HostToWebviewMessageBase {
  command: "olderMessagesError";
  requestId: number;
  error: string;
}

export interface UpdateTasksMessage extends HostToWebviewMessageBase {
  command: "updateTasks";
  tasks: Task[];
  isTaskListCollapsed?: boolean;
}

/**
 * 会话列表的状态标记：哪些对话**在等用户确认**、哪些**正在生成**（spec
 * remote-control.md「待确认只在它自己的对话里弹，对话状态在会话列表标出来」）。
 *
 * 两个 id 集合、而不是每会话一条元数据上的字段，因为它们来自两次不同的读且
 * 覆盖面不同：`listPendingPermissions` 报告**全部**会话的待确认（正因如此才能
 * 标记页面没在看的那条），`listDaemonSessions` 报告每条会话的忙闲。两者都是
 * **状态**（每条重新对齐路径都重读），不是可监听的过渡——宿主推的
 * `loadingChange` 只描述当前这条会话。
 *
 * 只有远控 Web 页（shim）发这条消息：它是唯一没有侧栏的宿主，会话列表就是它
 * 唯一能标记状态的地方；其余四端各有自己的会话行呈现（桌面端侧栏、IDE 的会话
 * 面板），不需要第二份实现。
 */
export interface UpdateSessionStatusMessage
  extends HostToWebviewMessageBase,
    SessionListStatus {
  command: "updateSessionStatus";
}

/** 会话列表的两类标记（远控 Web 页专用）。两个集合都**含当前会话**：是否把当前
 *  那条也标出来由列表自己定（「待确认」不标当前那条——它本来就弹着卡；「运行中」
 *  含当前那条——「我正在看的这条还在不在跑」正是列表要回答的问题）。
 *  同一对值既有广播（`updateSessionStatus`）也随快照下发（`setInitialState` 的
 *  `sessionStatus`）：快照重建列表时搭车、不重建时靠广播。 */
export interface SessionListStatus {
  /** 有待确认请求的会话 id。 */
  waiting: string[];
  /** 正在生成的会话 id。 */
  running: string[];
  /** 前台空闲、但还有后台任务在跑的会话 id（同一个注册表读出来的第三条事实：
   *  「看起来静止、其实还在干活」不能显示成静止）。缺席 = 这个宿主/这版构建不说。 */
  background?: string[];
  /** 建在 linked worktree 里的会话 id。**只**用来决定删除确认卡说不说工作树那段
   *  警告、按钮写「删除会话」还是「删除会话与工作树」——改动计数不在这里（那是按需
   *  现读的，见 `sessionWorktreeChanges`）。缺席 = 宿主不说 = 页面按「不是 worktree」
   *  处理，与旧宿主的行为一致。 */
  worktrees?: string[];
}

/**
 * Web Push 通知开关在页面上的四个事实（spec remote-control.md「锁屏也能知道——
 * 会话等着我、或者跑完了」）。
 *
 * 页面不做本地推断：能力位来自浏览器（有没有 Service Worker / `PushManager`），
 * 订阅位来自页面自己记的订阅 id，两者都随每次动作重发一遍，于是菜单渲染的永远是
 * **当前**事实而不是乐观猜测。`needsHomeScreen` 单独一档是因为 iOS 那种情况说
 * 「不支持」既正确又没用：能力缺失的原因是页面还没被添加到主屏幕（iOS 16.4 起
 * `PushManager` 只对主屏 web app 存在）。
 */
export interface PushState {
  /** 这个浏览器能不能用 Web Push。 */
  supported: boolean;
  /** 已经在中继登记了订阅——也就是「开关是开的」。 */
  subscribed: boolean;
  /** iOS 普通标签页：`supported: false` 的原因是「还没添加到主屏幕」。 */
  needsHomeScreen: boolean;
  /** 上一次动作的结果，空串表示没有异常要报（`denied` / `failed` 是两种失败）。 */
  reason: string;
}

/**
 * 通知开关的状态（spec 同上）：只在三个时点发——页面挂载时问一次、用户开一次、
 * 用户关一次——每次都把四个事实整组重发，所以两端不可能各记一半。
 *
 * 只有远控 Web 页会收到：它是唯一跑在浏览器里、有 Service Worker 与通知权限的
 * 宿主。其余四端没有对应物，也不渲染那个菜单项。
 */
export interface UpdatePushStateMessage
  extends HostToWebviewMessageBase,
    PushState {
  command: "pushState";
}

export interface UpdateBackgroundTasksMessage extends HostToWebviewMessageBase {
  command: "updateBackgroundTasks";
  tasks: BackgroundTaskSummary[];
}

export interface UpdateWorkflowRunsMessage extends HostToWebviewMessageBase {
  command: "updateWorkflowRuns";
  runs: SerializableWorkflowRun[];
}

export interface UpdateSelectionMessage extends HostToWebviewMessageBase {
  command: "updateSelection";
  selection: SelectionInfo;
}

export interface UpdatePermissionModeMessage extends HostToWebviewMessageBase {
  command: "updatePermissionMode";
  mode: PermissionMode;
}

export interface UpdateWorkdirMessage extends HostToWebviewMessageBase {
  command: "updateWorkdir";
  workdir?: string;
}

export interface DesktopGitBranchesMessage extends HostToWebviewMessageBase {
  command: "desktopGitBranches";
  /** The workdir this branch list was queried for — replies are keyed by it
   *  so the webview never shows a previous directory's result after a switch
   *  (render-time keying, #2073). Required: the desktop host echoes the
   *  requested workdir on every reply. */
  workdir: string;
  result?: GitBranchesResult;
}

/** Ack for desktopCreateWorktree — clears the webview's "worktree 创建中"
 * state on both success and failure. */
export interface DesktopWorktreeCreatedMessage
  extends HostToWebviewMessageBase {
  command: "desktopWorktreeCreated";
}

export interface DesktopForwardPortResultMessage
  extends HostToWebviewMessageBase {
  command: "desktopForwardPortResult";
  requestId: string;
  error?: unknown;
  url?: string;
}

export interface DesktopFileContentMessage extends HostToWebviewMessageBase {
  command: "desktopFileContent";
  fileView: FileViewState;
}

/** Reply to `desktopSaveFile` — the file panel's save result (desktop only).
 *  `conflict` means the disk copy no longer matches the hash the panel read, so
 *  nothing was written: the user must choose overwrite or reload. */
export interface DesktopFileSaveResultMessage extends HostToWebviewMessageBase {
  command: "desktopFileSaveResult";
  requestId: string;
  status: "saved" | "conflict" | "denied" | "error";
  /** Human-readable reason for denied/error/conflict, shown in the panel. */
  message?: string;
  /** New hash of the file on disk (on success), or the current disk hash when
   *  the save was refused as a conflict. */
  contentHash?: string;
}

/** Reply to desktopPreviewFile — the loopback URL re-hosting the .html file
 *  for the preview pane, or `error` when the file can't be previewed (the
 *  webview then falls back to the file panel, spec desktop-preview.md
 *  「本地 HTML 文件预览」 scenario 4). */
export interface DesktopPreviewFileResultMessage
  extends HostToWebviewMessageBase {
  command: "desktopPreviewFileResult";
  requestId: string;
  url?: string;
  error?: string;
}

export interface UpdateQueueMessage extends HostToWebviewMessageBase {
  command: "updateQueue";
  queue: QueuedMessage[];
}

export interface UpdateQueuedMessageMissingMessage
  extends HostToWebviewMessageBase {
  command: "updateQueuedMessageMissing";
}

export interface UpdateCommandRunningMessage extends HostToWebviewMessageBase {
  command: "updateCommandRunning";
  running: boolean;
}

export interface RewindCheckpointsMessage extends HostToWebviewMessageBase {
  command: "rewindCheckpoints";
  checkpoints?: Array<{
    messageId: string;
    time: string;
    isMeta: boolean;
    content: string;
    [key: string]: unknown;
  }>;
}

/** Reply to a `rewindToMessage` request: whether the truncation happened.
 *
 * Truncation is destructive but it carries **no payload** — the webview holds
 * the anchor (`messageId` it asked for) and the list it is displaying, so it
 * cuts its own copy with the same rule the host uses (keep everything before
 * the **last** occurrence of `messageId`). Re-sending the list would cost a
 * full snapshot per rewind. `ok: false` means nothing was truncated and the
 * list must be left untouched. */
export interface RewindResultMessage extends HostToWebviewMessageBase {
  command: "rewindResult";
  requestId: string;
  messageId: string;
  ok: boolean;
  error?: string;
}

export interface BtwStreamMessage extends HostToWebviewMessageBase {
  command: "btwStream";
  question: string;
  type?: string;
  content?: string;
}

export interface BtwResponseMessage extends HostToWebviewMessageBase {
  command: "btwResponse";
  question: string;
  answer?: string;
}

export interface BtwErrorMessage extends HostToWebviewMessageBase {
  command: "btwError";
  question: string;
  error?: unknown;
}

export interface StartStreamingMessage extends HostToWebviewMessageBase {
  command: "startStreaming";
}

export interface EndStreamingMessage extends HostToWebviewMessageBase {
  command: "endStreaming";
}

export interface EnsureUIResetMessage extends HostToWebviewMessageBase {
  command: "ensureUIReset";
}

export interface UpdateSessionsMessage extends HostToWebviewMessageBase {
  command: "updateSessions";
  sessions: SessionMetadata[];
}

export interface UpdateCurrentSessionMessage extends HostToWebviewMessageBase {
  command: "updateCurrentSession";
  session?: SessionMetadata;
}

/** Reply to a `renameSession` request (spec session-management.md「会话自定义标题
 *  （重命名）」/ desktop-sessions.md 同故事): the host relays the rename to the
 *  session's owning host and reports the outcome. The webview applied the title
 *  optimistically, so `ok: false` means "roll back and surface `error`". */
export interface SessionRenamedMessage extends HostToWebviewMessageBase {
  command: "sessionRenamed";
  requestId: string;
  sessionId: string;
  title: string;
  ok: boolean;
  error?: string;
}

export interface ShowConfirmationMessage extends HostToWebviewMessageBase {
  command: "showConfirmation";
  confirmationId: string;
  toolName: string;
  confirmationType: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  /** Edit/Write only: directory of an out-of-Safe-Zone target, when the host
   *  wants the dialog to offer adding it to the session Safe Zone. */
  outsideSafeZoneDirectory?: string;
}

/** Desktop /plan display: the host pushes the current plan file contents to
 *  the shared Plan pane (opened on first delivery, like ExitPlanMode plans). */
export interface PlanContentMessage extends HostToWebviewMessageBase {
  command: "planContent";
  content: string;
}

/** The agent wrote the plan file (spec plan-mode.md「计划文件更新后刷新计划面板」):
 *  the host pushes the fresh contents so an already-open Plan pane updates live.
 *  Unlike `planContent` this never opens the pane — a closed panel stays closed. */
export interface PlanFileUpdatedMessage extends HostToWebviewMessageBase {
  command: "planFileUpdated";
  content: string;
}

export interface ConfigurationResponseMessage extends HostToWebviewMessageBase {
  command: "configurationResponse";
  configurationData: ConfigurationData;
}

/** Reply to getProjectSettings / setBuiltinPluginEnabled（项目设置视图 SDD 开关）. */
export interface ProjectSettingsMessage extends HostToWebviewMessageBase {
  command: "projectSettings";
  enabledPlugins: Record<string, boolean>;
  /** 归属键：本回复对应的项目工作目录（host 端以请求所用 workdir 恒回带）。
   *  消费侧据此丢弃切目录/切会话后才落地的慢回复（过期即弃），并以此作为
   *  缓存键（SessionUiStore projectSettings 快照按 workdir 维度存放）。 */
  workdir: string;
}

/** Settings page hooks read-only view: scope-scoped settings.json hooks. */
export interface HooksConfigResponseMessage extends HostToWebviewMessageBase {
  command: "hooksConfigResponse";
  /** 归属键：回复所属的配置作用域（host 端以 `scope ?? "user"` 恒回带），
   *  消费侧据此丢弃切 Tab 前发出的慢回复。 */
  scope: "user" | "project";
  hooks?: Record<string, unknown>;
}

/** Settings page MCP read-only view: scope-scoped mcp.json servers config. */
export interface McpConfigResponseMessage extends HostToWebviewMessageBase {
  command: "mcpConfigResponse";
  /** 归属键：同 hooksConfigResponse.scope。 */
  scope: "user" | "project";
  mcpServers: Record<string, unknown>;
}

export interface SetInitialStateMessage extends HostToWebviewMessageBase {
  command: "setInitialState";
  messages: Message[];
  /** 只允许 rewind 路径置真：宿主已按同一条规则本地切完自己的缓存，因此这一份
   *  快照只更新其余字段，让 webview 保留它刚切好的列表，省掉整份列表的重传。
   *  切会话 / 新建会话 / 恢复完成**不得**使用 —— 那些场景 webview 的列表本来
   *  就不对，必须靠 `messages` 覆盖。 */
  keepMessages?: boolean;
  /** 这份快照里的 `messages` 之前还有没有更早的。三端首屏只推一页，所以初值是
   *  宿主算的（`total > messages.length`），不是页面猜的。缺席 = 老宿主。 */
  historyExhausted?: boolean;
  /** 宿主答不答得了 `loadOlderMessages`。能力位而不是常量：页面是远端加载的，
   *  老宿主不该收到一条它不认识的命令。缺席 = 不能。 */
  supportsMessagePaging?: boolean;
  tasks: Task[];
  backgroundTasks: BackgroundTaskSummary[];
  workflowRuns: SerializableWorkflowRun[];
  isStreaming: boolean;
  isCommandRunning: boolean;
  isCompacting?: boolean;
  isTaskListCollapsed?: boolean;
  isRestoring?: boolean;
  sessions: SessionMetadata[];
  session?: SessionMetadata;
  currentSession?: SessionMetadata;
  /** 仅 IDE 宿主（VSCE/JetBrains）随快照携带；desktop 走窗口级
   *  configurationResponse（分屏下 root 实例不消费带 paneId 的快照，而渲染设置页
   *  的正是 root）。 */
  configurationData?: ConfigurationData;
  /** 会话作用域快照：desktop 把「本 pane 的会话状态」打上 paneId 下发。窗口级
   *  数据（主题偏好 / 更新通道）**不得**放进这里，一律走未打标签的窗口级广播
   *  desktopThemeChange / desktopThemeSource / desktopUpdateChannel。 */
  pendingConfirmations: ConfirmationRequest[];
  pendingConfirmation?: ConfirmationRequest;
  selection?: SelectionInfo;
  inputContent?: string;
  permissionMode?: PermissionMode;
  attachedImages?: AttachedImage[];
  queuedMessages: QueuedMessage[];
  /** 会话列表的两类标记（远控 Web 页专用，见 `SessionListStatus`）：与
   *  `updateSessionStatus` 的同一对值，只是搭快照的便车一次上屏。其余宿主不携带
   *  —— 缺席时 webview 保留自己手里的那一份（不清空）。 */
  sessionStatus?: SessionListStatus;
  isAuthenticated: boolean;
  workdir?: string;
}

export interface DesktopThemeChangeMessage extends HostToWebviewMessageBase {
  command: "desktopThemeChange";
  effective: EffectiveTheme;
}

/** Desktop theme preference change broadcast (source 设置变更后同步各实例)。 */
export interface DesktopThemeSourceMessage extends HostToWebviewMessageBase {
  command: "desktopThemeSource";
  source: ThemeSource;
}

/** Desktop update channel change broadcast (设置页开关变更后同步各实例)。 */
export interface DesktopUpdateChannelMessage extends HostToWebviewMessageBase {
  command: "desktopUpdateChannel";
  channel: UpdateChannel;
}

/** Action a toast's button triggers when clicked (host-side semantics). Only
 *  一种语义：「聚焦后台会话」（后台会话确认 toast 的「查看」按钮）。更新下载/重启
 *  早已由账户卡片 S0–S6 按钮状态机接管，未登录 GitHub 下载页的 toast 也随
 *  updateChecker 一并删除（2026-09-09/2026-09-10 拍板），故动作变体只剩这一种。 */
export type ToastAction = {
  type: "focusSession";
  host: string;
  sessionId: string;
};

/** Toast 语义类型（与 packages/webview/src/types/index.ts 同步）：**只有设置页
 *  结果型提示标注**（spec desktop-account-and-settings「设置页反馈语义」，
 *  2026-09-10 设计师拍板）——成功/失败/信息配 soft 底 + 同色 icon/text（不只靠色）。
 *  **缺省（其余应用级提示）= 中性**：默认底色、不渲染语义图标（缺省不得回退为
 *  某个彩色语义）。 */
export type ToastKind = "success" | "info" | "error";

/** Toast 显示位置（与 packages/webview/src/types/index.ts 同步）——由宿主**显式**
 *  声明这条提示显示在哪个位置；不以「是否带 action」隐式推断（将来可能有带按钮
 *  的应用级 toast）：
 *  - `"top"`（缺省）：应用级全局提示 → 桌面端顶部居中 toast 条（锚定内容列、
 *    语义图标、落下动效）；
 *  - `"bottomRight"`：后台会话确认提示（「会话「…」需要确认」，带「查看」按钮）→
 *    **保持改动前的右下角 VS Code 风格通知形态，不并入顶部新形态**。 */
export type ToastPosition = "top" | "bottomRight";

/** A non-modal in-app toast (desktop host only). position "top"（缺省）渲染为顶部
 *  居中 toast 条；"bottomRight" 渲染为右下角通知栈；两栈可同屏共存。 */
export interface UpdateToast {
  id: string;
  message: string;
  position?: ToastPosition;
  type?: ToastKind;
  actionLabel?: string;
  action?: ToastAction;
  /** The toast's action is being performed — render a loading state instead of
   *  the action button (e.g. opening a download page while the browser launches). */
  loading?: boolean;
}

export interface ShowToastMessage extends HostToWebviewMessageBase {
  command: "showToast";
  toast: UpdateToast;
}

/**
 * 插件变更已落盘、尚未应用（spec ecosystem/plugin.md「插件变更提示」，
 * 2026-09-23 起）：桌面端改由 webview 弹一个**强引导**确认框——顶部轻提示会被
 * 用户忽略，插件装完不运行 `/reload-plugins` 就不生效。无载荷；用户点「立即
 * 重新加载」后 webview 回发既有的 `reloadPlugins` 命令，宿主走与斜杠命令同一条
 * 就地重载路径。
 *
 * 一次性事件，不是状态：不落任何持久标识，收到即弹（重复收到不叠加）。
 */
export interface PluginChangePendingMessage extends HostToWebviewMessageBase {
  command: "pluginChangePending";
}

export interface DesktopTogglePanelMessage extends HostToWebviewMessageBase {
  command: "desktopTogglePanel";
  kind: DesktopPanelKind;
}

export interface ShowDialogMessage extends HostToWebviewMessageBase {
  command: "showDialog";
  dialogType: string;
}

export interface ConfigurationUpdatedMessage extends HostToWebviewMessageBase {
  command: "configurationUpdated";
}

export interface StatusResponseMessage extends HostToWebviewMessageBase {
  command: "statusResponse";
  configurationData?: ConfigurationData;
}

/**
 * Reply to the webview's `remoteControl` request (the `/remote-control`
 * dialog): the host asked its own `wave --stdio` child what the outbound relay
 * link looks like, and forwards the child's snapshot verbatim.
 *
 * Exactly one of the two fields is set: a snapshot when the child answered, a
 * message when the RPC itself failed. The two are different situations and the
 * dialog says so differently — a failing relay is a snapshot with
 * `state: "error"` (built by the service and worth reading), while an RPC
 * failure means this process has no relay link at all, almost always because
 * `enableRemoteControl` is off (the child's own error text says which key to
 * set, so it is forwarded verbatim rather than paraphrased here).
 */
export interface RemoteControlResponseMessage extends HostToWebviewMessageBase {
  command: "remoteControlResponse";
  requestId: string;
  snapshot?: RemoteControlSnapshot;
  error?: string;
}

export interface ConfigurationErrorMessage extends HostToWebviewMessageBase {
  command: "configurationError";
  error: unknown;
}

export interface FocusInputMessage extends HostToWebviewMessageBase {
  command: "focusInput";
}

export interface TriggerShortcutMessage extends HostToWebviewMessageBase {
  command: "triggerShortcut";
  name: string;
}

export interface ScrollToBottomMessage extends HostToWebviewMessageBase {
  command: "scrollToBottom";
}

export interface AppendMessageMessage extends HostToWebviewMessageBase {
  command: "appendMessage";
  message: Message;
}

/**
 * 丢弃一条已经渲染出来的消息：产生它的流式尝试正文中途断连，宿主改为非流式
 * 重发（规格：流式响应正文中途断连时降级为非流式重发）。属于命令事件——host
 * 主动推送、无请求-响应配对，因此不需要归属键。
 */
export interface DiscardMessageMessage extends HostToWebviewMessageBase {
  command: "discardMessage";
  messageId: string;
}

export interface CompactionStateChangeMessage extends HostToWebviewMessageBase {
  command: "compactionStateChange";
  isCompacting: boolean;
}

export interface CompactionContentUpdateMessage
  extends HostToWebviewMessageBase {
  command: "compactionContentUpdate";
  content: string;
}

export interface UpdateStreamingContentMessage
  extends HostToWebviewMessageBase {
  command: "updateStreamingContent";
  messageId: string;
  chunk: string;
  stage?: StreamingStage;
}

export interface UpdateStreamingReasoningMessage
  extends HostToWebviewMessageBase {
  command: "updateStreamingReasoning";
  messageId: string;
  chunk: string;
  stage?: "end" | "streaming";
}

export interface UpdateToolBlockMessage extends HostToWebviewMessageBase {
  command: "updateToolBlock";
  params: ToolBlockUpdateCallbackParams;
}

export interface UpdateErrorBlockMessage extends HostToWebviewMessageBase {
  command: "updateErrorBlock";
  error: unknown;
}

export interface AuthStatusResponseMessage extends HostToWebviewMessageBase {
  command: "authStatusResponse";
  isAuthenticated: boolean;
  /** Authenticated account (desktop host forwards it for the account card). */
  user?: { id: string; email?: string } | null;
  /**
   * 服务地址（CLI 侧 `getAuthStatus` 解析后回传，宿主只缓存/转发）。webview 的
   * 唯一来源：企业控制台 / 帮助文档按钮（serverUrl + `/docs/`）与桌面端
   * 「接收 Beta 版更新」开关的可用性都由它驱动。未登录或查询失败时宿主可省略
   * （保持上一次的值，不视为"无服务地址"）。
   */
  serverUrl?: string;
}

/** Reply to a getAgentsContent request (settings UI AGENTS.md editor). */
export interface AgentsContentResponseMessage extends HostToWebviewMessageBase {
  command: "agentsContentResponse";
  /** "user" reads ~/.wave/AGENTS.md, "project" reads <workdir>/AGENTS.md. */
  scope: "user" | "project";
  content: string;
}

/** Reply to a setAgentsContent request (settings UI AGENTS.md editor). */
export interface AgentsContentSavedMessage extends HostToWebviewMessageBase {
  command: "agentsContentSaved";
  scope: "user" | "project";
  ok: boolean;
  error?: string;
}

/**
 * Context-window usage push for the 压缩上下文 button (percentage of the
 * current context window consumed, 0–100). Sent by the host when usage
 * changes (message stream, compaction, session switch).
 */
export interface ContextUsageMessage extends HostToWebviewMessageBase {
  command: "contextUsage";
  /** Percentage of the context window used, rounded up (0–100). */
  percent: number;
}

export interface LoginResponseMessage extends HostToWebviewMessageBase {
  command: "loginResponse";
  success: boolean;
  /** Authenticated account (desktop host forwards it for the account card). */
  user?: { id: string; email?: string } | null;
}

export interface LogoutResponseMessage extends HostToWebviewMessageBase {
  command: "logoutResponse";
  success: boolean;
}

/**
 * 套餐两根额度条的四个数 + 到期日（codechat `GET /api/v1/account` → `billing.plan`）。
 * 窗口口径与计费闸口同源：滚动月跟套餐开通日、自然周为周一，下界再与开通时刻取较晚——
 * 这些都在服务端算好，客户端只渲染。限额三态：`null` = 不限制（不画条）、
 * `0` = 该维度不可用（不画条）、正数 = 限额。
 */
export interface AccountBillingPlanUsage {
  monthUsed: number;
  /** 滚动月限额；null = 不限制（不画条），0 = 该维度不可用. */
  monthLimit: number | null;
  weekUsed: number;
  /** 自然周限额；null = 不限制（不画条），0 = 该维度不可用. */
  weekLimit: number | null;
  /** 套餐到期日（YYYY-MM-DD）. */
  expireDate: string;
}

/** 计费降级原因（codechat `BillingDegradeReason`）：客户端据此选结论行文案. */
export type AccountBillingDegradeReason =
  | "month"
  | "week"
  | "enterprise"
  | "no_plan"
  | "dimension_unavailable";

/** 计费阻断码（codechat `BillingCode`）：客户端按 code 复用 proxy 402 的同一句文案. */
export type AccountBillingCode =
  | "EXPIRED_NO_API"
  | "USER_QUOTA_ZERO"
  | "TEAM_QUOTA_ZERO";

/**
 * 计费结论（codechat 形态甲：闸口镜像）。判定由后端 `getBillingVerdict` 下发——与 proxy
 * 扣费**同一份代码**；客户端只渲染、**不自行判断「走套餐还是走 API」**。`plan` 子对象：
 * 有生效套餐 = 四数 + 到期日；无生效套餐但有**未作废**的已到期订单 = 仅 `{ expireDate }`；
 * 从未购买、或订单已全部作废 = null（作废不是到期，`status='active'` 与生效分支同谓词）。
 */
export type AccountBillingInfo =
  | { mode: "plan"; plan: AccountBillingPlanUsage }
  | {
      mode: "api";
      reason: AccountBillingDegradeReason;
      plan: AccountBillingPlanUsage | { expireDate: string } | null;
    }
  | { mode: "blocked"; code: AccountBillingCode };

/** API 额度 (codechat `GET /api/v1/account` → `apiQuota`). */
export interface AccountApiQuotaInfo {
  /** 额度上限（元）；null = 不限额. */
  limit: number | null;
  used: number;
}

/**
 * 桌面端应用更新状态（spec desktop-account-and-settings.md「账户卡片 ·
 * 更新按钮状态机 S0–S6」）。宿主把 electron-updater 事件映射为 status 并随
 * `desktopAccountInfo` 快照下发；webview 侧据此渲染卡片更新按钮与确认对话框。
 */
export interface AccountUpdateInfo {
  /** 检测到新版本（无更新时宿主可不带 update 或置 false）。 */
  available: boolean;
  /** 新版本号（S2 对话框 / 按钮 tooltip 文案使用）。 */
  version?: string;
  /** 更新过程状态：idle=未开始/已失败复位；downloading=宿主下载中；ready=已就绪待重启。 */
  status?: "idle" | "downloading" | "ready";
}

/**
 * 桌面侧边栏账户卡片快照 (spec desktop-account-and-settings.md「账户卡片」). Window-global like
 * showToast — the sidebar renders on the root webview instance only, so the
 * host never pane-tags it. Auth/usage follow the focused pane's host.
 */
export interface DesktopAccountInfoMessage extends HostToWebviewMessageBase {
  command: "desktopAccountInfo";
  isAuthenticated: boolean;
  user?: { id: string; email?: string } | null;
  /** 套餐两根额度条 + 到期日 + 计费结论；null = 无（未购买/未登录）。 */
  billing?: AccountBillingInfo | null;
  apiQuota?: AccountApiQuotaInfo | null;
  /** 应用更新状态（S0–S6 按钮状态机输入）；未下发/available=false = 无更新。 */
  update?: AccountUpdateInfo | null;
}

// ---- Host-only commands (consumed outside the ChatApp switch). ----

/**
 * macOS 窗口全屏状态推送 (spec desktop-shell.md「macOS 隐藏标题栏」场景 7).
 * Window-global: fullscreen hides the system traffic lights, so the webview
 * collapses its traffic-light clearance (window-row gutter / collapsed-header
 * spacer) until leaving fullscreen.
 */
export interface DesktopFullScreenMessage extends HostToWebviewMessageBase {
  command: "desktopFullScreen";
  fullScreen: boolean;
}

export interface DesktopPanesMessage extends HostToWebviewMessageBase {
  command: "desktopPanes";
  panes: DesktopPaneInfo[];
  rowHeights?: [number, number];
  focusedPaneId?: string;
}

export interface DesktopSessionTreeMessage extends HostToWebviewMessageBase {
  command: "desktopSessionTree";
  groups: DesktopSessionGroup[];
}

export interface DesktopWorkdirStateMessage extends HostToWebviewMessageBase {
  command: "desktopWorkdirState";
  workdir?: string;
  host: string;
  hosts: string[];
  recentWorkdirs: string[];
}

export interface McpServersResponseMessage extends HostToWebviewMessageBase {
  command: "mcpServersResponse";
  servers: unknown[];
}

export interface SubagentConfigurationsResponseMessage
  extends HostToWebviewMessageBase {
  command: "subagentConfigurationsResponse";
  configurations: unknown[];
}

export interface SkillMetadataResponseMessage extends HostToWebviewMessageBase {
  command: "skillMetadataResponse";
  skills: unknown[];
}

export interface HooksResponseMessage extends HostToWebviewMessageBase {
  command: "hooksResponse";
  /** 归属键：回复所属的配置作用域（host 端以请求 scope 恒回带），消费侧
   *  （useSettingsList attributionKey）据此丢弃切 Tab 前发出的慢回复。 */
  scope: "user" | "project" | "plugin";
  hooks: Record<string, unknown[]>;
  /** 该 scope 钩子所在 settings.json 路径（删除确认框展示用），可空 */
  configPath?: string | null;
}

export interface McpConfigPathsResponseMessage
  extends HostToWebviewMessageBase {
  command: "mcpConfigPathsResponse";
  userPath: string | null;
  projectPath: string | null;
}

export interface HistoryResponseMessage extends HostToWebviewMessageBase {
  command: "historyResponse";
  /** 归属键：请求生成的 id（requestHistory/searchHistory 原样带回）。历史
   *  弹窗按 debounce 连续发查询，晚到的旧查询回复会被 requestId 比对丢弃
   *  （过期即弃，fileSuggestionsResponse 同款范例）。 */
  requestId: string;
  history: SessionMetadata[];
}

// ---- MessageInput-owned replies (consumed outside the ChatApp switch). ----

/** Reply to a requestFileSuggestions query (@ 提及文件建议). MessageInput
 *  keeps the latest request's id and drops replies whose requestId does not
 *  match — 过期即弃（一次性查询归属键的标准范例）。 */
export interface FileSuggestionsResponseMessage
  extends HostToWebviewMessageBase {
  command: "fileSuggestionsResponse";
  requestId: string;
  suggestions: unknown[];
}

export interface FileSuggestionsErrorMessage extends HostToWebviewMessageBase {
  command: "fileSuggestionsError";
  requestId: string;
  error: unknown;
}

// ---- IDE 上下文提及（@terminal / @problems，spec ui/ide-context-mentions.md）----
//
// 只在 IDE 插件宿主（VS Code / JetBrains）成立：webview 在发送那一刻向宿主取
// 一次内容，把结果拼进用户消息正文，之后历史重放不再访问 IDE。宿主只负责「读
// 数据」（两端 IDE API 本就不同），标题、排序、上限、转义清理都在共享 webview
// 里做——同一套格式逻辑不写两遍（TS + Kotlin）。

/** webview 能 @ 出来的 IDE 上下文类别。 */
export type IdeContextProvider = "terminal" | "problems";

/** 一条诊断。宿主只报 ERROR/WARNING 级，行/列按 1 起算。 */
export interface IdeContextProblem {
  /** 1 起的行号 */
  line: number;
  /** 1 起的列号 */
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  /** 诊断来源（tsc / eslint …），可缺 */
  source?: string;
}

/** 单个类别的读取结果。ok=false 时 `reason` 是给用户看的可读原因
 *  （没有活动终端 / 没有活动编辑器 / 内部 API 不可用），webview 据此在消息
 *  里写一行说明——失败不中断发送，也不弹窗。 */
export interface IdeContextResult {
  provider: IdeContextProvider;
  ok: boolean;
  /** terminal：活动终端最后一条命令及其输出（原始文本，未清理转义） */
  terminalText?: string;
  /** problems：该文件的诊断条目（webview 负责排序、截断、格式化） */
  problems?: IdeContextProblem[];
  /** problems：诊断所属文件（仓库相对路径优先） */
  filePath?: string;
  /** ok=false 时的可读原因 */
  reason?: string;
}

/** Reply to `requestIdeContext`. 归属键 requestId：一次发送一笔请求，超时或
 *  用户连发时晚到的旧回复即弃（fileSuggestionsResponse 同款范例）。 */
export interface IdeContextResponseMessage extends HostToWebviewMessageBase {
  command: "ideContextResponse";
  requestId: string;
  results: IdeContextResult[];
}

export interface SlashCommandsResponseMessage extends HostToWebviewMessageBase {
  command: "slashCommandsResponse";
  commands: Array<{
    id: string;
    name: string;
    description?: string;
    /** Source tag of a skill-backed command (内置/用户/项目/插件). Skill rows
     *  only — plain/custom/plugin commands omit it. */
    skillSource?: "builtin" | "user" | "project" | "plugin";
    /** 选中即执行：宿主自己处理的本地 UI 指令（打开弹窗/设置页/面板），选中后
     *  把 `/名字` 发回宿主，而不是把命令名插进输入框等用户补参数。技能命令、
     *  磁盘自定义命令、插件命令与需要补参数的 `/btw` 都不带它。
     *
     *  这条判据随命令一起下发——三个宿主各自维护自己的本地指令表，webview 不再
     *  另存一份命令名名单（它们必然是两份，加命令时漏同步就让指令落进「插入文本」
     *  分支）。 */
    runOnSelect?: boolean;
  }>;
}

export interface SlashCommandsErrorMessage extends HostToWebviewMessageBase {
  command: "slashCommandsError";
  error: unknown;
}

export interface UploadSuccessMessage extends HostToWebviewMessageBase {
  command: "uploadSuccess";
  uploadedFiles: string[];
}

export interface UploadErrorMessage extends HostToWebviewMessageBase {
  command: "uploadError";
  error: unknown;
}

/** Remote directory listing reply for the desktop workdir browser. */
export interface DesktopRemoteDirListMessage extends HostToWebviewMessageBase {
  command: "desktopRemoteDirList";
  requestId: string;
  resolvedPath?: string;
  dirs?: string[];
  error?: unknown;
}

/**
 * Reply to `desktopListResumeSessions`：桌面端 `/resume` 的会话列表。
 *
 * 来源是**当前对话所属主机**磁盘上的会话文件（该主机全部项目目录），包含桌面端
 * 从未创建、因而不在会话索引里的会话（CLI / 其它客户端写的）——每条带真实
 * `workdir`，选中后据此恢复。`error` 非空表示该主机不可达或读取失败：此时
 * webview 关闭选择器（host 另行 toast 提示），不得把它当作"没有历史会话"的空
 * 列表渲染。
 */
export interface DesktopResumeSessionsMessage extends HostToWebviewMessageBase {
  command: "desktopResumeSessions";
  requestId: string;
  sessions?: SessionMetadata[];
  error?: unknown;
}

/** Reply to selectPluginMarketFolder：设置页插件市场「新建市场 → 本地路径」的
 *  系统目录选择器结果。用户取消时 path 缺省（webview 视为未选择、不添加市场）。 */
export interface PluginMarketFolderSelectedMessage
  extends HostToWebviewMessageBase {
  command: "pluginMarketFolderSelected";
  requestId: string;
  path?: string;
}

/** What deleting a worktree session would throw away (uncommitted files and
 *  commits the base branch does not have). `null` = the worktree could not be
 *  inspected (host unreachable, not a repo, already gone) — the caller falls
 *  back to a generic warning instead of claiming the worktree is clean. */
export interface DesktopWorktreeChangesMessage
  extends HostToWebviewMessageBase {
  command: "desktopWorktreeChanges";
  requestId: string;
  sessionId: string;
  changes: { files: number; commits: number } | null;
}

/**
 * 创作集（Artifacts 画廊）：账号级数据，桌面端独有。
 *
 * 归属键一律 `requestId`（页面可反复刷新、分享弹层可反复开关、成员检索按输入
 * 连续查询），晚到的旧回复按 requestId 丢弃。
 */
export type ArtifactShareMode = "owner" | "users" | "org";

export interface ArtifactGalleryItem {
  slug: string;
  title: string;
  rel: "mine" | "shared";
  updatedAt?: string;
  favicon?: string;
  /** 发布者账号；`rel = shared` 时是分享者。服务端未返回时缺省。 */
  ownerEmail?: string;
  /** 分享范围；`rel = shared` 的行由对方管理，通常缺省。 */
  shareMode?: ArtifactShareMode;
  /** 指定成员账号（`shareMode = users` 时才有）。 */
  sharedEmails?: string[];
}

export interface ArtifactMemberCandidate {
  userId: string;
  email: string;
}

export interface ArtifactVersionOption {
  version: number;
  label?: string | null;
  title?: string | null;
}

/** 创作集列表回复（`desktopArtifactsList`）。 */
export interface DesktopArtifactsListMessage extends HostToWebviewMessageBase {
  command: "desktopArtifactsList";
  requestId: string;
  items?: ArtifactGalleryItem[];
  error?: string;
  /** 401/403：页面渲染「请先登录」，不得当成空列表。 */
  authRequired?: boolean;
}

/** 单个创作的分享状态回显（`desktopArtifactShareView`）。 */
export interface DesktopArtifactShareViewMessage
  extends HostToWebviewMessageBase {
  command: "desktopArtifactShareView";
  requestId: string;
  slug: string;
  mode?: ArtifactShareMode;
  pinnedVersion?: number | null;
  sharedUsers?: ArtifactMemberCandidate[];
  versions?: ArtifactVersionOption[];
  error?: string;
  authRequired?: boolean;
  notFound?: boolean;
}

/** 保存分享范围的结果（`desktopArtifactShareSave`）。 */
export interface DesktopArtifactShareSaveMessage
  extends HostToWebviewMessageBase {
  command: "desktopArtifactShareSave";
  requestId: string;
  slug: string;
  mode?: ArtifactShareMode;
  userIds?: string[];
  pinnedVersion?: number | null;
  error?: string;
  authRequired?: boolean;
  notFound?: boolean;
}

/** 成员检索结果（`desktopArtifactMembersSearch`），供分享弹层勾选。 */
export interface DesktopArtifactMembersMessage
  extends HostToWebviewMessageBase {
  command: "desktopArtifactMembersSearch";
  requestId: string;
  members?: ArtifactMemberCandidate[];
  error?: string;
  authRequired?: boolean;
}

/** 撤销发布结果（`desktopArtifactRevoke`）。 */
export interface DesktopArtifactRevokeMessage extends HostToWebviewMessageBase {
  command: "desktopArtifactRevoke";
  requestId: string;
  slug: string;
  ok?: boolean;
  error?: string;
  authRequired?: boolean;
  notFound?: boolean;
}

/** 一个自定义分类（本机存储，按账号隔离）。 */
export interface ArtifactCategory {
  id: string;
  name: string;
}

/** 分类与本机归属读取结果（`desktopArtifactCategoriesGet`）。 */
export interface DesktopArtifactCategoriesMessage
  extends HostToWebviewMessageBase {
  command: "desktopArtifactCategories";
  requestId: string;
  categories: ArtifactCategory[];
  /** slug → 分类 id（一个文件最多一个分类）。 */
  assignments: Record<string, string>;
  error?: string;
}

/** 分类归属写入结果（`desktopArtifactCategoriesSave`）。 */
export interface DesktopArtifactCategoriesSavedMessage
  extends HostToWebviewMessageBase {
  command: "desktopArtifactCategoriesSaved";
  requestId: string;
  ok: boolean;
  error?: string;
}

// ---- Contract gaps (commands hosts really send / the webview really
// consumes, previously missing from the union). Registered so the fixtures
// package stays the single authoritative contract (先例坑：新 host→webview
// 消息必须先进 webview-fixtures). ----

/**
 * One selectable model. `supportsVision` is resolved by the agent from the
 * model's declarative `capabilities` (opt-out: unset means supported), so the
 * picker only renders the badge — it never re-derives capability rules.
 */
export interface ConfiguredModel {
  /** Model id, same shape as the `model` key / `models` map key in settings.json. */
  name: string;
  /** Whether the model can read images. */
  supportsVision: boolean;
}

/** Reply to getConfiguredModels — the model picker's candidate list. */
export interface ConfiguredModelsMessage extends HostToWebviewMessageBase {
  command: "configuredModels";
  models: ConfiguredModel[];
  currentModel?: string;
}

/** Full MCP server status push (connect/disconnect refresh). Snapshot
 *  semantics, not reply-to: McpDialog / SettingsMcpView render-time filter by
 *  each server's own `scope` field, so no attribution key beyond paneId. */
export interface McpServersUpdateMessage extends HostToWebviewMessageBase {
  command: "mcpServersUpdate";
  servers: unknown[];
}

/** Settings tab open push (VS Code): workdir + optional nav key so
 *  /mcp、/agents 等斜杠命令打开设置页可预选 tab. Early posts are dropped
 *  by VS Code before the webview's listener registers — the host re-serves
 *  the cached state on the webview's `settingsReady` handshake (#2044). */
export interface SettingsStateMessage extends HostToWebviewMessageBase {
  command: "settingsState";
  workdir?: string;
  nav?: string;
}

/** IDE selection toolbar → insert a code-selection context tag into the
 *  chat input (VS Code sends on the ➕ action). */
export interface AddSelectionToInputMessage extends HostToWebviewMessageBase {
  command: "addSelectionToInput";
  selection: SelectionInfo;
}

/** IDE settings page「新建/编辑」→ close settings tab and prefill the chat
 *  input draft (ChatApp loadDraft). */
export interface PrefillPromptMessage extends HostToWebviewMessageBase {
  command: "prefillPrompt";
  prompt: string;
}

/** Reply to `deleteSession`（远控 Web 页「会话」列表的行级删除）。
 *
 *  `worktreeRemoved` 是本条回复唯一的新事实：电脑侧定位不到那条会话的工作树时
 *  **会话照样删掉**，只是工作树没跟着删——页面据此说「会话已删除，工作树没动」，
 *  而不是把一次「删了一半」报成彻底失败（spec remote-control.md「手机端的会话列表
 *  与删除」场景 8）。 */
export interface SessionDeletedMessage extends HostToWebviewMessageBase {
  command: "sessionDeleted";
  requestId: string;
  sessionId: string;
  ok: boolean;
  /** 只有当请求带了 `removeWorktree` 且真的删掉了目录时才是 true。 */
  worktreeRemoved?: boolean;
  error?: string;
}

/** Reply to `getSessionWorktreeChanges`：删除确认卡要说的话所需的两个计数。
 *
 *  `changes === null` 是**「读不到」**，不是「没有改动」——页面按「降级泛警告」
 *  处理，绝不把它当成干净的 worktree 而静默删除（与桌面端同一份语义，见
 *  `worktreeDeleteWarning`）。 */
export interface SessionWorktreeChangesMessage
  extends HostToWebviewMessageBase {
  command: "sessionWorktreeChanges";
  requestId: string;
  sessionId: string;
  changes: { files: number; commits: number } | null;
  error?: string;
}

/** Reply to `getRecentWorkdirs`（远控 Web 页「新建会话」弹窗的最近目录）。
 *
 * 这份列表**跟着机器走**（`~/.wave/recent-workdirs.json`），不是页面自己记的：
 * 会话被删光之后它是唯一还记得旧目录的来源（spec core/recent-workdirs.md）。
 * 同一份数据桌面端按主机各读各的，两端因此看到同一个列表。 */
export interface RecentWorkdirsMessage extends HostToWebviewMessageBase {
  command: "recentWorkdirsResponse";
  requestId: string;
  dirs: string[];
  /** 读失败（旧版电脑没有这个方法 / 通道拒绝）：`dirs` 按空表处理。 */
  error?: string;
}

/** Reply to a requestHistory / searchHistory query that failed. */
export interface HistoryErrorMessage extends HostToWebviewMessageBase {
  command: "historyError";
  error: unknown;
}

export type HostToWebviewMessage =
  | UpdateMessagesMessage
  | OlderMessagesMessage
  | OlderMessagesErrorMessage
  | UpdateTasksMessage
  | UpdateSessionStatusMessage
  | UpdatePushStateMessage
  | UpdateBackgroundTasksMessage
  | UpdateWorkflowRunsMessage
  | UpdateSelectionMessage
  | UpdatePermissionModeMessage
  | UpdateWorkdirMessage
  | DesktopGitBranchesMessage
  | DesktopWorktreeCreatedMessage
  | DesktopForwardPortResultMessage
  | DesktopFileContentMessage
  | DesktopFileSaveResultMessage
  | DesktopPreviewFileResultMessage
  | UpdateQueueMessage
  | UpdateQueuedMessageMissingMessage
  | UpdateCommandRunningMessage
  | RewindCheckpointsMessage
  | RewindResultMessage
  | BtwStreamMessage
  | BtwResponseMessage
  | BtwErrorMessage
  | StartStreamingMessage
  | EndStreamingMessage
  | EnsureUIResetMessage
  | UpdateSessionsMessage
  | UpdateCurrentSessionMessage
  | SessionRenamedMessage
  | ShowConfirmationMessage
  | PlanContentMessage
  | PlanFileUpdatedMessage
  | ConfigurationResponseMessage
  | ProjectSettingsMessage
  | HooksConfigResponseMessage
  | McpConfigResponseMessage
  | SetInitialStateMessage
  | DesktopThemeChangeMessage
  | DesktopThemeSourceMessage
  | DesktopUpdateChannelMessage
  | ShowToastMessage
  | PluginChangePendingMessage
  | DesktopTogglePanelMessage
  | ShowDialogMessage
  | ConfigurationUpdatedMessage
  | StatusResponseMessage
  | ConfigurationErrorMessage
  | FocusInputMessage
  | TriggerShortcutMessage
  | ScrollToBottomMessage
  | AppendMessageMessage
  | DiscardMessageMessage
  | CompactionStateChangeMessage
  | UpdateStreamingContentMessage
  | UpdateStreamingReasoningMessage
  | UpdateToolBlockMessage
  | UpdateErrorBlockMessage
  | AuthStatusResponseMessage
  | AgentsContentResponseMessage
  | AgentsContentSavedMessage
  | ContextUsageMessage
  | LoginResponseMessage
  | LogoutResponseMessage
  | DesktopAccountInfoMessage
  | DesktopFullScreenMessage
  | DesktopPanesMessage
  | DesktopSessionTreeMessage
  | DesktopWorkdirStateMessage
  | McpServersResponseMessage
  | SubagentConfigurationsResponseMessage
  | SkillMetadataResponseMessage
  | HooksResponseMessage
  | McpConfigPathsResponseMessage
  | HistoryResponseMessage
  | HistoryErrorMessage
  | ConfiguredModelsMessage
  | McpServersUpdateMessage
  | SettingsStateMessage
  | AddSelectionToInputMessage
  | PrefillPromptMessage
  | FileSuggestionsResponseMessage
  | FileSuggestionsErrorMessage
  | IdeContextResponseMessage
  | SlashCommandsResponseMessage
  | SlashCommandsErrorMessage
  | RecentWorkdirsMessage
  | UploadSuccessMessage
  | UploadErrorMessage
  | DesktopRemoteDirListMessage
  | DesktopWorktreeChangesMessage
  | SessionDeletedMessage
  | SessionWorktreeChangesMessage
  | PluginMarketFolderSelectedMessage
  | DesktopResumeSessionsMessage
  | RemoteControlResponseMessage
  | DesktopArtifactsListMessage
  | DesktopArtifactShareViewMessage
  | DesktopArtifactShareSaveMessage
  | DesktopArtifactMembersMessage
  | DesktopArtifactRevokeMessage
  | DesktopArtifactCategoriesMessage
  | DesktopArtifactCategoriesSavedMessage;

/**
 * Reply-to 消息归属键注册表（契约锁，见文件头部「归属契约」）。
 *
 * key = command，value = 该响应必须携带的归属字段名。注册表中的每一条都会被
 * 下方的编译期断言校验：union 对应成员若把归属键声明为可选（或漏掉），类型
 * 检查在 `_replyAttributionLocked` 处直接报错。
 *
 * 快照/广播与命令事件类消息不进本表（它们没有请求-响应配对，晚到 = 新事实）。
 */
type ReplyAttribution = {
  // 作用域查询：作用域字段作归属键（渲染期键控过滤或过期即弃均可）。
  desktopGitBranches: "workdir";
  projectSettings: "workdir";
  hooksConfigResponse: "scope";
  mcpConfigResponse: "scope";
  agentsContentResponse: "scope";
  agentsContentSaved: "scope";
  // 四视图钩子列表：scope 作归属键（useSettingsList 与 fetchKey 比对，
  // 切 Tab 前的慢回复即弃）。
  hooksResponse: "scope";
  // 一次性查询：历史弹窗 debounce 连续查询，requestId 比对弃旧回复。
  historyResponse: "requestId";
  // 问题文本作键：btw 面板比对 in-flight question，晚到的旧回复即弃。
  btwStream: "question";
  btwResponse: "question";
  btwError: "question";
  // 一次性查询：请求生成 id，回复原样带回（MessageInput requestIdRef 范例）。
  desktopForwardPortResult: "requestId";
  // 手机页上滑翻更早：请求生成 id，回复原样带回。用户在顶部停留会连续请求多页，
  // 且「翻更早」与「重连补差」共用同一条会话列表，晚到的旧页必须按 requestId 丢弃
  // （否则会把上一页 prepend 到已经翻走的位置上）。
  olderMessages: "requestId";
  olderMessagesError: "requestId";
  // 本地 HTML 预览：请求生成 id，回复原样带回（webview 比对 requestId 弃旧
  // 回复；失败回复触发文件面板回退）。
  desktopPreviewFileResult: "requestId";
  // 文件面板保存：一次编辑可重试多次（覆盖保存 / 失败重试），晚到的旧结果必须按
  // requestId 丢弃，否则会把上一次失败的横幅贴回已经存好的文件。
  desktopFileSaveResult: "requestId";
  desktopRemoteDirList: "requestId";
  // 删除确认：请求生成 id，回复原样带回（同一会话可反复开关对话框）。
  desktopWorktreeChanges: "requestId";
  // 目录选择器：请求生成 id，回复原样带回（同会话可反复打开弹窗）。
  pluginMarketFolderSelected: "requestId";
  // `/resume` 会话列表：请求生成 id，回复原样带回（连续敲 /resume、或主机慢时
  // 晚到的旧列表即弃）。
  desktopResumeSessions: "requestId";
  fileSuggestionsResponse: "requestId";
  // 发送前取 IDE 上下文内容（@terminal / @problems）：一次发送一笔请求，超时或
  // 连发时晚到的旧回复按 requestId 丢弃。
  ideContextResponse: "requestId";
  // 会话重命名：请求生成 id，回复原样带回（同一会话可反复改名；晚到的旧回复
  // 已被乐观更新消费，必须按 requestId 丢弃）。
  sessionRenamed: "requestId";
  // `/remote-control` 弹窗：打开期间轮询状态、连接/断开后还会再查一次，同一
  // requestId 通道上会有多笔在途请求 —— 只认最新一笔，晚到的旧快照即弃（否则
  // 「刚连上」会被一秒前的 "off" 覆盖回去）。
  remoteControlResponse: "requestId";
  // 回滚：请求生成 id，回复原样带回（同一会话可反复回滚，晚到的旧回复即弃）。
  rewindResult: "requestId";
  // 手机页会话列表的行级动作：删除 / 删除前读工作树改动。两笔都是「一次点击一笔
  // 请求」，但同一行可以被反复操作（关掉确认卡再点一次、换一行再点），晚到的旧回复
  // 必须按 requestId 丢弃，否则会替另一行收起卡片或贴上别人的改动数字。
  sessionDeleted: "requestId";
  sessionWorktreeChanges: "requestId";
  // 创作集：页面可反复刷新、弹层可反复开关、成员检索按输入连续查询，晚到的旧回复
  // 一律按 requestId 丢弃。
  desktopArtifactsList: "requestId";
  desktopArtifactShareView: "requestId";
  desktopArtifactShareSave: "requestId";
  desktopArtifactMembersSearch: "requestId";
  desktopArtifactRevoke: "requestId";
  desktopArtifactCategories: "requestId";
  desktopArtifactCategoriesSaved: "requestId";
  // 远控页「新建会话」的最近目录：弹窗每打开一次问一次，晚到的旧回复不得盖掉
  // 新的一次（列表本身很短，这里只要求归属键在）。
  recentWorkdirsResponse: "requestId";
};

// ---- 编译期断言：注册表中的每条响应命令，union 成员必须必填其归属键。 ----
// 探测语义：归属键的索引访问类型不得含 undefined（optional 或显式
// `| undefined` 都算未满足）。
type UnionMemberByCommand<C extends string> = Extract<
  HostToWebviewMessage,
  { command: C }
>;
type ReplyAttributionSatisfied = {
  [C in keyof ReplyAttribution & string]: UnionMemberByCommand<C> extends {
    [K in ReplyAttribution[C]]: infer V;
  }
    ? undefined extends V
      ? never
      : true
    : never;
};
// 某条注册的响应漏带/弱化归属键（optional 或显式 `| undefined`）时，
// Satisfied 对应键退化为 never，下方 satisfies 报
// 「Type 'true' is not assignable to type 'never'」——从 fixtures 契约层
// 拦下回归。逐键 satisfies 而非整体索引：never 会被 `true | never` union
// 吸收，整体检查恒绿（probe 验证过的坑）。
export const replyAttributionLocked = {
  desktopGitBranches: true,
  projectSettings: true,
  hooksConfigResponse: true,
  mcpConfigResponse: true,
  agentsContentResponse: true,
  agentsContentSaved: true,
  hooksResponse: true,
  historyResponse: true,
  btwStream: true,
  btwResponse: true,
  btwError: true,
  desktopForwardPortResult: true,
  olderMessages: true,
  olderMessagesError: true,
  desktopPreviewFileResult: true,
  desktopFileSaveResult: true,
  desktopRemoteDirList: true,
  desktopWorktreeChanges: true,
  pluginMarketFolderSelected: true,
  desktopResumeSessions: true,
  fileSuggestionsResponse: true,
  ideContextResponse: true,
  sessionRenamed: true,
  remoteControlResponse: true,
  rewindResult: true,
  sessionDeleted: true,
  sessionWorktreeChanges: true,
  desktopArtifactsList: true,
  desktopArtifactShareView: true,
  desktopArtifactShareSave: true,
  desktopArtifactMembersSearch: true,
  desktopArtifactRevoke: true,
  desktopArtifactCategories: true,
  desktopArtifactCategoriesSaved: true,
  recentWorkdirsResponse: true,
} satisfies {
  [C in keyof ReplyAttribution & string]: ReplyAttributionSatisfied[C];
};
