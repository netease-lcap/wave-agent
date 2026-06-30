# Feature Specification: BTW Command

**Feature Branch**: `030-btw-command`
**Created**: 2026-04-15
**Updated**: 2026-06-16

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask a side question (Priority: P1)

As a CLI user, I want to type `/btw <question>` to ask a quick side question so I can get an answer without triggering tool executions or interrupting the main conversation.

**Acceptance Scenarios**:

1. **Given** the user is in the main conversation mode, **When** the user types `/btw <question>` and presses Enter, **Then** the InputBox is hidden and a `BtwDisplay` component appears showing the question and a loading indicator, and the AI responds without calling any tools.
2. **Given** the AI is currently processing another task, **When** the user types `/btw <question>`, **Then** the side question bypasses the main message queue and is processed immediately.
3. **Given** the AI has responded to the side question, **Then** the `BtwDisplay` shows the answer with an "ESC to dismiss" hint.
4. **Given** the side question answer is displayed, **When** the user presses **ESC**, **Then** the `BtwDisplay` is dismissed, the InputBox reappears, and the user returns to the main conversation mode.

---

### User Story 2 - Visual feedback during BTW (Priority: P2)

As a CLI user, I want clear visual indicators when a side question is active so I can distinguish it from the main conversation.

**Acceptance Scenarios**:

1. **Given** a side question is loading, **Then** the `BtwDisplay` shows the question with a yellow indicator.
2. **Given** a side question has been answered, **Then** the `BtwDisplay` shows the question with a green indicator, the answer content, and an "ESC to dismiss" hint.
3. **Given** a side question is active, **Then** the InputBox is hidden until the user dismisses the BTW state.

---

### Edge Cases

- **What happens if the user types `/btw` without a question?** The command is ignored; no BTW state is entered.
- **What happens if the user asks a `/btw` question that would normally trigger a tool?** The specialized `BTW_SYSTEM_PROMPT` prevents tool calling; the AI answers using only its knowledge.
- **Side questions are NOT added to the main chat history or user input history.**

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SDK MUST provide an `AiService.btw()` method that calls the AI with a specialized system prompt preventing tool use.
- **FR-002**: The `Agent` class MUST expose an `askBtw()` method that delegates to `AiService.btw()`.
- **FR-003**: The `/btw` command MUST bypass the main message queue and be processed immediately.
- **FR-004**: Side questions and answers MUST NOT be added to the main chat history or user input history.
- **FR-005**: The CLI MUST render a `BtwDisplay` component showing the question with a status indicator (yellow while loading, green when done).
- **FR-006**: When a side question is active, the InputBox MUST be hidden.
- **FR-007**: After the answer is displayed, `BtwDisplay` MUST show an "ESC to dismiss" hint.
- **FR-008**: Pressing **ESC** MUST dismiss the `BtwDisplay` and restore the InputBox.
- **FR-009**: The `inputReducer` MUST track `btwState` with `question`, `answer`, and `isLoading` fields.
- **FR-010**: The `/btw <question>` command MUST be a one-step flow; bare `/btw` without a question is ignored.
