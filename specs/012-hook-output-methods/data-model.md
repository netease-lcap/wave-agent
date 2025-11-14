# Data Model: Hook Output Methods

**Date**: 2025-11-14  
**Phase**: 1 - Design & Contracts  

## Entity Definitions

### 1. Hook Output Result

**Purpose**: Represents the complete result of hook execution including both exit code and potential JSON output.

**Fields**:
- `exitCode: number` - Process exit code from hook execution
- `stdout: string` - Standard output content from hook
- `stderr: string` - Standard error content from hook  
- `executionTime: number` - Hook execution time in milliseconds
- `hookEvent: HookEventName` - Type of hook that was executed

**Validation Rules**:
- exitCode must be a valid integer (0-255)
- stdout and stderr are required fields (can be empty strings)
- executionTime must be non-negative
- hookEvent must match valid hook event type

**State Transitions**:
- Raw execution result → Parsed hook output → Message block creation

### 2. Hook JSON Output

**Purpose**: Structured JSON output format for advanced hook control capabilities.

**Common Fields** (all hook types):
- `continue: boolean` - Whether to continue processing (optional, defaults to true)
- `stopReason: string` - Reason for stopping if continue is false
- `systemMessage: string` - Warning message to display to user
- `hookSpecificOutput: HookSpecificOutput` - Hook type-specific data

**Validation Rules**:
- If continue is false, stopReason is required
- systemMessage is optional for all hook types
- hookSpecificOutput must contain valid hookEventName
- JSON precedence: JSON fields override exit code interpretation

**State Transitions**:
- Hook execution → JSON parsing → Validation → Block creation → UI rendering

### 3. Hook Specific Output

**Purpose**: Contains hook event type-specific data and behaviors.

**Base Structure**:
- `hookEventName: HookEventName` - Identifies the hook type for validation

**PreToolUse Variant**:
- `permissionDecision: "allow" | "deny" | "ask"` - Tool execution permission
- `permissionDecisionReason: string` - Explanation for permission decision
- `updatedInput: Record<string, any>` - Modified tool input parameters (optional)

**PostToolUse Variant**:
- `decision: "block" | undefined` - Whether to automatically prompt Wave
- `reason: string` - Automated feedback reason (required if decision is "block")
- `additionalContext: string` - Extra context for Wave's processing (optional)

**UserPromptSubmit Variant**:
- `decision: "block" | undefined` - Whether to block prompt processing
- `reason: string` - Block reason (required if decision is "block", shown to user only)
- `additionalContext: string` - Context to add to Wave processing (optional)

**Stop Variant**:
- `decision: "block" | undefined` - Whether to prevent session termination
- `reason: string` - Required when blocking, shown to Wave

**Validation Rules**:
- hookEventName must match actual hook type being executed
- permissionDecision "ask" requires user confirmation flow
- decision "block" requires non-empty reason field
- updatedInput is validated against original tool input schema

### 4. Warn Block

**Purpose**: Message block type for displaying warning messages to users from any system component.

**Fields**:
- `type: "warn"` - Block type identifier  
- `content: string` - Warning message content

**Validation Rules**:
- content must be non-empty string

**State Transitions**:
- Hook systemMessage → WarnBlock creation → UI rendering → User notification
- AIManager warning → WarnBlock creation → UI rendering → User notification  
- Tool warning → WarnBlock creation → UI rendering → User notification

**Usage**:
- Created by hooks when they output warnings via JSON or exit codes
- Can also be created by AIManager, tools, or other system components
- Provides a standardized way to show warnings across the entire system

### 5. Hook Block  

**Purpose**: Message block type for displaying hook type-specific information to Wave.

**Fields**:
- `type: "hook"` - Block type identifier
- `hookEvent: HookEventName` - Type of hook that generated this block
- `content: string` - Hook-specific content for Wave processing
- `metadata?: Record<string, any>` - Additional hook metadata

**Validation Rules**:
- hookEvent must be valid hook event type
- content must be non-empty string for meaningful Wave context
- metadata is optional and can contain any hook-specific data

