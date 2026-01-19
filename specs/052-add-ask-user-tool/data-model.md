# Data Model: Support AskUserQuestion Tool

## Entities

### Question
Represents a single inquiry presented to the user.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `question` | string | The full text of the question. | Required, non-empty |
| `header` | string | Short label for UI display. | Required, max 12 chars |
| `options` | Option[] | List of predefined choices. | 2 to 4 options |
| `multiSelect` | boolean | Whether multiple choices are allowed. | Default: false |

### Option
A single choice within a question.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `label` | string | The text shown to the user. | Required, non-empty |
| `description` | string | Additional context for the choice. | Optional |

### Answer
The user's response to a question.

| Field | Type | Description |
|-------|------|-------------|
| `questionText` | string | The text of the question being answered. |
| `selectedOption` | string | The label of the selected option(s) or custom text from "Other". |

## State Transitions
1. **Pending**: Tool is called by the agent, UI is waiting for user input.
2. **Answered**: User selects option(s) or provides custom text.
3. **Rejected**: User declines to answer the questions.
