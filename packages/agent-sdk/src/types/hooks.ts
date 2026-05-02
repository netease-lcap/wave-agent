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
  | "SessionStart"
  | "SessionEnd";

// Individual hook command configuration
export interface HookCommand {
  type: "command";
  command: string;
  async?: boolean;
  timeout?: number; // seconds
  pluginRoot?: string; // Plugin directory path for plugin-originated hooks
}

// Hook event configuration with optional pattern matching
export interface HookEventConfig {
  matcher?: string; // Required for PreToolUse/PostToolUse, omitted for others
  hooks: HookCommand[];
}

// Context passed to hook during execution
export interface HookExecutionContext {
  event: HookEvent;
  toolName?: string; // Present for PreToolUse/PostToolUse events
  projectDir: string; // Absolute path for $WAVE_PROJECT_DIR
  timestamp: Date;
  worktreeName?: string; // Present for WorktreeCreate
  worktreePath?: string; // Present for WorktreeRemove
}

// Result of hook execution
export interface HookExecutionResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  duration: number; // milliseconds
  timedOut: boolean;
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

export type SessionStartSource = "startup" | "resume" | "compact";

export type SessionEndSource = "exit" | "stop" | "compact";

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
    "SessionStart",
    "SessionEnd",
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

  if ("timeout" in hookCmd && typeof hookCmd.timeout !== "number") {
    return false;
  }

  if ("pluginRoot" in hookCmd && typeof hookCmd.pluginRoot !== "string") {
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

// JSON structure passed to hooks via stdin
export interface HookJsonInput {
  // Required fields for all events
  session_id: string; // Format: "wave_session_{uuid}_{shortId}"
  transcript_path: string; // Format: "~/.wave/sessions/session_{shortId}.json"
  cwd: string; // Absolute path to current working directory
  hook_event_name: HookEvent; // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "SubagentStop" | "PermissionRequest" | "WorktreeCreate" | "SessionStart"

  // Optional fields based on event type
  tool_name?: string; // Present for PreToolUse, PostToolUse, PermissionRequest
  tool_input?: unknown; // Present for PreToolUse, PostToolUse, PermissionRequest
  tool_response?: unknown; // Present for PostToolUse only
  user_prompt?: string; // Present for UserPromptSubmit only
  subagent_type?: string; // Present when hook is executed by a subagent
  name?: string; // Present for WorktreeCreate events
  source?: SessionStartSource; // Present for SessionStart events
  agent_type?: string; // Present for SessionStart events
  end_source?: SessionEndSource; // Present for SessionEnd events
}

// Extended context interface for passing additional data to hook executor
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string; // Session identifier for JSON construction
  transcriptPath?: string; // Path to session transcript file
  cwd?: string; // Current working directory
  toolInput?: unknown; // Tool input parameters (PreToolUse/PostToolUse)
  toolResponse?: unknown; // Tool execution result (PostToolUse only)
  env?: Record<string, string>; // Additional environment variables (from configuration)
  userPrompt?: string; // User prompt text (UserPromptSubmit only)
  subagentType?: string; // Subagent type when hook is executed by a subagent
  worktreeName?: string; // Worktree name (WorktreeCreate only)
  source?: SessionStartSource; // Session start source (SessionStart only)
  agentType?: string; // Agent type identifier (SessionStart only)
  endSource?: SessionEndSource; // Session end source (SessionEnd only)
}

// Environment variables injected into hook processes
export interface HookEnvironment {
  WAVE_PROJECT_DIR: string; // Absolute path to project root
  [key: string]: string; // Inherit all parent process environment variables
}
