# Hook Output API Contracts

**Date**: 2025-11-14  
**Version**: 1.0.0  

## TypeScript Interface Contracts

### Core Hook Output Types

```typescript
// Hook event type enumeration
export type HookEventName = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop";

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
  updatedInput?: Record<string, any>;
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
```

### Message Block Contracts

```typescript
// New message block types for hook output
export interface WarnBlock {
  type: "warn";
  content: string;
}

export interface HookBlock {
  type: "hook";
  hookEvent: HookEventName;
  content: string;
  metadata?: Record<string, any>;
}

// Extended MessageBlock union (add to existing type)
export type MessageBlock = 
  | TextBlock 
  | ErrorBlock 
  | ToolBlock 
  | ImageBlock 
  | DiffBlock 
  | CommandOutputBlock 
  | CompressBlock 
  | MemoryBlock 
  | CustomCommandBlock 
  | SubagentBlock
  | WarnBlock      // NEW
  | HookBlock;     // NEW
```

### Hook Output Parser Contract

```typescript
// Parser function signatures
export interface HookOutputParser {
  parseHookOutput(result: HookOutputResult): ParsedHookOutput;
  validateJsonOutput(json: any, hookEvent: HookEventName): ValidationResult;
  createMessageBlocks(parsed: ParsedHookOutput): MessageBlock[];
}

export interface ParsedHookOutput {
  source: "json" | "exitcode";
  continue: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificData?: HookSpecificOutput;
  errorMessages: string[];
}

export interface ValidationResult {
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
```

## React Component Contracts

### Hook UI Components

```typescript
// Warning block component props
export interface WarnBlockProps {
  block: WarnBlock;
  onDismiss?: () => void;
  className?: string;
}

// Hook block component props  
export interface HookBlockProps {
  block: HookBlock;
  onExpand?: () => void;
  className?: string;
}

// Confirmation dialog props for "ask" permission
export interface ConfirmDialogProps {
  toolName: string;
  reason: string;
  onConfirm: (decision: "allow" | "deny") => void;
  onCancel: () => void;
  isOpen: boolean;
}
```

### Hook Context Contract

```typescript
// React context for hook state management with AI flow control
export interface HookContextValue {
  pendingPermissions: PendingPermission[];
  addPendingPermission: (permission: PendingPermission) => void;
  resolvePendingPermission: (id: string, decision: PermissionDecision) => void;
  hookHistory: HookExecutionRecord[];
  clearHookHistory: () => void;
  // AI Manager Flow Control
  isAwaitingPermission: boolean;
  aiManagerFlowControl: AIManagerFlowControl;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  reason: string;
  originalInput: Record<string, any>;
  updatedInput?: Record<string, any>;
  onResolve: (decision: PermissionDecision) => void;
  timestamp: number;
  // Flow control callbacks
  pauseAIRecursion: () => void;
  resumeAIRecursion: (shouldContinue: boolean) => void;
}

export interface PermissionDecision {
  decision: "allow" | "deny";
  reason?: string;
  timestamp: number;
  shouldContinueRecursion: boolean; // true for "allow", false for "deny"
}

export interface HookExecutionRecord {
  id: string;
  hookEvent: HookEventName;
  exitCode: number;
  jsonOutput?: BaseHookJsonOutput;
  executionTime: number;
  timestamp: number;
  blockedRecursion?: boolean; // Whether this hook caused recursion to pause
}

// AI Manager Flow Control Types
export interface RecursionContext {
  recursionDepth: number;
  model?: string;
  allowedTools?: string[];
  toolCalls: ChatCompletionMessageFunctionToolCall[];
  currentToolIndex: number;
  abortController: AbortController;
  toolAbortController: AbortController;
}

export interface AIManagerFlowControl {
  isAwaitingPermission: boolean;
  pendingPermissionId: string | null;
  recursionContext: RecursionContext | null;
  pauseRecursion: (permissionId: string, context: RecursionContext) => void;
  resumeRecursion: (permissionId: string, shouldContinue: boolean) => void;
  abortRecursion: (reason: string) => void;
}
```

## Message Manager Extensions

### New Method Signatures

```typescript
// Extend existing MessageManager interface
export interface MessageManagerExtensions {
  addWarnMessage(content: string, hookEvent?: HookEventName): void;
  addHookMessage(hookEvent: HookEventName, content: string, metadata?: Record<string, any>): void;
  processHookOutput(result: HookOutputResult): void;
}

// Integration with existing addCustomCommandMessage pattern
export interface MessageManagerHookIntegration {
  // Existing method for reference
  addCustomCommandMessage(commandName: string, content: string, originalInput?: string): void;
  
  // New hook-related methods following same pattern
  addWarnMessage(content: string, hookEvent?: HookEventName): void;
  addHookMessage(hookEvent: HookEventName, content: string, metadata?: Record<string, any>): void;
}
```

