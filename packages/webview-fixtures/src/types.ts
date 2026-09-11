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
 * 模型选择与服务地址（`model` / `fastModel` / `serverUrl`）不属于这里——它们是
 * 宿主/SDK 侧的状态，webview 侧没有设置入口：模型经 `/model` 命令走
 * `getConfiguredModels` / `setModel`，服务地址经 `authStatusResponse.serverUrl`
 * 下发（`serverUrl` 由 CLI 的 `getAuthStatus` 解析，宿主只缓存）。
 */
export interface ConfigurationData {
  language?: string;
  /** Per-model input context window in K tokens (e.g. 200 = 200K), 16–1000 */
  contextLength?: number;
  /** Whether auto-memory extraction is enabled */
  autoMemoryEnabled?: boolean;
  /** Auto-memory extraction turn frequency, 1–100 */
  autoMemoryFrequency?: number;
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
}

export interface UpdateTasksMessage extends HostToWebviewMessageBase {
  command: "updateTasks";
  tasks: Task[];
  isTaskListCollapsed?: boolean;
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

export interface ShowConfirmationMessage extends HostToWebviewMessageBase {
  command: "showConfirmation";
  confirmationId: string;
  toolName: string;
  confirmationType: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
}

/** Desktop /plan display: the host pushes the current plan file contents to
 *  the shared Plan pane (opened on first delivery, like ExitPlanMode plans). */
export interface PlanContentMessage extends HostToWebviewMessageBase {
  command: "planContent";
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

/**
 * 重建确认框（桌面端专属，spec「配置变更的构造期副作用与重建」场景 4）：
 * 插件装卸等构造期副作用已落盘、且存在受影响的 live 会话时推送，让用户选择
 * 生效时机——`total` = 将重启的会话数（N），`busy` = 其中正在执行任务、
 * 即便「立即重启」也暂不重启的数（M）。webview 弹两按钮确认框（立即重启 /
 * 稍后重启，`Esc` 等同稍后重启，无「取消」）并回 `desktopRebuildDecision`。
 */
export interface DesktopRebuildPromptMessage extends HostToWebviewMessageBase {
  command: "desktopRebuildPrompt";
  total: number;
  busy: number;
}

export interface StatusResponseMessage extends HostToWebviewMessageBase {
  command: "statusResponse";
  configurationData?: ConfigurationData;
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

/** 套餐用量 (codechat `GET /api/v1/account` → `plan`). */
export interface AccountPlanInfo {
  monthlyQuota: number;
  months: number;
  used: number;
}

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
  plan?: AccountPlanInfo | null;
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

export interface SlashCommandsResponseMessage extends HostToWebviewMessageBase {
  command: "slashCommandsResponse";
  commands: Array<{
    id: string;
    name: string;
    description?: string;
    /** Source tag of a skill-backed command (内置/用户/项目/插件). Skill rows
     *  only — plain/custom/plugin commands omit it. */
    skillSource?: "builtin" | "user" | "project" | "plugin";
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

// ---- Contract gaps (commands hosts really send / the webview really
// consumes, previously missing from the union). Registered so the fixtures
// package stays the single authoritative contract (先例坑：新 host→webview
// 消息必须先进 webview-fixtures). ----

/** Reply to getConfiguredModels — the model picker's candidate list. */
export interface ConfiguredModelsMessage extends HostToWebviewMessageBase {
  command: "configuredModels";
  models: string[];
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

/** Reply to a requestHistory / searchHistory query that failed. */
export interface HistoryErrorMessage extends HostToWebviewMessageBase {
  command: "historyError";
  error: unknown;
}

export type HostToWebviewMessage =
  | UpdateMessagesMessage
  | UpdateTasksMessage
  | UpdateBackgroundTasksMessage
  | UpdateWorkflowRunsMessage
  | UpdateSelectionMessage
  | UpdatePermissionModeMessage
  | UpdateWorkdirMessage
  | DesktopGitBranchesMessage
  | DesktopWorktreeCreatedMessage
  | DesktopForwardPortResultMessage
  | DesktopFileContentMessage
  | UpdateQueueMessage
  | UpdateQueuedMessageMissingMessage
  | UpdateCommandRunningMessage
  | RewindCheckpointsMessage
  | BtwStreamMessage
  | BtwResponseMessage
  | BtwErrorMessage
  | StartStreamingMessage
  | EndStreamingMessage
  | EnsureUIResetMessage
  | UpdateSessionsMessage
  | UpdateCurrentSessionMessage
  | ShowConfirmationMessage
  | PlanContentMessage
  | ConfigurationResponseMessage
  | ProjectSettingsMessage
  | HooksConfigResponseMessage
  | McpConfigResponseMessage
  | SetInitialStateMessage
  | DesktopThemeChangeMessage
  | DesktopThemeSourceMessage
  | DesktopUpdateChannelMessage
  | ShowToastMessage
  | DesktopTogglePanelMessage
  | ShowDialogMessage
  | ConfigurationUpdatedMessage
  | DesktopRebuildPromptMessage
  | StatusResponseMessage
  | ConfigurationErrorMessage
  | FocusInputMessage
  | TriggerShortcutMessage
  | ScrollToBottomMessage
  | AppendMessageMessage
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
  | SlashCommandsResponseMessage
  | SlashCommandsErrorMessage
  | UploadSuccessMessage
  | UploadErrorMessage
  | DesktopRemoteDirListMessage
  | DesktopWorktreeChangesMessage;

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
  desktopRemoteDirList: "requestId";
  // 删除确认：请求生成 id，回复原样带回（同一会话可反复开关对话框）。
  desktopWorktreeChanges: "requestId";
  fileSuggestionsResponse: "requestId";
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
  desktopRemoteDirList: true,
  desktopWorktreeChanges: true,
  fileSuggestionsResponse: true,
} satisfies {
  [C in keyof ReplyAttribution & string]: ReplyAttributionSatisfied[C];
};
