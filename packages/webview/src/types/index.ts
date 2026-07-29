/**
 * TypeScript type definitions for the Wave AI Chat webview
 * 
 * This file contains all the interfaces and types used throughout the React webview,
 * providing type safety and better development experience.
 */

// Import message structures and session types from wave-agent-sdk
import type { Message, MessageBlock, TextBlock, ErrorBlock, ToolBlock, ImageBlock, BangBlock, CompactBlock, ReasoningBlock, PermissionMode, AskUserQuestion, AskUserQuestionInput, AskUserQuestionOption, Task, TaskStatus, TaskNotificationBlock, McpServerStatus, McpServerConfig, BackgroundTaskSummary, SerializableWorkflowRun } from 'wave-agent-sdk/dist/types/index.js';
import type { SessionMetadata, SessionData } from 'wave-agent-sdk/dist/services/session.js';
import type { ToolBlockUpdateCallbackParams } from 'wave-agent-sdk/dist/utils/messageOperations.js';

export type { Message, MessageBlock, TextBlock, ErrorBlock, ToolBlock, ImageBlock, BangBlock, CompactBlock, ReasoningBlock, TaskNotificationBlock, SessionData, SessionMetadata, PermissionMode, AskUserQuestion, AskUserQuestionInput, AskUserQuestionOption, Task, TaskStatus, McpServerStatus, McpServerConfig, BackgroundTaskSummary, SerializableWorkflowRun, ToolBlockUpdateCallbackParams };

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
}

/**
 * One split-view pane in the desktop layout (FR-032). Order = left→right.
 * `sessionId` is undefined while the pane's session is still being resolved.
 */
export interface DesktopPane {
  paneId: string;
  sessionId?: string;
  /**
   * Width ratio across the pane row (0–1), maintained by the host. Absent
   * means the pane takes an equal share of the row.
   */
  width?: number;
}

// Desktop host support — injected when running inside packages/desktop (Electron).
// window.waveHostType === 'desktop' selects the DesktopApp root in index.tsx.
export interface DesktopHostProps {
  type: 'desktop';
  workdir?: string;
  recentWorkdirs: string[];
  onSelectWorkdir: () => void;
  onSelectRecentWorkdir: (path: string) => void;
  onRemoveRecentWorkdir: (path: string) => void;
  /**
   * Sidebar session tree (FR-020): one group per recent directory, up to 5
   * sessions each. Pushed via the `desktopSessionTree` message.
   */
  sessionTree: DesktopSessionGroup[];
  /** Open a historical session; switches workdir first when needed. */
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index; also removes worktree+branch if applicable. */
  onDeleteSession: (sessionId: string) => void;
  /**
   * Open a session in a new pane (Cmd/Ctrl+Click on a sidebar session, or drag
   * one into the chat area). When the session is already shown, the host
   * focuses that pane instead. `insertionIndex` (0..pane count) inserts the
   * new pane at that position — from a sidebar drop on a pane gap; omitted
   * means append at the right end.
   */
  onOpenPane: (workdir: string, sessionId: string, insertionIndex?: number) => void;
  /**
   * Git branches of the current workdir (FR-022), pushed via the
   * `desktopGitBranches` message. `null` = not a git repo / git unavailable —
   * branch selector and worktree checkbox stay hidden.
   */
  gitBranches: { branches: string[]; current: string } | null;
  /**
   * Ordered split-view panes (FR-032), pushed via `desktopPanes`. Empty until
   * the first layout push; the layout renders a single pane in that case.
   */
  panes?: DesktopPane[];
  /** The pane that receives sidebar clicks / 新对话, pushed via `desktopPanes`. */
  focusedPaneId?: string | null;
}