## Agent Class Extensions

### Promise-Based Permission Resolution

```typescript
// Permission request with Promise-based resolution
export interface PermissionRequest {
  id: string;
  toolName: string;
  reason: string;
  toolInput?: Record<string, any>;
  
  // Promise that UI can resolve/reject
  resolve: (allowed: boolean) => void;
  reject: (reason: string) => void;
}

// Update AgentCallbacks to provide Promise-based permission requests
export interface AgentCallbacks {
  // ... existing callbacks ...
  
  // Called when hook requests user permission - provides Promise to resolve
  onPermissionRequired?: (request: PermissionRequest) => void;
}

// Agent does NOT need resume methods - everything is Promise-based
export interface AgentPermissionMethods {
  // Get current pending permission requests (for UI display)
  getPendingPermissions(): PermissionRequest[];
  
  // Check if any permissions are pending
  isAwaitingPermission(): boolean;
}
```

## Chat Context Extensions

### Promise-Based Permission Management

```typescript
// Extend ChatContextType with Promise-based permission handling
export interface ChatContextType {
  // ... existing properties ...
  
  // Permission management
  pendingPermissions: PermissionRequest[];
  resolvePermission: (permissionId: string, allowed: boolean) => void;
  isAwaitingPermission: boolean;
}

// Internal state management
interface ChatState {
  // ... existing state ...
  
  pendingPermissions: PermissionRequest[];
  isAwaitingPermission: boolean;
}
```

## AI Manager Extensions

```typescript
// AIManager handles permissions via Promises (no pause/resume needed)
export interface AIManagerExtensions {
  // Flow control state
  getPendingPermissionRequests(): PermissionRequest[];
  isAwaitingPermission(): boolean;
  
  // Hook output processing with Promise-based permissions
  processHookOutput(
    result: HookOutputResult, 
    toolName: string, 
    toolInput: Record<string, any>
  ): Promise<HookPermissionResult>;
}

export interface HookPermissionResult {
  shouldContinue: boolean;
  permissionRequired: boolean;
  permissionPromise?: Promise<boolean>; // Wait for this Promise if permission needed
  updatedInput?: Record<string, any>;
  blockReason?: string;
}

// No complex recursion state - just Promise waiting
export interface PreToolUseResult {
  shouldProceed: boolean;
  permissionPromise?: Promise<boolean>; // If present, await this Promise
  updatedInput?: Record<string, any>;
  blockReason?: string;
}
```

### Hook Executor Service Contract

```typescript
// Simplified hook executor with Promise-based permissions
export interface HookExecutorExtensions {
  executePreToolUseWithPromise(
    toolName: string,
    toolInput: Record<string, any>,
    permissionCallback: (request: PermissionRequest) => void
  ): Promise<PreToolUseResult>;
}

export interface PreToolUseResult {
  shouldProceed: boolean;
  requiresUserPermission: boolean;
  permissionRequest?: PendingPermission;
  updatedInput?: Record<string, any>;
  blockReason?: string;
}
```
```

## API Conversion Extensions

### convertMessagesForAPI Updates

```typescript
// Extend existing conversion function to handle new block types
export interface MessageConversionExtensions {
  // Handle warn blocks in message conversion
  convertWarnBlock(block: WarnBlock): ChatCompletionContentPart;
  
  // Handle hook blocks in message conversion  
  convertHookBlock(block: HookBlock): ChatCompletionContentPart;
}

// Integration pattern with existing custom_command conversion
export interface ConversionPatternReference {
  // Existing custom_command conversion (for reference)
  convertCustomCommandBlock(block: CustomCommandBlock): ChatCompletionContentPart;
  
  // New conversions following same pattern
  convertWarnBlock(block: WarnBlock): ChatCompletionContentPart;
  convertHookBlock(block: HookBlock): ChatCompletionContentPart;
}
```

## Error Handling Contracts

### Hook Output Error Types

```typescript
// Error types for hook output processing
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
```

## Testing Contracts

### Test Helper Interfaces

```typescript
// Test utilities for hook output testing
export interface HookOutputTestHelpers {
  createMockHookOutput(exitCode: number, stdout?: string, stderr?: string): HookOutputResult;
  createMockJsonOutput(hookEvent: HookEventName, overrides?: Partial<BaseHookJsonOutput>): string;
  createMockPermissionRequest(toolName: string, decision?: "allow" | "deny" | "ask"): string;
}

// Integration test interfaces
export interface HookIntegrationTestCase {
  name: string;
  hookCommand: string;
  expectedExitCode: number;
  expectedStdout?: string;
  expectedBlocks: MessageBlock[];
  requiresUserInteraction?: boolean;
}
```