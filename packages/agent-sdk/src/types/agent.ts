import type { ClientOptions } from "openai";
import type {
  Message,
  Logger,
  PermissionMode,
  PermissionCallback,
  ILspManager,
  PluginConfig,
  BackgroundTask,
} from "./index.js";
import type { MessageManagerCallbacks } from "../managers/messageManager.js";
import type { BackgroundTaskManagerCallbacks } from "../managers/backgroundTaskManager.js";
import type { McpManagerCallbacks } from "../managers/mcpManager.js";
import type { SubagentManagerCallbacks } from "../managers/subagentManager.js";

/**
 * Configuration options for Agent instances
 *
 * IMPORTANT: This interface is used by both Agent constructor and Agent.create()
 * Any changes to this interface must be compatible with both methods.
 */
export interface AgentOptions {
  // Optional configuration with environment fallbacks
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: ClientOptions["fetchOptions"];
  fetch?: ClientOptions["fetch"];
  model?: string;
  fastModel?: string;
  maxInputTokens?: number;
  maxTokens?: number;
  /** Preferred language for agent communication */
  language?: string;

  // Existing options (preserved)
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  /**Add optional initial messages parameter for testing convenience */
  messages?: Message[];
  /**Working directory - if not specified, use process.cwd() */
  workdir?: string;
  /**Optional custom system prompt - if provided, replaces default system prompt */
  systemPrompt?: string;
  /**Permission mode - defaults to "default" */
  permissionMode?: PermissionMode;
  /**Custom permission callback */
  canUseTool?: PermissionCallback;
  /**Whether to use streaming mode for AI responses - defaults to true */
  stream?: boolean;
  /**Optional custom LSP manager - if not provided, a standalone one will be created */
  lspManager?: ILspManager;
  /**Optional local plugins to load */
  plugins?: PluginConfig[];
  /**
   * Optional list of tool names to enable.
   * - undefined: Enable all built-in tools and plugins (default).
   * - []: Disable all tools.
   * - string[]: Enable only the tools with the specified names.
   */
  tools?: string[];
  /**Optional worktree name */
  worktreeName?: string;
  /**Whether this is a newly created worktree */
  isNewWorktree?: boolean;
  /** Whether to enable auto-memory for persistent project knowledge */
  autoMemoryEnabled?: boolean;
}

export interface AgentCallbacks
  extends MessageManagerCallbacks,
    BackgroundTaskManagerCallbacks,
    McpManagerCallbacks,
    SubagentManagerCallbacks {
  onBackgroundTasksChange?: (tasks: BackgroundTask[]) => void;
  onTasksChange?: (tasks: import("./tasks.js").Task[]) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onSubagentLatestTotalTokensChange?: (
    subagentId: string,
    tokens: number,
  ) => void;
  onBackgroundCurrentTask?: () => void;
}