**State Transitions**:
- Hook specific output → HookBlock creation → convertMessagesForAPI → AI context

### 6. Permission Decision

**Purpose**: Represents user's decision for PreToolUse "ask" scenarios and controls sendAIMessage recursion flow.

**Fields**:
- `decision: "allow" | "deny"` - User's permission decision
- `toolName: string` - Name of tool being controlled
- `reason?: string` - Optional user-provided reason
- `timestamp: number` - When decision was made
- `shouldContinueRecursion: boolean` - Whether to continue sendAIMessage recursion

**Validation Rules**:
- decision must be "allow" or "deny" 
- toolName must match the tool being evaluated
- timestamp must be valid Unix timestamp
- shouldContinueRecursion: true for "allow", false for "deny"

**State Transitions**:
- Hook output "ask" → **PAUSE sendAIMessage recursion** → User prompt → Decision capture → Resume/abort tool execution → Continue/stop recursion

### 7. Hook Event Context

**Purpose**: React context for managing hook state and user interactions across components.

**State Fields**:
- `pendingPermissions: PendingPermission[]` - Queue of permission requests needing user input
- `hookExecutionHistory: HookExecutionRecord[]` - Recent hook execution results
- `userPreferences: HookUserPreferences` - User's hook interaction preferences
- `isAwaitingPermission: boolean` - Whether system is paused for permission
- `aiManagerCallbacks: AIManagerCallbacks` - Callbacks to control AI manager recursion

**Actions**:
- `addPendingPermission(permission: PendingPermission)` - Queue new permission request and pause AI
- `resolvePendingPermission(id: string, decision: PermissionDecision)` - Complete permission request and resume/abort AI
- `clearHookHistory()` - Clear execution history
- `updateUserPreferences(preferences: Partial<HookUserPreferences>)` - Update user settings

**Validation Rules**:
- pendingPermissions queue has maximum size to prevent memory leaks
- hookExecutionHistory is time-bounded to recent executions only
- userPreferences are validated against available options
- AI manager recursion must be properly paused/resumed

## Relationships

### Hook Output Processing Flow
1. **Hook Execution** produces **Hook Output Result**
2. **Hook Output Result** is parsed to create **Hook JSON Output** (if valid JSON present)
3. **Hook JSON Output** contains **Hook Specific Output** based on event type
4. **Hook Specific Output** generates appropriate **Warn Block** or **Hook Block**
5. **Permission Decision** flow activated for PreToolUse "ask" scenarios

### Message Block Integration  
- **Warn Block** extends existing MessageBlock union type
- **Hook Block** extends existing MessageBlock union type
- Both blocks integrate with convertMessagesForAPI for AI context
- UI components render blocks within existing message rendering system

### State Management
- **Hook Event Context** manages component state across hook interactions
- **Permission Decision** updates are propagated through context to all components
- Hook execution results feed into context for debugging and user feedback

## Data Flow Patterns

### Exit Code Fallback Pattern
```
Hook Execution → Check stdout for JSON → 
  JSON found: Parse and validate JSON output →
  JSON invalid: Interpret exit code → Create appropriate blocks
```

### Permission Request Pattern  
```
PreToolUse hook → JSON output with "ask" → 
  Add to pending permissions → 
  Show confirmation dialog → 
  User decision → 
  Resolve permission → 
  Continue tool execution
```

### Message Routing Pattern
```
Hook output → Determine recipient (Wave vs User) → 
  Create appropriate block type → 
  Route to message system → 
  Render in UI or send to AI
```

## Schema Validation

### JSON Output Schema Structure
- Common fields are always validated consistently across hook types
- Hook-specific fields are validated only when hookEventName matches execution context
- Unknown fields are ignored but logged for debugging
- Required fields missing results in fallback to exit code interpretation

### Type Safety Integration
- All entities have comprehensive TypeScript type definitions
- Runtime validation matches TypeScript interfaces
- Error types provide clear debugging information for malformed hook output
- Type guards ensure safe access to hook-specific fields