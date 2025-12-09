# Hook Execution Service Contract

## Interface Definition

```typescript
interface HookExecutionService {
  // Core execution operations
  executeCommand(command: string, context: HookExecutionContext, options?: HookExecutionOptions): Promise<HookExecutionResult>;
  executeCommands(commands: string[], context: HookExecutionContext, options?: HookExecutionOptions): Promise<HookExecutionResult[]>;
  
  // Validation and safety
  isCommandSafe(command: string): boolean;
  validateExecutionContext(context: HookExecutionContext): ValidationResult;
  
  // JSON input preparation
  buildJsonInput(context: ExtendedHookExecutionContext): Promise<HookJsonInput>;
}

interface HookExecutionContext {
  event: string;
  projectDir: string;
  toolName?: string;
  cwd?: string;
}

interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string;
  transcriptPath?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  userPrompt?: string;
  subagentType?: string;
}

interface HookExecutionOptions {
  timeout?: number;           // Default: 10000ms
  continueOnFailure?: boolean; // Default: false
}

interface HookExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

interface HookJsonInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  user_prompt?: string;
  subagent_type?: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
```

## Service Behaviors

### executeCommand(command: string, context: HookExecutionContext, options?)
**Purpose**: Execute single hook command with proper context
**Input**: Command string, execution context, and optional execution options
**Output**: Command execution result with timing and output information
**Behavior**:
- Validates command safety before execution
- Sets up execution environment with context variables
- Uses process.env for environment variables (no additional passing)
- Handles JSON input for hooks that need structured data
- Manages timeout and process lifecycle
- Returns comprehensive execution result

### executeCommands(commands: string[], context: HookExecutionContext, options?)
**Purpose**: Execute multiple hook commands in sequence
**Input**: Array of command strings, shared context, and options
**Output**: Array of execution results for each command
**Behavior**:
- Executes commands sequentially using executeCommand
- Stops on first failure unless continueOnFailure is true
- Uses same context for all commands in sequence
- Returns results for all executed commands
- Maintains execution order and failure handling

### isCommandSafe(command: string)
**Purpose**: Validate command safety before execution
**Input**: Command string to validate
**Output**: Boolean indicating if command is safe to execute
**Behavior**:
- Checks for dangerous patterns (rm -rf, sudo rm, etc.)
- Validates against disk device access patterns
- Returns true for empty commands (no-op is safe)
- Uses pattern matching for common dangerous operations
- Provides basic security validation

### validateExecutionContext(context: HookExecutionContext)
**Purpose**: Validate execution context before command execution
**Input**: Execution context object
**Output**: Validation result with any context issues
**Behavior**:
- Validates required fields (event, projectDir)
- Checks that projectDir is accessible
- Validates event name format
- Checks optional field formats when present
- Returns validation errors and warnings

### buildJsonInput(context: ExtendedHookExecutionContext)
**Purpose**: Build JSON input data for hook stdin
**Input**: Extended execution context with session and tool information
**Output**: Structured JSON input object for hook consumption
**Behavior**:
- Builds base JSON structure with session and event information
- Adds optional fields based on event type
- Handles transcript path generation when needed
- Includes tool-specific data for tool events
- Returns structured JSON input for hook stdin

## Service Changes from Refactoring

### Removed Functionality
- **Configuration Loading**: No longer calls configuration loading functions
- **Environment Variable Passing**: No longer accepts additionalEnvVars parameter
- **Configuration Management**: No longer embedded with settings.json logic

### Focused Functionality  
- **Pure Execution**: Focuses solely on command execution and process management
- **Context Handling**: Manages execution context and environment setup
- **Safety Validation**: Provides command safety and context validation
- **JSON Input**: Handles structured data input for hooks

### Environment Variable Access
- **Process Environment**: Hooks access environment variables through standard process.env
- **Context Variables**: Execution context (HOOK_EVENT, HOOK_TOOL_NAME, etc.) still injected
- **No Additional Passing**: No longer receives separate environment variables to pass

## Error Handling

### Command Execution Errors
- Command not found: Return failed result with appropriate stderr
- Permission denied: Return failed result with permission error
- Timeout occurred: Return result with timedOut=true and kill process
- Process spawn errors: Return failed result with error message

### Validation Errors
- Unsafe command: Throw validation error before execution
- Invalid context: Throw context validation error
- Missing required context fields: Throw parameter error

### System Errors
- Process management errors: Log error and return failed result
- JSON input preparation errors: Continue execution without JSON input
- Transcript path errors: Continue with empty transcript path

## Dependencies

### Required Dependencies
- Node.js `child_process` module for command execution
- `session` service for transcript path generation
- Type definitions for execution interfaces

### Removed Dependencies
- No dependency on configuration loading functions
- No dependency on environment variable merging
- No dependency on settings.json processing

### Service Dependencies
- Independent execution service
- Consumes environment variables from process.env
- No configuration service dependencies for execution

## Integration Points

### With HookManager
- Receives execution requests from HookManager
- Uses HookManager-provided context for execution
- Returns execution results to HookManager
- No longer handles configuration loading for HookManager

### With Process Environment
- Reads environment variables from process.env
- Sets execution context variables (HOOK_EVENT, etc.)
- No longer manages additional environment variable passing

### With Session Service
- Calls session service for transcript path generation
- Handles session service errors gracefully
- Provides session context to executed hooks

## Backward Compatibility

### Interface Compatibility
- Maintains existing executeCommand and executeCommands signatures
- Removes additionalEnvVars parameter (breaking change)
- All other interfaces remain compatible

### Behavior Compatibility
- Hook execution behavior remains identical
- Environment variable access through process.env maintained
- Command safety validation unchanged
- Timeout and process management unchanged