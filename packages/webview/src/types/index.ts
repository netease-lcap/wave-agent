/**
 * TypeScript type definitions for the Wave AI Chat webview
 *
 * This file contains all the interfaces and types used throughout the React webview,
 * providing type safety and better development experience.
 */

// Import message structures and session types from wave-agent-sdk
import type {
  Message,
  MessageBlock,
  TextBlock,
  ErrorBlock,
  ToolBlock,
  ImageBlock,
  CompactBlock,
  ReasoningBlock,
  PermissionMode,
  AskUserQuestion,
  AskUserQuestionInput,
  AskUserQuestionOption,
  Task,
  TaskStatus,
  TaskNotificationBlock,
  McpServerStatus,
  McpServerConfig,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SubagentConfiguration,
  SkillMetadata,
} from "wave-agent-sdk/dist/types/index.js";
import type {
  SessionMetadata,
  SessionData,
} from "wave-agent-sdk/dist/services/session.js";
import type { ToolBlockUpdateCallbackParams } from "wave-agent-sdk/dist/utils/messageOperations.js";

export type {
  Message,
  MessageBlock,
  TextBlock,
  ErrorBlock,
  ToolBlock,
  ImageBlock,
  CompactBlock,
  ReasoningBlock,
  TaskNotificationBlock,
  SessionData,
  SessionMetadata,
  PermissionMode,
  AskUserQuestion,
  AskUserQuestionInput,
  AskUserQuestionOption,
  Task,
  TaskStatus,
  McpServerStatus,
  McpServerConfig,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SubagentConfiguration,
  SkillMetadata,
  ToolBlockUpdateCallbackParams,
};

// Slash command types
export interface SlashCommand {
  id: string;
  name: string;
  description: string;
}

// File mention types for @ file suggestion feature

/**
 * Represents a file or directory item in the suggestion dropdown
 */
export interface FileItem {
  /** Full absolute path to the file or directory */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** File or directory name without path */
  name: string;
  /** File extension (without dot) - empty string for directories */
  extension: string;
  /** VS Code file icon class name */
  icon: string;
  /** Flag to distinguish files vs directories */
  isDirectory: boolean;
}

/**
 * State for file mention suggestions
 */
export interface FileSuggestionState {
  /** Whether the file mention dropdown is active */
  isActive: boolean;
  /** Array of file suggestions to display */
  suggestions: FileItem[];
  /** Currently selected suggestion index */
  selectedIndex: number;
  /** Text being typed after @ symbol for filtering */
  filterText: string;
  /** Position for dropdown placement */
  position: { top: number; left: number };
  /** Loading state for API requests */
  isLoading: boolean;
}

// VS Code API type

/**
 * Interface for the VS Code webview API
 */
export interface VsCodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

// Host-injected globals. Declared here (not in index.tsx) so the augmentation
// reaches every compilation unit that imports types — the tests tsconfig only
// pulls in src files reachable from test imports, never index.tsx itself.
declare global {
  interface Window {
    /** Provided by every host: VS Code runtime, JetBrains bridge, Electron preload. */
    acquireVsCodeApi(): VsCodeApi;
    /** Set by the Electron preload (packages/desktop); undefined in IDE hosts. */
    waveHostType?: string;
    /** file:// URL of the element-picker preload, exposed by the Electron preload. */
    wavePickerPreloadPath?: string;
  }
}

// VS Code webview message types

/**
 * Base interface for messages sent between webview and extension
 */
export interface WebviewMessage {
  /** Command identifier */
  command: string;
  /** Additional command parameters */
  [key: string]: unknown;
}

// File upload related message types

/**
 * File data for upload
 */
export interface UploadFileData {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
  /** File content as ArrayBuffer */
  data: ArrayBuffer;
}

/**
 * Basic file info for upload request
 */
export interface UploadFileInfo {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  type: string;
}

// History types
export interface HistoryItem {
  prompt: string;
  timestamp: number;
  workdir?: string;
}

