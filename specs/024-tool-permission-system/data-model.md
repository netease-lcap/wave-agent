# Data Model: Tool Permission System

## Core Entities

### PermissionMode
**Description**: Configuration setting that determines tool execution behavior
**Fields**:
- `value`: "default" | "bypassPermissions"

**Validation Rules**:
- Must be one of the two allowed string values
- Cannot be null or undefined when specified

**State Transitions**: 
- Can change between modes, but changes ignored during tool execution
- Applied to new operations after current execution completes

---

### PermissionDecision  
**Description**: Result of permission authorization check
**Fields**:
- `behavior`: "allow" | "deny"  
- `message?`: string (required when behavior is "deny")

**Validation Rules**:
- `behavior` must be one of two allowed values
- `message` required when `behavior` is "deny"
- `message` optional when `behavior` is "allow"

**Relationships**:
- Returned by `canUseTool` callback
- Consumed by `PermissionManager`

---

### PermissionCallback
**Description**: Function interface for custom permission logic
**Fields**:
- `toolName`: string (input parameter)
- `return`: Promise\<PermissionDecision\>

**Validation Rules**:
- Must return Promise that resolves to valid PermissionDecision
- Should handle exceptions and reject promise on errors
- `toolName` must be non-empty string

**Relationships**:
- Optional property in `AgentOptions`
- Called by `PermissionManager` before tool execution

---

### ToolPermissionContext
**Description**: Internal context for permission checking
**Fields**:
- `toolName`: string
- `permissionMode`: PermissionMode
- `canUseToolCallback?`: PermissionCallback

**Validation Rules**:
- `toolName` must match registered tool name
- All fields required except `canUseToolCallback`

**Relationships**:
- Created by `ToolManager` 
- Passed to `PermissionManager.checkPermission()`

---

### ConfirmationState
**Description**: UI state for permission confirmation dialog
**Fields**:
- `isVisible`: boolean
- `selectedOption`: "allow" | "alternative"  
- `alternativeText`: string
- `hasUserInput`: boolean
- `toolName`: string

**Validation Rules**:
- `selectedOption` must be one of two allowed values
- `alternativeText` can be empty string
- `hasUserInput` tracks whether user has typed (to hide placeholder)
- `toolName` must be non-empty when `isVisible` is true

**State Transitions**:
- `isVisible`: false → true (when confirmation needed)
- `isVisible`: true → false (after user decision or ESC)
- `selectedOption`: "allow" ⇄ "alternative" (arrow key navigation)
- `hasUserInput`: false → true (when user starts typing, hides placeholder)

**Relationships**:
- Managed by `ConfirmationComponent`
- Influences permission decision result

---

### ChatConfirmationState  
**Description**: Permission confirmation state managed within ChatContext with queue-based sequential processing
**Fields**:
- `isConfirmationVisible`: boolean
- `confirmingTool`: string | undefined
- `confirmationQueue`: Array<ConfirmationQueueItem>
- `currentConfirmation`: ConfirmationQueueItem | null
- `confirmationResolver`: Promise resolver for pending decisions

**Validation Rules**:
- When `isConfirmationVisible` is true, `currentConfirmation` must be defined
- When `isConfirmationVisible` is false, `currentConfirmation` should be null
- Queue can contain multiple items but only one confirmation is active at a time
- Queue items must have valid toolName and resolver functions

**State Transitions**:
- Queue tool: Add to `confirmationQueue` → process if no current confirmation
- Show confirmation: `isConfirmationVisible`: false → true, set `currentConfirmation` from queue
- User decision: Resolve current confirmation → `isConfirmationVisible`: true → false → process next in queue
- ESC pressed: Reject current confirmation, clear state, process next in queue

**Relationships**:
- Managed by `useChat` context hook
- Controls rendering logic in `ChatInterface.tsx`
- Influences `InputBox` vs `ConfirmationComponent` display
- Processes multiple tool calls sequentially

---

### ConfirmationQueueItem
**Description**: Individual item in the confirmation queue for sequential processing
**Fields**:
- `toolName`: string
- `resolver`: (decision: PermissionDecision) => void
- `reject`: () => void

**Validation Rules**:
- `toolName` must be non-empty string
- `resolver` and `reject` must be valid functions
- Created when tool requires confirmation

**Relationships**:
- Stored in `ChatConfirmationState.confirmationQueue`
- Processed sequentially by queue management system

## Entity Relationships

```
AgentOptions
    ├── permissionMode: PermissionMode
    └── canUseTool?: PermissionCallback

ToolManager.execute()
    └── creates ToolPermissionContext
        └── passed to PermissionManager.checkPermission()
            ├── calls PermissionCallback (if provided)
            └── returns PermissionDecision
                └── influences tool execution

useChat Context (ChatContext)
    ├── manages ChatConfirmationState with queue-based processing
    ├── maintains confirmationQueue: Array<ConfirmationQueueItem>
    ├── processes confirmations sequentially via queue management
    ├── provides showConfirmation() function to Agent
    └── controls ChatInterface rendering logic

Multiple Tool Call Flow
    ├── AI returns multiple tool calls
    ├── Each restricted tool creates ConfirmationQueueItem
    ├── Queue processes items sequentially (one confirmation at a time)
    ├── User makes decision for current confirmation
    ├── System advances to next queued confirmation
    └── All tool results batched and returned to AI after queue completion

ChatInterface.tsx
    ├── reads isConfirmationVisible from useChat context  
    ├── conditionally renders InputBox (when isConfirmationVisible is false)
    └── conditionally renders ConfirmationComponent (when isConfirmationVisible is true)

ConfirmationComponent
    ├── manages internal ConfirmationState  
    ├── displays current confirmation from queue (currentConfirmation.toolName)
    ├── calls context.handleConfirmationDecision()
    └── produces PermissionDecision for current queued item
```

## Implementation Notes

1. **Minimalist Design**: Only essential fields included, no over-specification
2. **Flat Structure**: Avoided deep hierarchies, kept relationships simple  
3. **Active Usage**: All entities and fields are actively used in implementation
4. **Type Safety**: All entities map directly to TypeScript interfaces
5. **State Management**: Clear state transitions defined where applicable
6. **Queue-Based Architecture**: Sequential confirmation processing ensures user control while maintaining system responsiveness
7. **Scalable Design**: Queue can handle any number of tool calls without blocking or complex state management