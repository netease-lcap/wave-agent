# Data Model: Confirm UI

## Entities

### PermissionDecision
Represents the user's decision on whether to allow or deny a tool operation.

| Field | Type | Description |
|-------|------|-------------|
| `behavior` | `'allow' \| 'deny'` | Whether to allow or deny the operation. |
| `message` | `string?` | Optional feedback message (required for deny). |
| `newPermissionMode` | `PermissionMode?` | Signal to change the session's permission mode. |
| `newPermissionRule` | `string?` | Signal to persist a new allowed rule (e.g., `Bash(npm)`). |
| `clearContext` | `boolean?` | Signal to clear conversation context (for ExitPlanMode). |

### ConfirmationState
The current state of the confirmation selector UI.

| Field | Type | Description |
|-------|------|-------------|
| `selectedOption` | `'clear' \| 'auto' \| 'allow' \| 'alternative'` | Currently selected option. |
| `alternativeText` | `string` | Text entered for alternative/deny feedback. |
| `alternativeCursorPosition` | `number` | Cursor position in alternative text. |
| `hasUserInput` | `boolean` | Whether user has typed any input. |

### QuestionState
State for AskUserQuestion tool multi-question flows.

| Field | Type | Description |
|-------|------|-------------|
| `currentQuestionIndex` | `number` | Index of the currently displayed question. |
| `selectedOptionIndex` | `number` | Index of the selected option for current question. |
| `selectedOptionIndices` | `Set<number>` | Set of selected indices for multi-select questions. |
| `userAnswers` | `Record<string, string>` | Mapping of question text to user answers. |
| `otherText` | `string` | Text for "Other" custom answer. |
| `otherCursorPosition` | `number` | Cursor position in "Other" text. |
| `savedStates` | `Record<number, SavedQuestionState>` | Saved state per question for navigation. |

### ConfirmationQueueItem
An item in the confirmation queue.

| Field | Type | Description |
|-------|------|-------------|
| `toolName` | `string` | Name of the tool requiring confirmation. |
| `toolInput` | `Record<string, unknown>?` | Tool input parameters. |
| `suggestedPrefix` | `string?` | Suggested prefix for persistent rules. |
| `hidePersistentOption` | `boolean?` | Whether to hide the "don't ask again" option. |
| `planContent` | `string?` | Plan content (for ExitPlanMode). |
| `resolver` | `(decision: PermissionDecision) => void` | Promise resolver for the decision. |
| `reject` | `() => void` | Promise reject function for cancellation. |

### ChatInterface Static Mode State

| Field | Type | Description |
|-------|------|-------------|
| `forceStatic` | `boolean` | Whether to use Ink's `Static` component for confirmation details. |
| `remountKey` | `number` | Counter incremented to trigger component remount. |

## Relationships

- **ConfirmationQueueItem** produces a **PermissionDecision** when resolved.
- **QuestionState** tracks progress through multiple questions in AskUserQuestion.
- **ConfirmationState** determines which decision type is submitted.

## Validation Rules

- `behavior: "deny"` MUST include a `message`.
- `newPermissionRule` should follow the format `ToolName(pattern)`.
- `clearContext` is only valid for ExitPlanMode tool.
- Multi-select questions require at least one selection.
- Single-select questions require exactly one selection.
