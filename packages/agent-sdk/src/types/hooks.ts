/**
 * Hooks System Type Definitions
 *
 * Provides comprehensive TypeScript types for the Wave Code hooks system,
 * enabling automated actions at specific workflow points.
 */

export type {
  WaveConfiguration,
  HookConfiguration,
  PartialHookConfiguration,
  HookConfigurationRecord,
} from "./configuration.js";

// Hook event types - trigger points in the AI workflow
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop"
  | "SubagentStop"
  | "PermissionRequest"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "CwdChanged"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "PostCompact";

// One-line summary per hook event, aligned with Claude Code's
// HookEventMetadata.summary (hooksConfigManager.ts). Shared by the CLI
// /hooks detail view and the webview settings hooks page; unknown/plugin
// events fall back to displaying the event name itself.
export const HOOK_EVENT_SUMMARIES: Record<HookEvent, string> = {
  PreToolUse: "Before tool execution",
  PostToolUse: "After tool execution",
  UserPromptSubmit: "When the user submits a prompt",
  Stop: "Right before Claude concludes its response",
  SubagentStop:
    "Right before a subagent (Agent tool call) concludes its response",
  PermissionRequest: "When a permission dialog is displayed",
  WorktreeCreate: "Create an isolated worktree for VCS-agnostic isolation",
  WorktreeRemove: "Remove a previously created worktree",
  CwdChanged: "After the working directory changes",
  SessionStart: "When a new session is started",
  SessionEnd: "When a session is ending",
  PreCompact: "Before conversation compaction",
  PostCompact: "After conversation compaction",
};

// Individual hook command configuration
export interface HookCommand {
  type: "command";
  command: string;
  async?: boolean;
  /**
   * Run in the background and wake the model when the command exits with code
   * 2, delivering its output as a system reminder. Implies `async`: a hook that
   * has already returned to the caller has nothing else to do with the result.
   */
  asyncRewake?: boolean;
  timeout?: number; // seconds
  pluginRoot?: string; // Plugin directory path for plugin-originated hooks
  /**
   * The skill directory this command came from. Stamped by
   * `HookManager.registerSkillHooks` on every command of a skill's `hooks`
   * frontmatter; absent for every other source. Two uses: the source a caller
   * displays (`skill:<skillName>`) and the value `${WAVE_SKILL_DIR}` /
   * `${CLAUDE_SKILL_DIR}` resolve to at execution time.
   */
  skillRoot?: string;
  /**
   * The skill's name, for display only (`skill:<name>` on a permission card or
   * a failure log). Unverified author input — show it as plain text, and never
   * match or de-duplicate on it: two skills may share a name.
   */
  skillName?: string;
  /**
   * Retire this command from its own source once it has run **successfully**
   * (exit code 0). A non-zero exit, a timeout or a spawn failure keeps the
   * registration — the author asked "run this for the first call that works",
   * not "run once and give up". Applies to every source (programmatic, plugin,
   * settings, skill); a no-op on `async` / `asyncRewake` commands, whose
   * result nobody is left to read.
   */
  once?: boolean;
}

/**
 * Per-source, per-session registration budget for hooks.
 *
 * One source (a skill, a plugin, the settings file) may contribute at most
 * `maxHooks` commands and `maxMatcherChars` characters of `matcher` across
 * all its events; exceeding either rejects the source as a whole rather than
 * registering the part that fits, because a truncated set of interception hooks
 * is silently wrong — the author sees the ones that stayed and believes the
 * rest are enforcing too. Numbers are Claude Code 2.1.325's (`pdn = 1024`,
 * `KLr = 16384`, issue #3056). Lives beside `HookCommand` so the layers that
 * produce a skill's hooks and the one that spends the budget can share the
 * values without importing `HookManager`.
 */
export const HOOK_SOURCE_LIMITS = {
  maxHooks: 1024,
  maxMatcherChars: 16384,
} as const;

// Hook event configuration with optional pattern matching
export interface HookEventConfig {
  /**
   * Tool events (`PreToolUse` / `PostToolUse` / `PermissionRequest`): matched
   * against the tool name. `SessionStart`: matched against the firing `source`
   * (`startup` / `resume` / `clear` / `compact`), same as Claude Code. Omitted
   * means "every value". Other events have no matcher.
   */
  matcher?: string;
  hooks: HookCommand[];
}

