/**
 * Hooks System Type Definitions
 *
 * Provides comprehensive TypeScript types for the Wave Code hooks system,
 * enabling automated actions at specific workflow points.
 */

import { join } from "path";
import { homedir } from "os";

// Session path utility (from session.ts)
export function getSessionFilePath(sessionId: string): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  return join(homedir(), ".wave", "sessions", `session_${shortId}.json`);
}

// Hook event types - trigger points in the AI workflow
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop";

// Individual hook command configuration
export interface HookCommand {
  type: "command";
  command: string;
}

// Hook event configuration with optional pattern matching
export interface HookEventConfig {
  matcher?: string; // Required for PreToolUse/PostToolUse, omitted for others
  hooks: HookCommand[];
}

// Root configuration structure for all hook definitions
export interface HookConfiguration {
  hooks: Partial<Record<HookEvent, HookEventConfig[]>>;
}

// Partial hook configuration for loading/merging scenarios
export type PartialHookConfiguration = Partial<
  Record<HookEvent, HookEventConfig[]>
>;

// Direct hook configuration record (for test convenience)
export type HookConfigurationRecord = Record<HookEvent, HookEventConfig[]>;

// Context passed to hook during execution
export interface HookExecutionContext {
  event: HookEvent;
  toolName?: string; // Present for PreToolUse/PostToolUse events
  projectDir: string; // Absolute path for $WAVE_PROJECT_DIR
  timestamp: Date;
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
export interface ValidationResult {
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

// Type guards for runtime validation
export function isValidHookEvent(event: string): event is HookEvent {
  return ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"].includes(
    event,
  );
}

export function isValidHookCommand(cmd: unknown): cmd is HookCommand {
  return (
    typeof cmd === "object" &&
    cmd !== null &&
    "type" in cmd &&
    cmd.type === "command" &&
    "command" in cmd &&
    typeof cmd.command === "string" &&
    cmd.command.length > 0
  );
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
  hook_event_name: HookEvent; // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"

  // Optional fields based on event type
  tool_name?: string; // Present for PreToolUse, PostToolUse
  tool_input?: unknown; // Present for PreToolUse, PostToolUse
  tool_response?: unknown; // Present for PostToolUse only
  user_prompt?: string; // Present for UserPromptSubmit only
  subagent_type?: string; // Present when hook is executed by a subagent
}

// Extended context interface for passing additional data to hook executor
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string; // Session identifier for JSON construction
  transcriptPath?: string; // Path to session transcript file
  cwd?: string; // Current working directory
  toolInput?: unknown; // Tool input parameters (PreToolUse/PostToolUse)
  toolResponse?: unknown; // Tool execution result (PostToolUse only)
  userPrompt?: string; // User prompt text (UserPromptSubmit only)
  subagentType?: string; // Subagent type when hook is executed by a subagent
}

// Environment variables injected into hook processes
export interface HookEnvironment {
  WAVE_PROJECT_DIR: string; // Absolute path to project root
  [key: string]: string; // Inherit all parent process environment variables
}