export interface HistorySearchState {
  isActive: boolean;
  items: HistoryItem[];
  selectedIndex: number;
  filterText: string;
  position: { top: number; left: number };
  isLoading: boolean;
}

// Component props
export interface ChatAppProps {
  vscode: VsCodeApi;
  host?: DesktopHostProps;
  /**
   * Desktop split-view: the paneId this instance renders. When set, the message
   * listener filters host pushes by paneId and outgoing commands carry it back.
   * Undefined for the IDE hosts and for a single-pane desktop layout.
   */
  paneId?: string;
  /**
   * Desktop sidebar collapsed → the leftmost chat header (first pane of the
   * top row in split view) shows an expand button. Built by the root ChatApp
   * instance that owns the collapse state and threaded through DesktopShell.
   */
  sidebarExpandButton?: React.ReactNode;
}

/**
 * One split-view pane in the desktop layout (FR-032). Panes are organized into
 * at most two rows (top/bottom); within a row order = left→right. `sessionId`
 * is undefined while the pane's session is still being resolved.
 */
export interface DesktopPane {
  paneId: string;
  sessionId?: string;
  /**
   * Host this pane is bound to ('local' or an SSH host name), pushed via
   * `desktopPanes`. Drives per-pane remote behavior (panels off, localhost
   * links to the system browser).
   */
  host?: string;
  /**
   * Width ratio across the pane row (0–1), maintained by the host. Absent
   * means the pane takes an equal share of the row.
   */
  width?: number;
  /** Pane row: 0 = top (default when absent), 1 = bottom. */
  row?: 0 | 1;
}

/** Options for opening a session in a new pane. */
export interface OpenPaneOptions {
  /** Gap index (0..target-row pane count) to insert at — from a sidebar drop. */
  insertionIndex?: number;
  /** Target row; default is the focused pane's row. */
  row?: 0 | 1;
  /**
   * Split the single row into two and put the new pane alone in the fresh
   * row ('above' = new row on top). Ignored when two rows already exist.
   */
  newRow?: "above" | "below";
}

// Desktop host support — injected when running inside packages/desktop (Electron).
// window.waveHostType === 'desktop' selects the DesktopApp root in index.tsx.
export interface DesktopHostProps {
  type: "desktop";
  /** Current host: 'local' or an SSH host name (the focused pane's host). */
  host: string;
  /** All selectable hosts: 'local' + parsed ~/.ssh/config top-level Host names. */
  hosts: string[];
  workdir?: string;
  recentWorkdirs: string[];
  onSelectWorkdir: () => void;
  /** `host` scopes the recents lookup to a specific host (defaults to the current one). */
  onSelectRecentWorkdir: (path: string, host?: string) => void;
  onRemoveRecentWorkdir: (path: string, host?: string) => void;
  /** Switch the focused pane's host (本地 or an SSH host). */
  onSelectHost: (host: string) => void;
  /** Add a host from an `ssh user@hostname -p port` connection string (VSC-style). */
  onAddHost: (connectionString: string) => void;
  /** Select a remote workdir by absolute path; validated with `test -d` on the host. */
  onSelectRemotePath: (path: string, host: string) => void;
  /**
   * List the subdirectories of a remote path (remote directory browser,
   * spec scenario 20). The host replies with a requestId-matched
   * `desktopRemoteDirList` message.
   */
  onListRemoteDir: (path: string, host: string, requestId: string) => void;
  /**
   * Sidebar session tree (FR-020): one group per recent directory with all of
   * its sessions. Pushed via the `desktopSessionTree` message.
   */
  sessionTree: DesktopSessionGroup[];
  /** Open a historical session; switches workdir first when needed. */
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index; also removes worktree+branch if applicable. */
  onDeleteSession: (sessionId: string) => void;
  /**
   * Open a session in a new pane (Cmd/Ctrl+Click on a sidebar session, or drag
   * one into the chat area). When the session is already shown, the host
   * focuses that pane instead. `opts` picks the target row / insertion gap /
   * a fresh second row; omitted options mean "append at the right end of the
   * focused pane's row".
   */
  onOpenPane: (
    workdir: string,
    sessionId: string,
    opts?: OpenPaneOptions,
  ) => void;
  /**
   * Split-view panes (FR-032) grouped into up to two rows, pushed via
   * `desktopPanes`. Empty until the first layout push; the layout renders a
   * single pane in that case.
   */
  panes?: DesktopPane[];
  /**
   * Row height ratios [top, bottom] (sum ≈ 1), pushed via `desktopPanes`.
   * Present only while two rows exist; absent = single row fills the area.
   */
  rowHeights?: number[];
  /** The pane that receives sidebar clicks / 新对话, pushed via `desktopPanes`. */
  focusedPaneId?: string | null;
}

