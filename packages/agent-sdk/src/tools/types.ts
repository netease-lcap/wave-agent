/**
 * Tool plugin interface definitions
 */

import { ChatCompletionFunctionTool } from "openai/resources.js";
import type {
  PermissionMode,
  PermissionCallback,
} from "../types/permissions.js";

import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";

export interface ToolPlugin {
  name: string;
  config: ChatCompletionFunctionTool;
  execute: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
  formatCompactParams?: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => string;
  /**
   * Function to provide a prompt to be added to the tool description
   */
  prompt?: (args?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }) => string;
  /**
   * When true, this tool is deferred — it's not sent to the API until the model
   * discovers it via ToolSearch. MCP tools are always deferred.
   */
  shouldDefer?: boolean;
  /**
   * When true, this tool is never deferred — its full schema always appears in
   * the initial prompt even when tool search is enabled.
   */
  alwaysLoad?: boolean;
  /**
   * When true, this is an MCP tool (auto-set by McpManager). MCP tools are
   * always deferred unless they have alwaysLoad: true.
   */
  isMcp?: boolean;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  // Short output, used to display summary information in collapsed state
  shortResult?: string;
  // File path for operations that affect files
  filePath?: string;
  // Optional starting line number for file operations
  startLineNumber?: number;
  // Image data, for supporting multimedia content
  images?: Array<{
    data: string; // base64 encoded image data
    mediaType?: string; // Image media type, such as "image/png"
  }>;
  // Whether the tool was manually backgrounded by the user (e.g. via Ctrl-B)
  isManuallyBackgrounded?: boolean;
  // Optional metadata for the tool result
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  abortSignal?: AbortSignal;
  backgroundTaskManager?: import("../managers/backgroundTaskManager.js").BackgroundTaskManager;
  workdir: string;
  /** Tool manager instance for tool discovery (used by ToolSearchTool) */
  toolManager?: import("../managers/toolManager.js").ToolManager;
  /** Permission mode for this tool execution */
  permissionMode?: PermissionMode;
  /** Custom permission callback */
  canUseToolCallback?: PermissionCallback;
  /** Permission manager instance for permission checks */
  permissionManager?: import("../managers/permissionManager.js").PermissionManager;
  /** MCP manager instance for calling MCP tools */
  mcpManager?: import("../managers/mcpManager.js").McpManager;
  /** LSP manager instance for code intelligence */
  lspManager?: import("../types/lsp.js").ILspManager;
  /** Reversion manager instance for file snapshots */
  reversionManager?: import("../managers/reversionManager.js").ReversionManager;
  /** Current message ID for associating snapshots */
  messageId?: string;
  /** Foreground task manager for backgrounding tasks */
  foregroundTaskManager?: import("../types/processes.js").IForegroundTaskManager;
  /** Task manager instance for task management */
  taskManager: import("../services/taskManager.js").TaskManager;
  /** Subagent manager instance for agent delegation */
  subagentManager?: import("../managers/subagentManager.js").SubagentManager;
  /** Skill manager instance for skill invocation */
  skillManager?: import("../managers/skillManager.js").SkillManager;
  /** Cron manager instance for scheduling tasks */
  cronManager?: import("../managers/cronManager.js").CronManager;
  /** AI manager instance for AI operations */
  aiManager?: import("../managers/aiManager.js").AIManager;
  /** AI service instance for AI operations */
  aiService?: typeof import("../services/aiService.js");
  /** Message manager instance for message operations */
  messageManager?: import("../managers/messageManager.js").MessageManager;
  /** Current session ID */
  sessionId?: string;
  /** The ID of the current tool call */
  toolCallId?: string;
  /** Callback to update the short result of the current tool block */
  onShortResultUpdate?: (shortResult: string) => void;
  /** Callback to update the full result of the current tool block */
  onResultUpdate?: (result: string) => void;
  /** Limits for file reading operations */
  fileReadingLimits?: {
    maxSizeBytes: number;
    maxTokens: number;
  };
  /** State of files read in the current session for deduplication */
  readFileState?: Map<string, { mtime: number; hash: string }>;
  /** Hook manager instance for executing hooks */
  hookManager?: import("../managers/hookManager.js").HookManager;
}