// Context passed to hook during execution
export interface HookExecutionContext {
  event: HookEvent;
  toolName?: string; // Present for PreToolUse/PostToolUse events
  /**
   * Directory the hook process is spawned in. Follows the session's *current*
   * workdir, which drifts whenever the model runs `cd` in the shell (and moves
   * again on EnterWorktree) — so a hook command written as a relative path is
   * only reliable when this happens to be the project root.
   */
  projectDir: string;
  /**
   * Stable session root: the workdir this session was created with. Never
   * follows mid-session `cd` or worktree switches, and is injected as
   * `$WAVE_PROJECT_DIR` — the anchor hook scripts should use for their own
   * paths. Defaults to `projectDir` when omitted (aligned with Claude Code's
   * CLAUDE_PROJECT_DIR).
   */
  sessionRoot?: string;
  timestamp: Date;
  name?: string; // Worktree name (WorktreeCreate only, stdin JSON field `name`)
  worktreePath?: string; // Present for WorktreeRemove
  planFilePath?: string; // Present when in plan mode
}

// Result of hook execution
export interface HookExecutionResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  duration: number; // milliseconds
  timedOut: boolean;
  /** The executed command, tagged onto results by callers that iterate multiple hooks */
  command?: string;
  /**
   * Where the hook came from, for the user-facing error notice: `skill:<name>`
   * for a hook a skill contributed, `plugin:<dir>` for a plugin's. Left
   * undefined for the session's own sources (settings.json / AgentOptions),
   * which is the default case and needs no label.
   *
   * Never interpolated into the model-facing strings: those are verbatim from
   * Claude Code (`PreToolUse:<tool> hook error: <stderr>`), and a prefix there
   * would make the same hook read differently in the two products.
   */
  source?: string;
}

// Hook execution options
export interface HookExecutionOptions {
  timeout?: number; // milliseconds, default 10000
  cwd?: string; // working directory, defaults to projectDir
  continueOnFailure?: boolean; // continue executing remaining hooks on failure
}

// Validation result for hook configuration
export interface HookValidationResult {
  valid: boolean;
  errors: string[];
}

// Hook execution errors (non-blocking)
export class HookExecutionError extends Error {
  constructor(
    public readonly hookCommand: string,
    public readonly originalError: Error,
    public readonly context: HookExecutionContext,
  ) {
    super(`Hook execution failed: ${hookCommand} - ${originalError.message}`);
    this.name = "HookExecutionError";
  }
}

/**
 * A PreToolUse hook refused a tool call.
 *
 * The MCP funnel reports failures by throwing, so a block travels as an error
 * there — but it is a refusal rather than a tool failure, and the funnels must
 * show the model the same hook wording either way. The class is what lets them
 * tell the two apart.
 */
export class HookBlockedToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookBlockedToolError";
  }
}

// Configuration validation errors (blocking)
export class HookConfigurationError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly validationErrors: string[],
  ) {
    super(
      `Hook configuration error in ${configPath}: ${validationErrors.join(", ")}`,
    );
    this.name = "HookConfigurationError";
  }
}

export type SessionStartSource = "startup" | "resume" | "compact" | "clear";

export type SessionEndSource = "exit" | "resume" | "stop" | "compact" | "clear";

// Type guards for runtime validation
export function isValidHookEvent(event: string): event is HookEvent {
  return [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "SubagentStop",
    "PermissionRequest",
    "WorktreeCreate",
    "WorktreeRemove",
    "CwdChanged",
    "SessionStart",
    "SessionEnd",
    "PreCompact",
    "PostCompact",
  ].includes(event);
}

