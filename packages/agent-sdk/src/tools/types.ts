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

/**
 * Read state recorded for a file by the Read/Write/Edit tools. Used for
 * read-before-write enforcement, staleness detection, Read dedup, and the
 * external-change notification (diffing `content` against the disk).
 */
export interface ReadFileStateEntry {
  /** File mtime (ms) observed when this entry was recorded. */
  mtime: number;
  /** sha256 of the content observed when this entry was recorded. */
  hash: string;
  /**
   * Which tool recorded the entry. Read dedups only entries from Read;
   * "changed" is recorded when an external change was observed and reported.
   */
  source: "read" | "edit" | "write" | "changed";
  /**
   * Content observed when this entry was recorded (full reads and writes
   * only). Serves as the diff baseline for the external-change notification.
   */
  content?: string;
  /** Line offset the entry was recorded at; undefined = full read. */
  offset?: number;
  limit?: number;
}

/** Per-session read state keyed by resolved absolute path. */
export type ReadFileState = Map<string, ReadFileStateEntry>;

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
   * Whether this tool is safe to run in parallel with other tools.
   * Default (undefined) = true (parallel). Set to false for tools that
   * perform read-modify-write on shared resources (e.g. Edit, Write).
   */
  isConcurrencySafe?: boolean;
  /**
   * Opt this tool into deferred loading (see
   * `docs/specs/core/tool-deferred-loading.md`, and the whitelist doctrine in
   * `docs/sdk.md`, 「工具延迟加载」).
   *
   * Two hard rules decide whether a *built-in* tool may carry this flag — both
   * must hold, and neither is something a heuristic can infer from the code:
   *
   * 1. Whitelist only. Built-ins are never deferred by default; only an explicit
   *    `defer: true` here puts a tool into the catalog. Nothing is derived from
   *    schema size, module, or apparent rarity — a missed opt-in costs a few
   *    resident kilobytes, a wrong opt-in silently removes a capability.
   * 2. Capability-type + low frequency + large schema, and its usage must not be
   *    driven by the model reaching for it on its own. Tools the model has to
   *    remember it *can* ask for — task management, mode/interaction switches,
   *    the hot coding path (`Read`/`Edit`/`Write`/`Bash`/`Grep`/`Glob`), and
   *    mechanism-coupled tools such as `Skill` — must stay individually declared.
   *    The full never-defer list is enumerated in the SDK doc.
   */
  defer?: boolean;
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
  // ID of the background task if the command is running in the background
  backgroundTaskId?: string;
  // True if the user manually backgrounded the command (e.g. via Ctrl-B)
  backgroundedByUser?: boolean;
  // True if the command was auto-backgrounded after exceeding the timeout
  assistantAutoBackgrounded?: boolean;
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
  readFileState?: ReadFileState;
  /** Hook manager instance for executing hooks */
  hookManager?: import("../managers/hookManager.js").HookManager;
  /** Callback to notify when the current working directory changes */
  onCwdChange?: (newCwd: string) => void;
  /** Original working directory (before any cd changes) for CWD reset */
  originalWorkdir?: string;
  /** Workflow manager instance for workflow orchestration */
  workflowManager?: import("../managers/workflowManager.js").WorkflowManager;
  /**
   * Per-session merged environment (OS env overlaid with the settings env
   * snapshot) for this session. Tools that spawn subprocesses (Bash, hooks)
   * should merge this on top of `process.env` so settings `env` vars reach
   * the subprocess without polluting other sessions in one stdio process.
   */
  sessionEnv?: Record<string, string>;
}
