/**
 * Hooks System Type Definitions
 *
 * Provides comprehensive TypeScript types for the Wave Code hooks system,
 * enabling automated actions at specific workflow points.
 */

// Hook event types - trigger points in the AI workflow
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop";

// Alias for consistency with design documents
export type HookEventName = HookEvent;

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
}

// Extended context interface for passing additional data to hook executor
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string; // Session identifier for JSON construction
  transcriptPath?: string; // Path to session transcript file
  cwd?: string; // Current working directory
  toolInput?: unknown; // Tool input parameters (PreToolUse/PostToolUse)
  toolResponse?: unknown; // Tool execution result (PostToolUse only)
  userPrompt?: string; // User prompt text (UserPromptSubmit only)
}

// Environment variables injected into hook processes
export interface HookEnvironment {
  WAVE_PROJECT_DIR: string; // Absolute path to project root
  [key: string]: string; // Inherit all parent process environment variables
}

// =============================================================================
// Hook Output Methods - New Type Definitions  
// =============================================================================

// Exit code interpretation results
export interface HookOutputResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTime: number;
  hookEvent: HookEventName;
}

// Common JSON output fields (all hook types)
export interface BaseHookJsonOutput {
  continue?: boolean;  // defaults to true
  stopReason?: string; // required if continue is false
  systemMessage?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

// Hook-specific output variants
export type HookSpecificOutput = 
  | PreToolUseOutput 
  | PostToolUseOutput 
  | UserPromptSubmitOutput 
  | StopOutput;

export interface PreToolUseOutput {
  hookEventName: "PreToolUse";
  permissionDecision: "allow" | "deny" | "ask";
  permissionDecisionReason: string;
  updatedInput?: Record<string, unknown>;
}

export interface PostToolUseOutput {
  hookEventName: "PostToolUse";
  decision?: "block";
  reason?: string; // required if decision is "block"
  additionalContext?: string;
}

export interface UserPromptSubmitOutput {
  hookEventName: "UserPromptSubmit";
  decision?: "block";
  reason?: string; // required if decision is "block"
  additionalContext?: string;
}

export interface StopOutput {
  hookEventName: "Stop";
  decision?: "block";
  reason?: string; // required if decision is "block"
}

// Hook Output Parser Result Types
export interface ParsedHookOutput {
  source: "json" | "exitcode";
  continue: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificData?: HookSpecificOutput;
  errorMessages: string[];
}

export interface HookValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

// Promise-Based Permission Request Types
export interface PermissionRequest {
  id: string;
  toolName: string;
  reason: string;
  toolInput?: Record<string, unknown>;
  
  // Promise that UI can resolve/reject
  resolve: (allowed: boolean) => void;
  reject: (reason: string) => void;
}

// Permission decision from user/UI
export interface PermissionDecision {
  decision: "allow" | "deny";
  shouldContinueRecursion: boolean;
  reason?: string;
}

// Pending permission structure for management
export interface PendingPermission {
  id: string;
  toolName: string;
  reason: string;
  originalInput: Record<string, unknown>;
  updatedInput?: Record<string, unknown>;
  onResolve: (decision: PermissionDecision) => void;
  timestamp: number;
  pauseAIRecursion: () => void;
  resumeAIRecursion: (shouldContinue: boolean) => void;
}

// Agent Permission Management Methods
export interface AgentPermissionMethods {
  // Get current pending permission requests (for UI display)
  getPendingPermissions(): PermissionRequest[];
  
  // Check if any permissions are pending
  isAwaitingPermission(): boolean;
}

// Hook Permission Processing Result
export interface HookPermissionResult {
  shouldContinue: boolean;
  permissionRequired: boolean;
  permissionPromise?: Promise<boolean>; // Wait for this Promise if permission needed
  updatedInput?: Record<string, unknown>;
  blockReason?: string;
}

// Pre-Tool Use Permission Result
export interface PreToolUseResult {
  shouldProceed: boolean;
  requiresUserPermission?: boolean; // Whether user permission is needed
  permissionRequest?: {
    id: string;
    toolName: string;
    reason: string;
    originalInput: Record<string, unknown>;
    updatedInput?: Record<string, unknown>;
    onResolve: (decision: PermissionDecision) => void;
    timestamp: number;
    pauseAIRecursion: () => void;
    resumeAIRecursion: (shouldContinue: boolean) => void;
  };
  permissionPromise?: Promise<boolean>; // If present, await this Promise
  updatedInput?: Record<string, unknown>;
  blockReason?: string;
}

// Hook Output Processing Error Types
export class HookOutputError extends Error {
  constructor(
    message: string,
    public code: string,
    public hookEvent: HookEventName,
    public originalOutput?: HookOutputResult
  ) {
    super(message);
  }
}

export class HookJsonValidationError extends HookOutputError {
  constructor(
    message: string,
    public validationErrors: ValidationError[],
    hookEvent: HookEventName,
    originalOutput?: HookOutputResult
  ) {
    super(message, "JSON_VALIDATION_FAILED", hookEvent, originalOutput);
  }
}

export class HookPermissionTimeoutError extends HookOutputError {
  constructor(
    toolName: string,
    public timeoutMs: number,
    hookEvent: HookEventName = "PreToolUse"
  ) {
    super(`Permission request timeout for tool: ${toolName}`, "PERMISSION_TIMEOUT", hookEvent);
  }
}