/** One directory group in the desktop sidebar session tree (FR-020). */
export interface DesktopSessionGroup {
  /** Host the group's sessions run on ('local' or an SSH host name) — the group key is (host, workdir). */
  host: string;
  workdir: string;
  sessions: DesktopSessionEntry[];
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

/**
 * The resolved theme applied to the DOM via the `data-theme` attribute (FR-018).
 * The desktop host resolves the OS appearance to one of these before reaching
 * the renderer; desktop follows the OS only, no in-app preference (FR-016).
 */
export type EffectiveTheme = "light" | "dark";

/** Theme snapshot pushed by the desktop host (effective only, no preference). */
export interface ThemeState {
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

// Pushed by the desktop main process in response to `desktopReady` and after
// every workdir/host change (message command: 'desktopWorkdirState').
export interface DesktopWorkdirState {
  workdir?: string;
  /** Current host ('local' or an SSH host name) — the focused pane's host. */
  host: string;
  /** All selectable hosts: 'local' + parsed ~/.ssh/config top-level Host names. */
  hosts: string[];
  recentWorkdirs: string[];
}

export interface MessageListProps {
  messages: Message[];
  queuedMessages?: QueuedMessage[];
  isStreaming?: boolean;
  isCompacting?: boolean;
  /** Accumulated streaming text from the compaction fork; its last 30 characters
   * render after the "正在压缩对话" hint (same tail style as the CLI loading
   * indicator). */
  compactionStream?: string;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
  /** Desktop host only: open a file in the file panel instead of the OS. */
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
}

export interface MessageProps {
  message: Message;
  isQueued?: boolean;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
  /** Desktop host only: open a file in the file panel instead of the OS. */
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
}

// Image attachment types (uses base64 data directly)
export interface AttachedImage {
  /** Unique identifier for the image (for UI management) */
  id: string;
  /** Base64 data URL (e.g., "data:image/png;base64,iVBORw0...") */
  data: string;
  /** MIME type of the image */
  mimeType: string;
  /** Original filename if available */
  filename?: string;
  /** File size in bytes */
  size?: number;
}

export interface MessageInputProps {
  onSendMessage: (
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  isStreaming: boolean;
  onAbortMessage: () => void;
  onSubmitQueuedEdit?: (
    id: string,
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  editingQueuedId?: string | null;
  onCancelQueuedEdit?: () => void;
  shouldClearInput?: boolean;
  onInputCleared?: () => void;
  vscode: VsCodeApi;
  // Selection props
  selection?: SelectionInfo;
  inputContent?: string;
  /**
   * The session this input belongs to. Tagged on every updateInputContent so
   * the host routes drafts per conversation; on change the input flushes the
   * outgoing session's draft and applies the incoming one.
   */
  sessionId?: string;
  permissionMode?: PermissionMode;
  initialAttachedImages?: AttachedImage[];
  /** Optional slot rendered at the top-left of the input box (desktop workdir selector). */
  workdirSelector?: React.ReactNode;
  /** Optional /rewind popup rendered above the input box, anchored to .input-wrapper. */
  rewindPopup?: React.ReactNode;
  /** Optional /model popup rendered above the input box, anchored to .input-wrapper. */
  modelPopup?: React.ReactNode;
  /** Optional /btw side-question panel rendered above the input box, anchored to .input-wrapper. */
  btwPopup?: React.ReactNode;
  /** Disable the whole input area (e.g. desktop host without a workdir). */
  disabled?: boolean;
  /** Desktop split-view pane this input belongs to; tagged on upload requests
   *  so the host can route uploadSuccess back to the originating pane. */
  paneId?: string;
}

/**
 * Props for the attached images component
 */
export interface AttachedImagesProps {
  images: AttachedImage[];
  onRemove: (imageId: string) => void;
}

/**
 * Props for the file suggestion dropdown component
 */
export interface FileSuggestionDropdownProps {
  suggestions: FileItem[];
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (file: FileItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
  filterText: string;
  isLoading?: boolean;
  /** Which way the dropdown expands from its anchor: "up" (message input,
      the default) or "down" (panel-top search bars). */
  direction?: "up" | "down";
}

/** Desktop conversation-level side panels. VSCE/JetBrains hosts never render these. */
export type DesktopPanelKind =
  | "preview"
  | "diff"
  | "terminal"
  | "file"
  | "plan";

/**
 * State of the desktop file panel (one per conversation): which file is open,
 * its content, and read status. The host pushes a snapshot after every
 * openFile request via the `desktopFileContent` message; `loading` is set
 * locally when the panel opens and cleared/overwritten when the reply lands.
 */
export interface FileViewState {
  /** Absolute path of the file being viewed. */
  path: string;
  /** 'local' or the SSH host name the file lives on. */
  host: string;
  /** True while the host is reading the file (nothing loaded yet). */
  loading?: boolean;
  /** User-facing error when the file could not be read (no content). */
  error?: string;
  /** File content, present for text/markdown files. */
  content?: string;
  /** Lines to jump to (1-based) — from read tool offset/limit or a selection. */
  startLine?: number;
  endLine?: number;
  /** Text read was truncated (line or byte cap). */
  truncated?: boolean;
  /** Total line count on disk, for the truncated hint. */
  totalLines?: number;
  /** Base64 data URL for remote images, inlined in the panel. */
  imageBase64?: string;
}

/** Header panel-toggle control: which panels are checked + toggle callback. */
export interface PanelToggleProps {
  /** Currently checked panels. */
  checked: DesktopPanelKind[];
  /** Toggle one panel's checked state. */
  onToggle: (kind: DesktopPanelKind) => void;
  /** Panels that can't be toggled right now (e.g. no workdir for diff/terminal). */
  disabled?: DesktopPanelKind[];
}

export interface ChatHeaderProps {
  onNewSession: () => void;
  newSessionDisabled?: boolean;
  onAbortMessage: () => void;
  messages: Message[];
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  onSessionSelect: (sessionId: string) => void;
  sessionsLoading: boolean;
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  // Desktop host: session new/list buttons live in DesktopSidebar instead.
  hideSessionButtons?: boolean;
  // Desktop host: the more button + menu live in DesktopSidebar instead.
  hideMoreButton?: boolean;
  // Desktop host: conversation-level panel toggle (preview/diff/terminal).
  panelToggle?: PanelToggleProps;
  /** Optional slot at the header's left edge (desktop sidebar expand button). */
  leading?: React.ReactNode;
}

// Matches wave-agent-sdk's QueuedMessage type
export interface QueuedMessage {
  id?: string;
  type?: "message" | "bang";
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
  // Legacy alias for backward compat
  text?: string;
}

export interface QueuedMessageListProps {
  queuedMessages: QueuedMessage[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onEdit: (id: string) => void;
  onSend: (id: string) => void;
  onDelete: (id: string) => void;
  editingQueuedId: string | null;
  vscode: VsCodeApi;
}

// Chat state management
export interface ChatState {
  messages: Message[];
  tasks: Task[];
  backgroundTasks: BackgroundTaskSummary[];
  workflowRuns: SerializableWorkflowRun[];
  isTaskListCollapsed: boolean;
  isQueueCollapsed: boolean;
  editingQueuedId: string | null;
  isStreaming: boolean;
  // Compaction in progress — shows the "正在压缩对话" hint after the blinking
  // cursor at the end of the message list.
  isCompacting: boolean;
  // Session restore in progress (desktop): the pane switched optimistically to
  // the target session and shows the sweep loading animation over the message
  // + input area while the host connects and replays the transcript.
  isRestoring: boolean;
  isCommandRunning: boolean;
  shouldClearInput: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  sessionsLoading: boolean;
  pendingConfirmations: ConfirmationRequest[];
  queuedMessages: QueuedMessage[];
  // Auth state
  isAuthenticated: boolean;
  // Whether the initial state (incl. auth status) has been received from the
  // backend. The welcome page is withheld until this is true so the login CTA
  // doesn't flash for logged-in users before setInitialState arrives.
  initialized: boolean;
  // Agent working directory, used to render tool file paths as relative.
  workdir?: string;
  // Dialog state
  activeDialog:
    | "config"
    | "plugin"
    | "mcp"
    | "status"
    | "tasks"
    | "workflows"
    | "agents"
    | "skills"
    | null;
  configurationData?: ConfigurationData;
  configurationLoading: boolean;
  configurationError?: string;
  // Project-scoped settings (read from .wave/settings.json merged config via
  // stdio RPC). Holds the merged enabledPlugins map for the 项目设置 tab.
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  // Permission mode state
  permissionMode?: PermissionMode;
  // Attached images state
  attachedImages?: AttachedImage[];
  // Input state
  inputContent?: string;
  // Selection state
  selection?: SelectionInfo;
  // Desktop theme state (only set inside the desktop host)
  theme?: ThemeState;
}

export interface ConfirmationRequest {
  confirmationId: string;
  toolName: string;
  confirmationType: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  permissionMode?: PermissionMode;
  warning?: string;
}

export interface ConfirmationDecision {
  behavior: "allow" | "deny";
  newPermissionMode?: string;
  newPermissionRule?: string;
  message?: string;
}

export interface ConfirmationDialogProps {
  confirmation: ConfirmationRequest;
  onConfirm: (confirmationId: string, decision?: ConfirmationDecision) => void;
  onReject: (confirmationId: string) => void;
}

// Configuration management types

/**
 * Configuration data for AI agent settings
 * Maps to VS Code global state
 */
export interface ConfigurationData {
  /** API key for authentication */
  apiKey?: string;
  /** Headers for authentication */
  headers?: string;
  /** Base URL for API endpoints */
  baseURL?: string;
  /** Primary model */
  model?: string;
  /** Fast model for quick responses */
  fastModel?: string;
  /** Preferred language for agent communication */
  language?: string;
  /** CodeChat server URL (reported by SDK, used for update checks) */
  serverUrl?: string;
}

// Plugin related types
export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  installed?: boolean;
  marketplace?: string;
  scope?: PluginScope;
}

export interface MarketplaceInfo {
  name: string;
  url: string;
}

export type PluginScope = "user" | "project" | "local";

export interface SelectionInfo {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  selectedText: string;
  isEmpty: boolean;
}

/**
 * Props for the general settings dialog component
 */
export interface ConfigDialogProps {
  configurationData: ConfigurationData;
  isLoading: boolean;
  error?: string;
  onSave: (config: ConfigurationData) => void;
  onCancel: () => void;
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  onLoadProjectSettings?: () => void;
  onToggleBuiltinPlugin?: (pluginId: string, enabled: boolean) => void;
}

/**
 * Props for the plugin management dialog component
 */
export interface PluginDialogProps {
  onClose: () => void;
}

/**
 * Props for the MCP server settings dialog component
 */
export interface McpDialogProps {
  onClose: () => void;
}

/**
 * Props for the status info dialog component
 */
export interface StatusDialogProps {
  onClose: () => void;
}

export interface BackgroundTaskManagerProps {
  onClose: () => void;
}

/**
 * Props for the agent definitions dialog component
 */
export interface AgentsDialogProps {
  onClose: () => void;
}

/**
 * Props for the skill metadata dialog component
 */
export interface SkillsDialogProps {
  onClose: () => void;
}

export interface WorkflowManagerProps {
  onCancel: () => void;
}

export type ChatAction =
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_BACKGROUND_TASKS"; payload: BackgroundTaskSummary[] }
  | { type: "SET_WORKFLOW_RUNS"; payload: SerializableWorkflowRun[] }
  | { type: "TOGGLE_TASK_LIST_COLLAPSE" }
  | { type: "SET_TASK_LIST_COLLAPSED"; payload: boolean }
  | { type: "TOGGLE_QUEUE_COLLAPSE" }
  | { type: "START_STREAMING" }
  | { type: "END_STREAMING" }
  | { type: "SET_COMPACTING"; payload: boolean }
  | { type: "INPUT_CLEARED" }
  | { type: "SET_SESSIONS"; payload: SessionMetadata[] }
  | { type: "SET_CURRENT_SESSION"; payload: SessionMetadata | undefined }
  | { type: "SET_SESSIONS_LOADING"; payload: boolean }
  | { type: "SHOW_CONFIRMATION"; payload: ConfirmationRequest }
  | { type: "HIDE_CONFIRMATION"; payload: string }
  | {
      type: "SHOW_DIALOG";
      payload: {
        type:
          | "config"
          | "plugin"
          | "mcp"
          | "status"
          | "tasks"
          | "workflows"
          | "agents"
          | "skills";
        data?: ConfigurationData;
        error?: string;
      };
    }
  | { type: "HIDE_DIALOG" }
  | { type: "SET_AUTHENTICATED"; payload: boolean }
  | { type: "SET_CONFIGURATION_LOADING"; payload: boolean }
  | { type: "SET_CONFIGURATION_ERROR"; payload: string | undefined }
  | { type: "SET_CONFIGURATION_DATA"; payload: ConfigurationData }
  | {
      type: "SET_PROJECT_SETTINGS";
      payload: { enabledPlugins: Record<string, boolean> };
    }
  | { type: "UPDATE_SELECTION"; payload: SelectionInfo | undefined }
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | { type: "SET_COMMAND_RUNNING"; payload: boolean }
  | { type: "SET_WORKDIR"; payload: string }
  | { type: "SET_QUEUED_MESSAGES"; payload: QueuedMessage[] }
  | { type: "SET_EDITING_QUEUED_ID"; payload: string | null }
  | {
      type: "SET_INITIAL_STATE";
      payload: {
        messages: Message[];
        tasks?: Task[];
        isStreaming: boolean;
        isCommandRunning?: boolean;
        isCompacting?: boolean;
        isRestoring?: boolean;
        isTaskListCollapsed?: boolean;
        sessions: SessionMetadata[];
        currentSession?: SessionMetadata;
        configurationData: ConfigurationData;
        pendingConfirmations: ConfirmationRequest[];
        selection?: SelectionInfo;
        inputContent?: string;
        permissionMode?: PermissionMode;
        attachedImages?: AttachedImage[];
        queuedMessages?: QueuedMessage[];
        isAuthenticated?: boolean;
        workdir?: string;
        backgroundTasks?: BackgroundTaskSummary[];
        workflowRuns?: SerializableWorkflowRun[];
        theme?: ThemeState;
      };
    }
  // Incremental update actions for streaming optimization
  | { type: "APPEND_MESSAGE"; payload: Message }
  | {
      type: "UPDATE_STREAMING_CONTENT";
      payload: { messageId: string; chunk: string; stage: "streaming" | "end" };
    }
  | {
      type: "UPDATE_STREAMING_REASONING";
      payload: { messageId: string; chunk: string; stage: "streaming" | "end" };
    }
  | { type: "UPDATE_TOOL_BLOCK"; payload: ToolBlockUpdateCallbackParams }
  | { type: "APPEND_ERROR_BLOCK"; payload: { error: string } };