/** One directory group in the desktop sidebar session tree (FR-020). */
export interface DesktopSessionGroup {
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
export type EffectiveTheme = 'light' | 'dark';

/** Theme snapshot pushed by the desktop host (effective only, no preference). */
export interface ThemeState {
  effective: EffectiveTheme;
}

// Pushed by the desktop main process in response to `desktopReady` and after
// every workdir change (message command: 'desktopWorkdirState').
export interface DesktopWorkdirState {
  workdir?: string;
  recentWorkdirs: string[];
}

export interface MessageListProps {
  messages: Message[];
  queuedMessages?: QueuedMessage[];
  isStreaming?: boolean;
  isCompacting?: boolean;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
}

export interface MessageProps {
  message: Message;
  isQueued?: boolean;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
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
  onSendMessage: (text: string, images?: Array<{ data: string; mediaType: string; }>) => void;
  isStreaming: boolean;
  onAbortMessage: () => void;
  onSubmitQueuedEdit?: (id: string, text: string, images?: Array<{ data: string; mediaType: string; }>) => void;
  editingQueuedId?: string | null;
  onCancelQueuedEdit?: () => void;
  shouldClearInput?: boolean;
  onInputCleared?: () => void;
  vscode: VsCodeApi;
  // Selection props
  selection?: SelectionInfo;
  inputContent?: string;
  permissionMode?: PermissionMode;
  initialAttachedImages?: AttachedImage[];
  /** Optional slot rendered at the top-left of the input box (desktop workdir selector). */
  workdirSelector?: React.ReactNode;
  /** Disable the whole input area (e.g. desktop host without a workdir). */
  disabled?: boolean;
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
}

/** Desktop conversation-level side panels. VSCE/JetBrains hosts never render these. */
export type DesktopPanelKind = 'preview' | 'diff' | 'terminal';

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
}

// Matches wave-agent-sdk's QueuedMessage type
export interface QueuedMessage {
  id?: string;
  type?: 'message' | 'bang';
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
  // Compaction in progress — shows the "正在压缩对话…" hint after the blinking
  // cursor at the end of the message list.
  isCompacting: boolean;
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
  activeDialog: 'config' | 'plugin' | 'mcp' | 'status' | 'tasks' | 'workflows' | null;
  configurationData?: ConfigurationData;
  configurationLoading: boolean;
  configurationError?: string;
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
}

export interface ConfirmationDecision {
  behavior: 'allow' | 'deny';
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

export type PluginScope = 'user' | 'project' | 'local';

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

export interface WorkflowManagerProps {
  onCancel: () => void;
}

export type ChatAction =
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'SET_TASKS'; payload: Task[] }
  | { type: 'SET_BACKGROUND_TASKS'; payload: BackgroundTaskSummary[] }
  | { type: 'SET_WORKFLOW_RUNS'; payload: SerializableWorkflowRun[] }
  | { type: 'TOGGLE_TASK_LIST_COLLAPSE' }
  | { type: 'SET_TASK_LIST_COLLAPSED'; payload: boolean }
  | { type: 'TOGGLE_QUEUE_COLLAPSE' }
  | { type: 'START_STREAMING' }
  | { type: 'END_STREAMING' }
  | { type: 'SET_COMPACTING'; payload: boolean }
  | { type: 'INPUT_CLEARED' }
  | { type: 'SET_SESSIONS'; payload: SessionMetadata[] }
  | { type: 'SET_CURRENT_SESSION'; payload: SessionMetadata | undefined }
  | { type: 'SET_SESSIONS_LOADING'; payload: boolean }
  | { type: 'SHOW_CONFIRMATION'; payload: ConfirmationRequest }
  | { type: 'HIDE_CONFIRMATION'; payload: string }
  | { type: 'SHOW_DIALOG'; payload: { type: 'config' | 'plugin' | 'mcp' | 'status' | 'tasks' | 'workflows'; data?: ConfigurationData; error?: string } }
  | { type: 'HIDE_DIALOG' }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }
  | { type: 'SET_CONFIGURATION_LOADING'; payload: boolean }
  | { type: 'SET_CONFIGURATION_ERROR'; payload: string | undefined }
  | { type: 'SET_CONFIGURATION_DATA'; payload: ConfigurationData }
  | { type: 'UPDATE_SELECTION'; payload: SelectionInfo | undefined }
  | { type: 'SET_PERMISSION_MODE'; payload: PermissionMode }
  | { type: 'SET_COMMAND_RUNNING'; payload: boolean }
  | { type: 'SET_WORKDIR'; payload: string }
  | { type: 'SET_QUEUED_MESSAGES'; payload: QueuedMessage[] }
  | { type: 'SET_EDITING_QUEUED_ID'; payload: string | null }
  | { type: 'SET_INITIAL_STATE'; payload: {
      messages: Message[];
      tasks?: Task[];
      isStreaming: boolean;
      isCommandRunning?: boolean;
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
    } }
  // Incremental update actions for streaming optimization
  | { type: 'APPEND_MESSAGE'; payload: Message }
  | { type: 'UPDATE_STREAMING_CONTENT'; payload: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } }
  | { type: 'UPDATE_STREAMING_REASONING'; payload: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } }
  | { type: 'UPDATE_TOOL_BLOCK'; payload: ToolBlockUpdateCallbackParams }
  | { type: 'APPEND_ERROR_BLOCK'; payload: { error: string } };