export function isValidHookCommand(cmd: unknown): cmd is HookCommand {
  if (
    typeof cmd !== "object" ||
    cmd === null ||
    !("type" in cmd) ||
    cmd.type !== "command" ||
    !("command" in cmd) ||
    typeof cmd.command !== "string" ||
    cmd.command.length === 0
  ) {
    return false;
  }

  const hookCmd = cmd as Record<string, unknown>;

  if ("async" in hookCmd && typeof hookCmd.async !== "boolean") {
    return false;
  }

  if ("asyncRewake" in hookCmd && typeof hookCmd.asyncRewake !== "boolean") {
    return false;
  }

  if ("timeout" in hookCmd && typeof hookCmd.timeout !== "number") {
    return false;
  }

  if ("pluginRoot" in hookCmd && typeof hookCmd.pluginRoot !== "string") {
    return false;
  }

  if ("skillRoot" in hookCmd && typeof hookCmd.skillRoot !== "string") {
    return false;
  }

  if ("skillName" in hookCmd && typeof hookCmd.skillName !== "string") {
    return false;
  }

  // A wrongly typed optional field is rejected, not ignored — the same call the
  // fields above make. `once: "yes"` is an author error, and dropping it
  // silently would run the hook on every match while the author believes it
  // fires once.
  if ("once" in hookCmd && typeof hookCmd.once !== "boolean") {
    return false;
  }

  return true;
}

export function isValidHookEventConfig(
  config: unknown,
): config is HookEventConfig {
  if (typeof config !== "object" || config === null) return false;

  const cfg = config as Record<string, unknown>;

  // Validate hooks array
  if (!Array.isArray(cfg.hooks) || cfg.hooks.length === 0) return false;
  if (!cfg.hooks.every(isValidHookCommand)) return false;

  // Validate optional matcher
  if ("matcher" in cfg && typeof cfg.matcher !== "string") return false;

  return true;
}

/**
 * The MCP server a tool call belongs to, as it travels in the hook input
 * (Claude Code's `mcp_server`).
 *
 * An object, not a bare name: Claude Code's schema is
 * `{ name, source }` (`0172:9948` defines it, `:9985` puts it on PostToolUse;
 * `0633:159665` fills it from the tool's `mcpInfo`), and a hook that has to tell
 * a user-level server from a plugin-shipped one needs `source`. `source` is an
 * open set there; we fill it with the config scope we know (`user` / `project` /
 * `plugin`) and fall back to `dynamic` for a server registered at runtime, the
 * same default Claude Code uses when a server has no scope.
 */
export interface HookMcpServerRef {
  name: string;
  source: string;
}

// JSON structure passed to hooks via stdin
export interface HookJsonInput {
  // Required fields for all events
  session_id: string; // Format: "wave_session_{uuid}_{shortId}"
  transcript_path: string; // Format: "~/.wave/sessions/session_{shortId}.json"
  cwd: string; // Absolute path to current working directory
  hook_event_name: HookEvent; // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "SubagentStop" | "PermissionRequest" | "WorktreeCreate" | "CwdChanged" | "SessionStart"

  // Optional fields based on event type
  tool_name?: string; // Present for PreToolUse, PostToolUse, PermissionRequest
  tool_input?: unknown; // Present for PreToolUse, PostToolUse, PermissionRequest
  /**
   * PostToolUse only: the tool's own structured result — `ToolResult.data`
   * itself, not a wrapper and not the text the model read.
   *
   * Aligned with Claude Code, whose PostToolUse input is
   * `tool_response: ie()` (= the tool's full Output object; the hook docs read
   * `.tool_response.filePath` for Write). A tool that produces no structured
   * data falls back to `{ content }` — see `toolResponsePayload` in
   * `utils/toolResponse.ts`.
   */
  tool_response?: unknown;
  /** PostToolUse only: the id of the `tool_use` block this result belongs to. */
  tool_use_id?: string;
  /**
   * PostToolUse only: how long the call took, in ms. Measured from the moment
   * the tool call entered the manager, so unlike Claude Code's it also covers
   * the permission prompt (we have no separate permission-time clock).
   */
  duration_ms?: number;
  /** PostToolUse only, MCP tools only: which server answered. */
  mcp_server?: HookMcpServerRef;
  plan_file_path?: string; // Present when in plan mode
  user_prompt?: string; // Present for UserPromptSubmit only
  subagent_type?: string; // Present when hook is executed by a subagent
  name?: string; // Present for WorktreeCreate events
  worktree_path?: string; // Present for WorktreeRemove events
  old_cwd?: string; // Present for CwdChanged events
  new_cwd?: string; // Present for CwdChanged events
  source?: SessionStartSource; // Present for SessionStart events
  agent_type?: string; // Present for SessionStart events
  end_source?: SessionEndSource; // Present for SessionEnd events
  compact_instructions?: string; // Present for PreCompact events
  compact_summary?: string; // Present for PostCompact events
  background_tasks?: BackgroundTaskInfo[]; // Present for Stop events: running background tasks snapshot
  session_crons?: SessionCronInfo[]; // Present for Stop events: session-scoped cron jobs snapshot
  last_assistant_message?: string; // Present for Stop and SubagentStop events: text content of the last assistant message
  // Present for Stop / SubagentStop: `true` when this turn is already a
  // continuation produced by a stop hook that blocked (Claude Code's
  // `stop_hook_active`). A hook that blocks unconditionally uses it as the
  // circuit breaker against looping forever.
  stop_hook_active?: boolean;
  // Permission mode in effect for this turn (`default` / `acceptEdits` /
  // `plan` / `dontAsk` / `bypassPermissions`), same value the tools see.
  permission_mode?: string;
}

