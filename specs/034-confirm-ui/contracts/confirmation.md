# Confirmation UI API Contracts

## PermissionDecision (Shared Type)

```typescript
interface PermissionDecision {
  behavior: 'allow' | 'deny';
  message?: string;
  newPermissionMode?: PermissionMode;
  newPermissionRule?: string;
  clearContext?: boolean;
}
```

## ToolPermissionContext (Callback Input)

```typescript
interface ToolPermissionContext {
  toolName: string;
  permissionMode: PermissionMode;
  canUseToolCallback?: PermissionCallback;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  toolCallId?: string;
  planContent?: string;
}
```

## useChat Context Extensions

### `showConfirmation(toolName, toolInput?, suggestedPrefix?, hidePersistentOption?, planContent?): Promise<PermissionDecision>`

Displays the confirmation UI and returns a promise that resolves with the user's decision.

- **Input**: Tool details and context
- **Output**: Promise resolving to `PermissionDecision`
- **Behavior**: Queues the confirmation if another is active

### `handleConfirmationDecision(decision: PermissionDecision): void`

Resolves the current confirmation with the given decision and processes the next in queue.

### `handleConfirmationCancel(): void`

Cancels the current confirmation (rejects the promise) and processes the next in queue.

## ConfirmationDetails Props

```typescript
interface ConfirmationDetailsProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  isExpanded?: boolean;
}
```

## ConfirmationSelector Props

```typescript
interface ConfirmationSelectorProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  isExpanded?: boolean;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
  onAbort: () => void;
}
```

## AskUserQuestion Input Structure

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    multiSelect?: boolean;
    options: Array<{
      label: string;
      description?: string;
    }>;
  }>;
}
```

## Decision Flow

```
Tool Execution Request
        ↓
PermissionManager.check()
        ↓
showConfirmation() → Queue if busy
        ↓
UI Display (ConfirmationDetails + ConfirmationSelector)
        ↓
[If UI height > terminal height]
        ↓
Switch to Static mode (forceStatic = true)
        ↓
User Input (Allow/Deny/Feedback)
        ↓
handleConfirmationDecision()
        ↓
[If no pending confirmations && forceStatic]
        ↓
Exit static mode & requestRemount()
        ↓
Promise resolves with PermissionDecision
        ↓
Tool proceeds or returns denial message
```

## Static Mode & Remount

### `forceStatic` State (ChatInterface)

When `isConfirmationVisible` and the rendered `ChatInterface` height exceeds `terminalHeight`:
1. Set `forceStatic = true`
2. Wrap `ConfirmationDetails` in Ink's `<Static>` component to freeze it

### `requestRemount()` Function

When `forceStatic && !hasPendingConfirmations`:
1. Clear terminal screen: `\u001b[2J\u001b[3J\u001b[0;0H`
2. Increment `remountKey` to force `MessageList` remount
3. Set `forceStatic = false`

This ensures clean UI state after exiting static confirmation mode.
