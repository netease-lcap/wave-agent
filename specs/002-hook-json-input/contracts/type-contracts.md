# Type Contracts: Hook JSON Input Support

**Phase 1** | **Date**: 2024-12-19 | **Feature**: Hook JSON Input Support

## Core Type Definitions

### HookJsonInput Type Contract

**Location**: `packages/agent-sdk/src/hooks/types.ts`

```typescript
/**
 * JSON data structure passed to hook processes via stdin
 * Contains session context and event-specific information
 */
export interface HookJsonInput {
  /** Unique session identifier (e.g., "wave_session_abc123_def456") */
  session_id: string;
  
  /** Absolute path to session transcript file */
  transcript_path: string;
  
  /** Current working directory when hook is executed */
  cwd: string;
  
  /** Type of hook event that triggered this execution */
  hook_event_name: HookEvent;
  
  /** Tool name for PreToolUse/PostToolUse events */
  tool_name?: string;
  
  /** Tool input parameters for PreToolUse/PostToolUse events */
  tool_input?: unknown;
  
  /** Tool execution result for PostToolUse events only */
  tool_response?: unknown;
  
  /** User prompt text for UserPromptSubmit events only */
  prompt?: string;
}
```

**Type Guarantees:**
- All required fields are non-nullable strings
- Optional fields only present for relevant events
- `unknown` type for tool data allows any JSON-serializable content
- Extends existing type system without breaking changes

---

### ExtendedHookExecutionContext Type Contract

**Location**: `packages/agent-sdk/src/hooks/types.ts`

```typescript
/**
 * Extended execution context with additional data for JSON input construction
 * Backwards compatible with existing HookExecutionContext
 */
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  /** Session identifier for JSON input construction */
  sessionId?: string;
  
  /** Tool input data captured before execution */
  toolInput?: unknown;
  
  /** Tool response data captured after execution */  
  toolResponse?: unknown;
  
  /** User prompt text for UserPromptSubmit events */
  userPrompt?: string;
}
```

**Inheritance Contract:**
- Extends `HookExecutionContext` without modifying existing fields
- All existing code using `HookExecutionContext` continues to work
- Additional fields are optional to maintain backward compatibility
- Type-safe casting: `ExtendedHookExecutionContext` can be used wherever `HookExecutionContext` is expected

---

### JsonInputBuilder Type Contract

**Location**: `packages/agent-sdk/src/hooks/types.ts`

```typescript
/**
 * Interface for constructing JSON input from execution context
 * Provides type-safe JSON construction with error handling
 */
export interface JsonInputBuilder {
  /**
   * Build JSON input object from extended execution context
   * @param context Extended context with optional tool/prompt data
   * @returns Well-formed JSON input object
   * @throws JsonConstructionError for invalid context data
   */
  buildJsonInput(context: ExtendedHookExecutionContext): HookJsonInput;
}

/**
 * Error thrown when JSON input construction fails
 * Non-blocking - executor should handle gracefully
 */
export class JsonConstructionError extends Error {
  constructor(
    public readonly context: ExtendedHookExecutionContext,
    public readonly originalError: Error,
  ) {
    super(`Failed to construct JSON input: ${originalError.message}`);
    this.name = 'JsonConstructionError';
  }
}
```

**Interface Contract:**
- Single responsibility: JSON construction only
- Clear error handling with specific exception type
- Immutable operations - doesn't modify input context
- Testable interface for validation and mocking

---

## Integration Type Contracts

### AIManager Integration Types

**Location**: `packages/agent-sdk/src/managers/aiManager.ts` (type augmentation)

```typescript
/**
 * Tool execution context with session information
 * Used for collecting data at PreToolUse/PostToolUse trigger points
 */
interface ToolExecutionContext {
  /** Name of tool being executed */
  toolName: string;
  
  /** Input parameters passed to tool */
  toolInput: unknown;
  
  /** Tool execution result (PostToolUse only) */
  toolResponse?: unknown;
  
  /** Current session identifier */
  sessionId: string;
  
  /** Project root directory */
  projectDir: string;
  
  /** Execution timestamp */
  timestamp: Date;
}

/**
 * Type guard for validating tool execution context
 */
function isValidToolExecutionContext(ctx: unknown): ctx is ToolExecutionContext {
  if (typeof ctx !== 'object' || ctx === null) return false;
  
  const context = ctx as Record<string, unknown>;
  return (
    typeof context.toolName === 'string' &&
    context.toolInput !== undefined &&
    typeof context.sessionId === 'string' &&
    typeof context.projectDir === 'string' &&
    context.timestamp instanceof Date
  );
}
```

---

### Agent Integration Types

**Location**: `packages/agent-sdk/src/agent.ts` (type augmentation)

```typescript
/**
 * User prompt submission context
 * Used for collecting data at UserPromptSubmit trigger point
 */
interface UserPromptContext {
  /** User's submitted prompt text */
  prompt: string;
  
  /** Current session identifier */
  sessionId: string;
  
  /** Project root directory */
  projectDir: string;
  
  /** Submission timestamp */
  timestamp: Date;
}

/**
 * Type guard for validating user prompt context
 */
function isValidUserPromptContext(ctx: unknown): ctx is UserPromptContext {
  if (typeof ctx !== 'object' || ctx === null) return false;
  
  const context = ctx as Record<string, unknown>;
  return (
    typeof context.prompt === 'string' &&
    context.prompt.length > 0 &&
    typeof context.sessionId === 'string' &&
    typeof context.projectDir === 'string' &&
    context.timestamp instanceof Date
  );
}
```

