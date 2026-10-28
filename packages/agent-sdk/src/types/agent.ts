import type { ClientOptions } from "openai";
import type { QueuedMessage } from "../managers/messageQueue.js";
import type {
  Message,
  Logger,
  PermissionMode,
  PermissionCallback,
  ILspManager,
  PluginConfig,
  BackgroundTask,
  McpServerConfig,
  ConfiguredModel,
} from "./index.js";
import type { MessageManagerCallbacks } from "../managers/messageManager.js";
import type { BackgroundTaskManagerCallbacks } from "../managers/backgroundTaskManager.js";
import type { McpManagerCallbacks } from "../managers/mcpManager.js";
import type { SubagentManagerCallbacks } from "../managers/subagentManager.js";
import type { PartialHookConfiguration } from "./configuration.js";
import type { TelemetryConfig } from "./telemetry.js";
import type { HostEntrypoint } from "../constants/telemetry.js";
import type { ToolPlugin } from "../tools/types.js";

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
  /** Wave server URL for SSO authentication (fallback to WAVE_SERVER_URL env var) */
  serverUrl?: string;
  defaultHeaders?: Record<string, string>;
  /** Per-subagent-type headers, merged into defaultHeaders for matching subagents */
  subagentHeaders?: Record<string, Record<string, string>>;
  fetchOptions?: ClientOptions["fetchOptions"];
  fetch?: ClientOptions["fetch"];
  model?: string;
  fastModel?: string;
  /** Vision-capable model used by the builtin vision subagent (resolved from WAVE_VISION_MODEL env var). */
  visionModel?: string;
  maxInputTokens?: number;
  maxTokens?: number;
  /**
   * Per-session override for the inline completion model (defaults to the fast
   * model). The three hosts' settings pages do **not** go through this layer —
   * they write user-level `~/.wave/settings.json`, picked up by the next
   * resolution (same pattern as `autoMemoryEnabled`).
   */
  completionModel?: string;
  /** Per-session override for inline completion. See `completionModel`. */
  completionEnabled?: boolean;
  /**
   * Per-session override for the next-edit suggestion
   * (spec ui/next-edit-suggestion.md). Defaults to off; like completion this is
   * normally set through user-level `~/.wave/settings.json`.
   */
  nextEditEnabled?: boolean;
  /**
   * Preferred language for agent communication, injected verbatim into the
   * system prompt (`# Language\nAlways respond in <value>`). When unset, the
   * resolve chain falls back to `DEFAULT_LANGUAGE` (`zh-CN`).
   */
  language?: string;
  /**
   * Per-session override for auto-memory extraction (程序化会话级覆盖).
   * Takes precedence over settings.json merged config and
   * WAVE_DISABLE_AUTO_MEMORY env; undefined defers to them. 三端设置页的开关
   * **不**经这一层下发——它落用户级 `~/.wave/settings.json`，由实时重载在下一轮
   * 生效（spec core/agent-config.md「设置实时重载」）。
   */
  autoMemoryEnabled?: boolean;
  /**
   * Per-session override for auto-memory extraction frequency (turns). 同
   * `autoMemoryEnabled`：设置页的值不在这一层。
   */
  autoMemoryFrequency?: number;

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
  /**Whether to watch for skill changes - defaults to true */
  watchSkills?: boolean;
  /**
   * Optional list of tool names to always allow.
   * These rules follow the standard permission rule syntax: `ToolName` or `ToolName(pattern)`.
   */
  allowedTools?: string[];
  /**
   * Optional list of tool names to always disallow.
   * These rules follow the standard permission rule syntax: `ToolName` or `ToolName(pattern)`.
   */
  disallowedTools?: string[];
  /**
   * Optional list of additional directories to include in the Safe Zone
   * for this agent session. These directories are listed in the system
   * prompt and treated as safe for file operations (e.g. in acceptEdits mode).
   */
  additionalDirectories?: string[];
  /**
   * Optional MCP server configs to connect at startup.
   * Overrides .mcp.json for specified server names.
   */
  mcpServers?: Record<string, McpServerConfig>;
  /** Custom tools provided by the SDK user, registered alongside built-in tools */
  customTools?: ToolPlugin[];
  /**
   * Optional hook configuration to inject at creation time.
   * File-based hooks (from config.json/.waverc.json) merge on top of these.
   */
  hooks?: PartialHookConfiguration;
  /**
   * Telemetry overrides for this agent. Mainly the in-process door for dynamic
   * OTLP headers: a host that holds a rotating credential (a per-device token it
   * refreshes itself) passes a `headersProvider`, which no JSON config could
   * carry. The environment (`settings.json`'s `env` block, the managed layer, or
   * the OS environment) wins per key over these.
   */
  telemetry?: Partial<TelemetryConfig>;
  /**
   * Which host entrypoint this session belongs to → the `app.entrypoint`
   * attribute (docs/specs/enterprise/opentelemetry.md「宿主入口标识」).
   *
   * Declared by whoever creates the session. Left unset, records simply carry
   * no entrypoint: we never guess one from the process, because a long-lived
   * daemon hosts sessions created from several front ends at once.
   */
  entrypoint?: HostEntrypoint;
  [key: string]: unknown;
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
  onModelChange?: (model: string) => void;
  onConfiguredModelsChange?: (models: ConfiguredModel[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  onCommandRunningChange?: (running: boolean) => void;
  onWorkdirChange?: (newCwd: string) => void;
  /**
   * The session's workspace moved (EnterWorktree / ExitWorktree) — a different
   * event from a Bash `cd`: the conversation now works in another working tree,
   * so the surfaces showing "the project the user is looking at" follow.
   */
  onWorkspaceRootChange?: (workspaceRoot: string) => void;
  onQueuedMessagesChange?: (messages: QueuedMessage[]) => void;
  /** Streaming content from the compaction fork, as a delta of newly produced
   * text (consumers append it; spec: ui/stdio-transport.md「流式通知纯增量负载」
   * 场景 7). Reasoning deltas fall back to this channel when no reasoning
   * callback is provided. */
  onCompactionContentUpdate?: (content: string) => void;
  /** Streaming reasoning from the compaction fork, as a delta. */
  onCompactionReasoningUpdate?: (content: string) => void;
  /**
   * Full content of the plan file right after a successful `Write`/`Edit` of
   * that file (spec: 计划文件更新后刷新计划面板). Hosts use it to refresh an
   * already-open plan panel; it is not emitted for other files.
   */
  onPlanFileUpdated?: (content: string) => void;
}
