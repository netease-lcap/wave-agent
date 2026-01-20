# Hooks System API Contract

**Version**: 1.0.0  
**Date**: 2024-12-19  
**Feature**: Hooks Support

## TypeScript Interface Definitions

### Core Configuration Types

```typescript
// Hook event types
type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop';

// Individual hook command
interface HookCommand {
  type: 'command';
  command: string;
}

// Hook event configuration
interface HookEventConfig {
  matcher?: string; // Required for PreToolUse/PostToolUse, omitted for others
  hooks: HookCommand[];
}

// Root configuration structure
interface HookConfiguration {
  hooks: Record<HookEvent, HookEventConfig[]>;
}

// Complete settings structure (extending existing)
interface WaveSettings {
  hooks?: HookConfiguration['hooks'];
  // ... other existing settings
}
```

### Runtime Execution Types

```typescript
// Context passed to hook during execution
interface HookExecutionContext {
  event: HookEvent;
  toolName?: string; // Present for PreToolUse/PostToolUse events
  projectDir: string; // Absolute path for $WAVE_PROJECT_DIR
  timestamp: Date;
}

// Extended execution context with additional data for JSON input construction
interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  userPrompt?: string;
}

// JSON data structure passed to hook processes via stdin
interface HookJsonInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: HookEvent;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
}

// Result of hook execution
interface HookExecutionResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;  
  duration: number; // milliseconds
  timedOut: boolean;
}

// Hook execution options
interface HookExecutionOptions {
  timeout?: number; // milliseconds, default 10000
  cwd?: string; // working directory, defaults to projectDir
}
```

## Hook Manager API

### Core Interface

```typescript
class HookManager {
  // Load configuration from settings files
  loadConfiguration(userSettings?: WaveSettings, projectSettings?: WaveSettings): void;
  
  // Execute hooks for specific event
  executeHooks(event: HookEvent, context: HookExecutionContext): Promise<HookExecutionResult[]>;
  
  // Check if hooks are configured for event
  hasHooks(event: HookEvent, toolName?: string): boolean;
  
  // Validate hook configuration
  validateConfiguration(config: HookConfiguration): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

### Hook Execution Flow

```typescript
// Main execution method signature
async executeHooks(
  event: HookEvent, 
  context: HookExecutionContext
): Promise<HookExecutionResult[]>;

// Tool-specific execution (for PreToolUse/PostToolUse)
async executeToolHooks(
  event: 'PreToolUse' | 'PostToolUse',
  toolName: string,
  projectDir: string
): Promise<HookExecutionResult[]>;

// General event execution (for UserPromptSubmit/Stop)  
async executeEventHooks(
  event: 'UserPromptSubmit' | 'Stop',
  projectDir: string
): Promise<HookExecutionResult[]>;
```

## Pattern Matching API

```typescript
class HookMatcher {
  // Test if pattern matches tool name
  matches(pattern: string, toolName: string): boolean;
  
  // Validate pattern syntax
  isValidPattern(pattern: string): boolean;
  
  // Get pattern type for optimization
  getPatternType(pattern: string): 'exact' | 'glob' | 'regex';
}
```

## Integration Points

### Agent Class Integration

```typescript
// Hook integration points in Agent class
class Agent {
  private hookManager: HookManager;
  
  // Pre-tool execution hook
  private async executePreToolHooks(toolName: string): Promise<void>;
  
  // Post-tool execution hook  
  private async executePostToolHooks(toolName: string): Promise<void>;
  
  // User prompt hook
  private async executeUserPromptHooks(): Promise<void>;
  
  // Stop/completion hook
  private async executeStopHooks(): Promise<void>;
}
```

### Settings Service Integration

```typescript
// Settings service extension
interface ISettingsService {
  // Existing methods...
  
  // Hook-specific settings access
  getHookConfiguration(): HookConfiguration | undefined;
  mergeHookSettings(userHooks?: HookConfiguration, projectHooks?: HookConfiguration): HookConfiguration;
}
```

## Error Handling Contracts

### Exception Types

```typescript
// Hook execution errors (non-blocking)
class HookExecutionError extends Error {
  constructor(
    public readonly hookCommand: string,
    public readonly originalError: Error,
    public readonly context: HookExecutionContext
  );
}

// Configuration validation errors (blocking)
class HookConfigurationError extends Error {
  constructor(
    public readonly configPath: string,
    public readonly validationErrors: string[]
  );
}
```

### Logging Contract

```typescript
interface IHookLogger {
  logHookStart(event: HookEvent, command: string, context: HookExecutionContext): void;
  logHookComplete(event: HookEvent, result: HookExecutionResult): void;
  logHookError(event: HookEvent, error: HookExecutionError): void;
  logConfigurationError(error: HookConfigurationError): void;
}
```

## Environment Variable Contract

### Provided Variables

```typescript
// Environment variables injected into hook processes
interface HookEnvironment {
  WAVE_PROJECT_DIR: string; // Absolute path to project root
  // Inherit all parent process environment variables
}
```

### Usage Examples

```bash
# In hook commands
"command": "eslint \"$WAVE_PROJECT_DIR\"/src/**/*.ts"
"command": "$WAVE_PROJECT_DIR/.wave/scripts/quality-check.sh"  
"command": "cd \"$WAVE_PROJECT_DIR\" && npm test"
```