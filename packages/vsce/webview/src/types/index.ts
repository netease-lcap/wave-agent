/**
 * TypeScript type definitions for the Wave AI Chat webview
 * 
 * This file contains all the interfaces and types used throughout the React webview,
 * providing type safety and better development experience.
 */

// Import message structures and session types from wave-agent-sdk
import type { Message, MessageBlock, TextBlock, ErrorBlock, ToolBlock, ImageBlock, BangBlock, CompactBlock, ReasoningBlock, PermissionMode, AskUserQuestion, AskUserQuestionInput, AskUserQuestionOption, Task, TaskStatus, TaskNotificationBlock, McpServerStatus, McpServerConfig } from 'wave-agent-sdk/dist/types/index.js';
import type { SessionMetadata, SessionData } from 'wave-agent-sdk/dist/services/session.js';
import type { ToolBlockUpdateCallbackParams } from 'wave-agent-sdk/dist/utils/messageOperations.js';

export type { Message, MessageBlock, TextBlock, ErrorBlock, ToolBlock, ImageBlock, BangBlock, CompactBlock, ReasoningBlock, TaskNotificationBlock, SessionData, SessionMetadata, PermissionMode, AskUserQuestion, AskUserQuestionInput, AskUserQuestionOption, Task, TaskStatus, McpServerStatus, McpServerConfig, ToolBlockUpdateCallbackParams };

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
  /** Flag to identify if this is the upload local files option */
  isUploadOption?: boolean;
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
}

export interface MessageListProps {
  messages: Message[];
  queuedMessages?: QueuedMessage[];
  streamingMessageIndex?: number;
  vscode: VsCodeApi;
  onDeleteQueuedMessage?: (index: number) => void;
  onSendQueuedMessage?: (index: number) => void;
  onRewindToMessage?: (messageId: string) => void;
}

export interface MessageProps {
  message: Message;
  isStreaming?: boolean;
  isQueued?: boolean;
  vscode: VsCodeApi;
  onDeleteQueuedMessage?: () => void;
  onSendQueuedMessage?: () => void;
  onRewindToMessage?: (messageId: string) => void;
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
  disabled: boolean;
  isStreaming: boolean;
  onAbortMessage: () => void;
  onSendQueuedMessage?: () => void;
  shouldClearInput?: boolean;
  onInputCleared?: () => void;
  vscode: VsCodeApi;
  // Selection props
  selection?: SelectionInfo;
  inputContent?: string;
  permissionMode?: PermissionMode;
  initialAttachedImages?: AttachedImage[];
  isTaskListVisible?: boolean;
  onToggleTaskList?: () => void;
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

export interface ChatHeaderProps {
  onClearChat: () => void;
  onAbortMessage: () => void;
  isStreaming: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  onSessionSelect: (sessionId: string) => void;
  sessionsLoading: boolean;
}

// Session selector component props
export interface SessionSelectorProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  onSessionSelect: (sessionId: string) => void;
  loading: boolean;
  disabled: boolean;
}

// Matches wave-agent-sdk's QueuedMessage type
export interface QueuedMessage {
  type?: 'message' | 'bang';
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
  // Legacy alias for backward compat
  text?: string;
}

// Chat state management
export interface ChatState {
  messages: Message[];
  tasks: Task[];
  isTaskListVisible: boolean;
  isTaskListCollapsed: boolean;
  isQueueCollapsed: boolean;
  isStreaming: boolean;
  isCommandRunning: boolean;
  inputDisabled: boolean;
  shouldClearInput: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  sessionsLoading: boolean;
  pendingConfirmations: ConfirmationRequest[];
  queuedMessages: QueuedMessage[];
  // Dialog state
  activeDialog: 'config' | 'plugin' | 'mcp' | 'model' | 'status' | 'login' | null;
  configurationData?: ConfigurationData;
  configurationLoading: boolean;
  configurationError?: string;
  configuredModels: string[];
  currentModel: string;
  currentFastModel: string;
  // Permission mode state
  permissionMode?: PermissionMode;
  // Attached images state
  attachedImages?: AttachedImage[];
  // Input state
  inputContent?: string;
  // Selection state
  selection?: SelectionInfo;
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
  /** Wave server URL for SSO authentication (user-configured value) */
  serverUrl?: string;
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
  /** Environment variable values (read-only, for placeholder display) */
  envServerUrl?: string;
  envApiKey?: string;
  envHeaders?: string;
  envBaseUrl?: string;
  envModel?: string;
  envFastModel?: string;
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
 * Props for the model selector dialog component
 */
export interface ModelDialogProps {
  configurationData: ConfigurationData;
  configuredModels: string[];
  onSave: (config: Partial<ConfigurationData>) => void;
  onClose: () => void;
}

/**
 * Props for the status info dialog component
 */
export interface StatusDialogProps {
  configurationData: ConfigurationData;
  onClose: () => void;
}

/**
 * Props for the SSO login dialog component
 */
export interface LoginDialogProps {
  configurationData: ConfigurationData;
  onClose: () => void;
}

export type ChatAction =
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'SET_TASKS'; payload: Task[] }
  | { type: 'TOGGLE_TASK_LIST_COLLAPSE' }
  | { type: 'SET_TASK_LIST_COLLAPSED'; payload: boolean }
  | { type: 'TOGGLE_QUEUE_COLLAPSE' }
  | { type: 'START_STREAMING' }
  | { type: 'END_STREAMING' }
  | { type: 'SET_INPUT_DISABLED'; payload: boolean }
  | { type: 'INPUT_CLEARED' }
  | { type: 'SET_SESSIONS'; payload: SessionMetadata[] }
  | { type: 'SET_CURRENT_SESSION'; payload: SessionMetadata | undefined }
  | { type: 'SET_SESSIONS_LOADING'; payload: boolean }
  | { type: 'SHOW_CONFIRMATION'; payload: ConfirmationRequest }
  | { type: 'HIDE_CONFIRMATION'; payload: string }
  | { type: 'SHOW_DIALOG'; payload: { type: 'config' | 'plugin' | 'mcp' | 'model' | 'status' | 'login'; data?: ConfigurationData; error?: string } }
  | { type: 'HIDE_DIALOG' }
  | { type: 'SET_CONFIGURATION_LOADING'; payload: boolean }
  | { type: 'SET_CONFIGURATION_ERROR'; payload: string | undefined }
  | { type: 'SET_CONFIGURATION_DATA'; payload: ConfigurationData }
  | { type: 'SET_CONFIGURED_MODELS'; payload: string[] }
  | { type: 'SET_CURRENT_MODELS'; payload: { model: string; fastModel: string } }
  | { type: 'UPDATE_SELECTION'; payload: SelectionInfo | undefined }
  | { type: 'SET_PERMISSION_MODE'; payload: PermissionMode }
  | { type: 'SET_COMMAND_RUNNING'; payload: boolean }
  | { type: 'SET_QUEUED_MESSAGES'; payload: QueuedMessage[] }
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
    } }
  // Incremental update actions for streaming optimization
  | { type: 'APPEND_MESSAGE'; payload: Message }
  | { type: 'UPDATE_STREAMING_CONTENT'; payload: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } }
  | { type: 'UPDATE_STREAMING_REASONING'; payload: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } }
  | { type: 'UPDATE_TOOL_BLOCK'; payload: ToolBlockUpdateCallbackParams };
