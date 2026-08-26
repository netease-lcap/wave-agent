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

/** Desktop host theme snapshot (effective only; desktop follows the OS). */
export interface ThemeState {
  effective: EffectiveTheme;
}

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

/** Maps to VS Code global state (apiKey/headers/baseURL/model/fastModel/…). */
export interface ConfigurationData {
  apiKey?: string;
  headers?: string;
  baseURL?: string;
  model?: string;
  fastModel?: string;
  language?: string;
  serverUrl?: string;
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

export interface ConfigurationResponseMessage extends HostToWebviewMessageBase {
  command: "configurationResponse";
  configurationData: ConfigurationData;
}

export interface ProjectSettingsMessage extends HostToWebviewMessageBase {
  command: "projectSettings";
  enabledPlugins: Record<string, boolean>;
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
  configurationData?: ConfigurationData;
  pendingConfirmations: ConfirmationRequest[];
  pendingConfirmation?: ConfirmationRequest;
  selection?: SelectionInfo;
  inputContent?: string;
  permissionMode?: PermissionMode;
  attachedImages?: AttachedImage[];
  queuedMessages: QueuedMessage[];
  isAuthenticated: boolean;
  workdir?: string;
  theme?: ThemeState;
}

export interface DesktopThemeChangeMessage extends HostToWebviewMessageBase {
  command: "desktopThemeChange";
  effective: EffectiveTheme;
}

/** Action a toast's button triggers when clicked (host-side semantics). */
export type ToastAction =
  | { type: "quitAndInstall" }
  | { type: "openDownloadPage"; url: string }
  | { type: "focusSession"; host: string; sessionId: string };

/** A non-modal in-app toast (VS Code-style, bottom-right). Desktop host only. */
export interface UpdateToast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: ToastAction;
  /** The toast's action is being performed — render a loading state instead of
   *  the action button (e.g. quit-and-install waiting for the app to exit). */
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

export interface ShowConfigurationMessage extends HostToWebviewMessageBase {
  command: "showConfiguration";
  configurationData?: ConfigurationData;
  error?: unknown;
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

export interface BangMessageAddedMessage extends HostToWebviewMessageBase {
  command: "bangMessageAdded";
  params: Record<string, unknown>;
}

export interface BangMessageUpdatedMessage extends HostToWebviewMessageBase {
  command: "bangMessageUpdated";
  params: Record<string, unknown>;
}

export interface BangMessageCompletedMessage extends HostToWebviewMessageBase {
  command: "bangMessageCompleted";
  params: Record<string, unknown>;
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
}

export interface LoginResponseMessage extends HostToWebviewMessageBase {
  command: "loginResponse";
  success: boolean;
}

export interface LogoutResponseMessage extends HostToWebviewMessageBase {
  command: "logoutResponse";
  success: boolean;
}

// ---- Host-only commands (consumed outside the ChatApp switch). ----

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

export interface HistoryResponseMessage extends HostToWebviewMessageBase {
  command: "historyResponse";
  history: SessionMetadata[];
}

// ---- MessageInput-owned replies (consumed outside the ChatApp switch). ----

export interface FileSuggestionsMessage extends HostToWebviewMessageBase {
  command: "fileSuggestions";
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
  commands: Array<{ id: string; name: string; description?: string }>;
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
  | ConfigurationResponseMessage
  | ProjectSettingsMessage
  | SetInitialStateMessage
  | DesktopThemeChangeMessage
  | ShowToastMessage
  | DesktopTogglePanelMessage
  | ShowConfigurationMessage
  | ShowDialogMessage
  | ConfigurationUpdatedMessage
  | StatusResponseMessage
  | ConfigurationErrorMessage
  | FocusInputMessage
  | TriggerShortcutMessage
  | ScrollToBottomMessage
  | AppendMessageMessage
  | BangMessageAddedMessage
  | BangMessageUpdatedMessage
  | BangMessageCompletedMessage
  | CompactionStateChangeMessage
  | UpdateStreamingContentMessage
  | UpdateStreamingReasoningMessage
  | UpdateToolBlockMessage
  | UpdateErrorBlockMessage
  | AuthStatusResponseMessage
  | LoginResponseMessage
  | LogoutResponseMessage
  | DesktopPanesMessage
  | DesktopSessionTreeMessage
  | DesktopWorkdirStateMessage
  | McpServersResponseMessage
  | SubagentConfigurationsResponseMessage
  | SkillMetadataResponseMessage
  | HistoryResponseMessage
  | FileSuggestionsMessage
  | FileSuggestionsErrorMessage
  | SlashCommandsResponseMessage
  | SlashCommandsErrorMessage
  | UploadSuccessMessage
  | UploadErrorMessage
  | DesktopRemoteDirListMessage;