// Describes one in-flight background task in the Stop hook input.
// Aligned with Claude Code (v2.1.145+) background_tasks array element schema.
// Conditional fields are populated based on `type`:
//   - "shell":    `command` is set
//   - "subagent": `agent_type` is set
//   - "workflow": `name` is set
export interface BackgroundTaskInfo {
  id: string;
  type: "shell" | "subagent" | "workflow";
  status: string;
  description: string; // Capped at 1000 chars with "… [+N chars]" marker
  command?: string; // Present only for shell tasks (≤1000 chars)
  agent_type?: string; // Present only for subagent tasks
  name?: string; // Present only for workflow tasks
}

// Describes one session-scoped cron job in the Stop hook input.
// Aligned with Claude Code (v2.1.145+) session_crons array element schema.
export interface SessionCronInfo {
  id: string;
  schedule: string; // Cron expression
  recurring: boolean;
  prompt: string;
}

// Extended context interface for passing additional data to hook executor
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string; // Session identifier for JSON construction
  transcriptPath?: string; // Path to session transcript file
  cwd?: string; // Current working directory
  toolInput?: unknown; // Tool input parameters (PreToolUse/PostToolUse)
  toolResponse?: unknown; // PostToolUse only: the tool's `data`, already unwrapped
  toolUseId?: string; // PostToolUse only: id of the tool_use block
  durationMs?: number; // PostToolUse only: call duration in ms
  mcpServer?: HookMcpServerRef; // PostToolUse only: the MCP server that answered
  env?: Record<string, string>; // Additional environment variables (from configuration)
  userPrompt?: string; // User prompt text (UserPromptSubmit only)
  subagentType?: string; // Subagent type when hook is executed by a subagent
  oldCwd?: string; // Previous working directory (CwdChanged only)
  newCwd?: string; // New working directory (CwdChanged only)
  source?: SessionStartSource; // Session start source (SessionStart only)
  agentType?: string; // Agent type identifier (SessionStart only)
  endSource?: SessionEndSource; // Session end source (SessionEnd only)
  compactInstructions?: string; // Custom instructions for PreCompact
  compactSummary?: string; // Summary text for PostCompact
  backgroundTasks?: BackgroundTaskInfo[]; // Running background tasks snapshot (Stop only)
  sessionCrons?: SessionCronInfo[]; // Session-scoped cron jobs snapshot (Stop only)
  lastAssistantMessage?: string; // Text content of last assistant message (Stop and SubagentStop only)
  stopHookActive?: boolean; // Stop / SubagentStop: this turn was already continued by a stop hook
  permissionMode?: string; // Permission mode in effect for this turn
}

// Environment variables injected into hook processes
export interface HookEnvironment {
  WAVE_PROJECT_DIR: string; // Stable session root (see HookExecutionContext.sessionRoot)
  CLAUDE_PROJECT_DIR: string; // Same value under Claude Code's name
  [key: string]: string; // Inherit all parent process environment variables
}
