# Feature Specification: BTW Command

**Feature Branch**: `032-btw-command`
**Created**: 2026-04-15
**Input**: "Allow users to ask side questions via /btw without triggering tools, processed immediately even while the AI is busy."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a side question (Priority: P1)

As a CLI user, I want to type `/btw <question>` to ask a quick side question so I can get an answer without triggering tool executions or interrupting the main conversation.

**Acceptance Scenarios**:

1. **Given** the user is in the main conversation mode, **When** the user types `/btw <question>` and presses Enter, **Then** a `BtwDisplay` component appears showing the question and a loading indicator, and the AI responds without calling any tools.
2. **Given** the AI is currently processing another task, **When** the user types `/btw <question>`, **Then** the side question bypasses the main message queue and is processed immediately.
3. **Given** the AI has responded to the side question, **When** the user presses **ESC**, **Then** the `BtwDisplay` is dismissed and the user returns to the main conversation mode.

---

### User Story 2 - Enter BTW mode interactively (Priority: P2)

As a CLI user, I want to type `/btw` without a question to enter BTW mode so I can type my side question in a dedicated input state.

**Acceptance Scenarios**:

1. **Given** the user is in the main conversation mode, **When** the user types `/btw` and presses Enter, **Then** the input box enters BTW mode with a cyan border and "Type your side question..." placeholder.
2. **Given** the input is in BTW mode, **When** the user types a question and presses Enter, **Then** the side question is submitted and the `BtwDisplay` appears.
3. **Given** the input is in BTW mode, **When** the user presses **ESC**, **Then** BTW mode is dismissed without submitting a question.

---

### User Story 3 - Visual feedback during BTW (Priority: P2)

As a CLI user, I want clear visual indicators when a side question is active so I can distinguish it from the main conversation.

**Acceptance Scenarios**:

1. **Given** a side question is loading, **Then** the `BtwDisplay` shows a yellow status dot and the status line shows `Mode: BTW (ESC to dismiss)`.
2. **Given** a side question has been answered, **Then** the `BtwDisplay` shows a green status dot and the answer content.

---

### Edge Cases

- **What happens if the user asks a `/btw` question that would normally trigger a tool?** The specialized `BTW_SYSTEM_PROMPT` prevents tool calling; the AI answers using only its knowledge.
- **Side questions are NOT added to the main chat history or user input history.**

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SDK MUST provide an `AiService.btw()` method that calls the AI with a specialized system prompt preventing tool use.
- **FR-002**: The `Agent` class MUST expose an `askBtw()` method that delegates to `AiService.btw()`.
- **FR-003**: The `/btw` command MUST bypass the main message queue and be processed immediately.
- **FR-004**: Side questions and answers MUST NOT be added to the main chat history or user input history.
- **FR-005**: The CLI MUST render a `BtwDisplay` component showing the question with a status dot (yellow while loading, green when done).
- **FR-006**: When BTW mode is active, the input box MUST display a cyan border and "Type your side question..." placeholder.
- **FR-007**: The status line MUST display `Mode: BTW (ESC to dismiss)` when a side question is active.
- **FR-008**: Pressing **ESC** MUST dismiss the `BtwDisplay` or exit BTW input mode.
- **FR-009**: The `inputReducer` MUST track `btwState` with `isActive`, `question`, `answer`, and `isLoading` fields.
- **FR-010**: The `inputHandlers` MUST intercept `/btw` commands and the **ESC** key for BTW state management.