---

## Event-Specific Type Contracts

### PreToolUse JSON Type

```typescript
/**
 * Type-safe representation of PreToolUse JSON input
 * Ensures required tool fields are present
 */
type PreToolUseJsonInput = HookJsonInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;        // Required for PreToolUse
  tool_input: unknown;      // Required for PreToolUse
  tool_response?: never;    // Not present in PreToolUse
  prompt?: never;           // Not present in PreToolUse
};
```

### PostToolUse JSON Type

```typescript
/**
 * Type-safe representation of PostToolUse JSON input
 * Ensures both tool input and response are present
 */
type PostToolUseJsonInput = HookJsonInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;        // Required for PostToolUse
  tool_input: unknown;      // Required for PostToolUse  
  tool_response: unknown;   // Required for PostToolUse
  prompt?: never;           // Not present in PostToolUse
};
```

### UserPromptSubmit JSON Type

```typescript
/**
 * Type-safe representation of UserPromptSubmit JSON input
 * Ensures prompt field is present, tool fields are not
 */
type UserPromptSubmitJsonInput = HookJsonInput & {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;           // Required for UserPromptSubmit
  tool_name?: never;        // Not present in UserPromptSubmit
  tool_input?: never;       // Not present in UserPromptSubmit
  tool_response?: never;    // Not present in UserPromptSubmit
};
```

### Stop JSON Type

```typescript
/**
 * Type-safe representation of Stop JSON input
 * Only base fields present, no event-specific data
 */
type StopJsonInput = HookJsonInput & {
  hook_event_name: 'Stop';
  tool_name?: never;        // Not present in Stop
  tool_input?: never;       // Not present in Stop
  tool_response?: never;    // Not present in Stop  
  prompt?: never;           // Not present in Stop
};
```

---

## Utility Type Contracts

### Session Path Type

```typescript
/**
 * Type-safe session path operations
 * Ensures consistent path format across system
 */
type SessionPath = string & { readonly __brand: 'SessionPath' };

/**
 * Construct session path from session ID
 * @param sessionId Session identifier
 * @returns Branded session path type
 */
function createSessionPath(sessionId: string): SessionPath {
  const shortId = sessionId.split('_')[2] || sessionId.slice(-8);
  const path = join(homedir(), '.wave', 'sessions', `session_${shortId}.json`);
  return path as SessionPath;
}

/**
 * Type guard for validating session path format
 */
function isValidSessionPath(path: string): path is SessionPath {
  const sessionFileRegex = /\/\.wave\/sessions\/session_[a-zA-Z0-9]+\.json$/;
  return sessionFileRegex.test(path);
}
```

---

### JSON Serialization Type Safety

```typescript
/**
 * Type-safe JSON serialization for hook input
 * Prevents serialization of non-JSON types
 */
type JsonSerializable = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonSerializable[] 
  | { [key: string]: JsonSerializable };

/**
 * Ensure tool data is JSON serializable
 * @param data Unknown tool data
 * @returns JSON-safe representation
 */
function ensureJsonSerializable(data: unknown): JsonSerializable {
  try {
    // Test serialization round-trip
    return JSON.parse(JSON.stringify(data));
  } catch {
    // Return safe fallback for non-serializable data
    return { error: 'Data not JSON serializable', type: typeof data };
  }
}
```

---

## Type Migration Contract

### Backward Compatibility

```typescript
/**
 * Legacy hook execution context support
 * Ensures existing code continues to work
 */
type LegacyHookExecutionContext = HookExecutionContext;

/**
 * Convert extended context to legacy context
 * For code that hasn't migrated to extended context
 */
function toLegacyContext(
  extended: ExtendedHookExecutionContext
): LegacyHookExecutionContext {
  const { sessionId, toolInput, toolResponse, userPrompt, ...legacy } = extended;
  return legacy;
}

/**
 * Convert legacy context to extended context
 * For gradual migration to new context format
 */
function toExtendedContext(
  legacy: LegacyHookExecutionContext,
  additionalData?: {
    sessionId?: string;
    toolInput?: unknown;
    toolResponse?: unknown;
    userPrompt?: string;
  }
): ExtendedHookExecutionContext {
  return {
    ...legacy,
    ...additionalData,
  };
}
```

---

## Type Testing Contracts

### Integration Testing Through Examples
```typescript
/**
 * Real-world validation through executable examples
 * Located in packages/agent-sdk/examples/hook-json-input.ts
 */
interface ExampleTestSuite {
  /** Test actual JSON delivery to hook processes */
  testJsonInputDelivery(): Promise<void>;
  
  /** Test jq parsing in real bash scripts */
  testJqFieldExtraction(): Promise<void>;
  
  /** Test all hook event types with sample data */
  testAllEventTypes(): Promise<void>;
}
```

**Testing Contract:**
- Focus on integration testing with real processes rather than runtime validation
- TypeScript compilation ensures type correctness at build time
- Examples demonstrate practical usage patterns
- No runtime validation overhead in production code