# Feature Specification: Confirm UI

**Feature Branch**: `034-confirm-ui`
**Created**: 2026-04-06
**Input**: Existing implementation analysis of confirmation UI components

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Tool Confirmation (Priority: P1)

As a user, I want to be prompted for confirmation before the agent executes sensitive operations, so that I can review and approve or deny each action.

**Why this priority**: This is the core functionality that protects users from unintended or potentially harmful operations by the agent.

**Independent Test**: Can be fully tested by triggering a restricted tool (Bash, Write, Edit), verifying that the confirmation UI appears with correct details, and selecting different options.

**Acceptance Scenarios**:

1. **Given** the agent attempts to run `npm install`, **When** the confirmation UI appears, **Then** the tool name "Bash" and command details are displayed with options to allow, auto-accept, or provide alternative input.
2. **Given** a confirmation is displayed, **When** the user presses ESC, **Then** the operation is cancelled and the agent is notified of the denial.
3. **Given** a confirmation is displayed, **When** the user types text while focused on the alternative option, **Then** the text is captured as feedback for the agent.

---

### User Story 2 - Persistent Permission Mode (Priority: P1)

As a user, I want to set persistent permissions for specific operations, so that I don't have to approve the same operation repeatedly.

**Why this priority**: This improves workflow efficiency by reducing repetitive confirmations for trusted operations.

**Independent Test**: Can be tested by selecting "don't ask again" for a command, then triggering the same command again, and verifying no confirmation appears.

**Acceptance Scenarios**:

1. **Given** the agent attempts to run `mkdir -p src/components`, **When** the user selects "Yes, and don't ask again for: mkdir", **Then** subsequent mkdir commands do not prompt for confirmation in this session.
2. **Given** the agent attempts to run a Bash command with a suggested prefix, **When** the user selects the auto-accept option with the prefix, **Then** all commands matching that prefix are auto-approved.

---

### User Story 3 - Ask User Question Flow (Priority: P2)

As a user, I want to answer clarifying questions from the agent through an interactive UI, so that I can provide direction when the agent needs more context.

**Why this priority**: This enables the agent to gather necessary information for complex or ambiguous tasks.

**Independent Test**: Can be tested by triggering the AskUserQuestion tool and verifying multi-question flow, single/multi-select options, and "Other" text input.

**Acceptance Scenarios**:

1. **Given** the agent asks a question with multiple choice options, **When** the question UI appears, **Then** the user can navigate with arrow keys, select options with space (for multi-select), and submit with Enter.
2. **Given** a multi-question flow, **When** the user answers the first question and presses Enter, **Then** the UI transitions to the next question while preserving the previous answer.
3. **Given** a question with "Other" selected, **When** the user types custom text, **Then** the text is captured and submitted as the answer.

---

### User Story 4 - Plan Mode Approval (Priority: P2)

As a user, I want to review and approve the execution plan before the agent makes changes, so that I can ensure the plan aligns with my intent.

**Why this priority**: This provides control over the agent's actions in plan mode before committing to implementation.

**Independent Test**: Can be tested by completing a plan mode session and verifying the exit plan confirmation appears with plan content and approval options.

**Acceptance Scenarios**:

1. **Given** the agent has completed planning, **When** the exit_plan_mode tool is triggered, **Then** the confirmation UI shows the plan content with options to approve with context clearing or manual approval.
2. **Given** the exit plan confirmation is displayed, **When** the user selects "Yes, clear context and auto-accept edits", **Then** the context is cleared and permission mode changes to acceptEdits.

---

### User Story 5 - Confirmation Queue (Priority: P2)

As a user, I want confirmations to be processed one at a time in a queue, so that I can focus on one decision at a time without being overwhelmed.

**Why this priority**: This ensures a manageable user experience when multiple operations require confirmation simultaneously.

**Independent Test**: Can be tested by triggering multiple restricted operations rapidly and verifying that confirmations appear sequentially, not all at once.

**Acceptance Scenarios**:

1. **Given** three tools are pending confirmation, **When** the first confirmation is resolved, **Then** the second confirmation appears immediately.
2. **Given** a confirmation queue exists, **When** the user presses ESC to cancel the current confirmation, **Then** only the current confirmation is cancelled and the next in queue appears.

---

### Edge Cases

- **What happens when the confirmation UI overflows the terminal height?** The UI switches to Ink's `Static` mode to freeze the confirmation details, preventing flickering and layout thrashing during re-renders. The selector remains interactive below.
- **What happens after the last confirmation is resolved in static mode?** The system requests a remount (`requestRemount()`) which clears the terminal screen and re-renders the message list, ensuring a clean state without the static content.
- **What happens if the user navigates away during confirmation?** The operation remains pending until the user returns to resolve it.
- **What happens if the agent sends multiple confirmations while one is active?** New confirmations are queued and processed sequentially.
- **What happens when "Other" is selected but no text is entered?** The answer should be empty or the UI should prevent submission until text is provided.
- **What happens if the terminal is resized during confirmation?** The UI should re-render and adjust to the new dimensions, potentially switching to static mode if overflow occurs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a confirmation UI when restricted tools (Bash, Write, Edit, ExitPlanMode, AskUserQuestion) are invoked.
- **FR-002**: System MUST show tool name, action description, and relevant details (command, file path, diff preview) in the confirmation details.
- **FR-003**: System MUST provide options to allow, deny with feedback, or set persistent permissions.
- **FR-004**: System MUST support keyboard navigation (arrow keys, Tab) for option selection.
- **FR-005**: System MUST support text input for alternative/deny feedback.
- **FR-006**: System MUST support ESC key to cancel the current confirmation.
- **FR-007**: System MUST queue multiple confirmations and process them sequentially.
- **FR-008**: System MUST provide special UI for AskUserQuestion tool with single/multi-select options and "Other" text input.
- **FR-009**: System MUST support multi-question flows with state preservation between questions.
- **FR-010**: System MUST display plan content in ExitPlanMode confirmation.
- **FR-011**: System MUST switch to static rendering mode when confirmation UI exceeds terminal height to prevent flicker.
- **FR-012**: System MUST trigger a terminal remount (clear screen and re-render) when exiting static mode after all confirmations are resolved.
- **FR-013**: System MUST suggest permission rules based on tool type (e.g., command prefix for Bash, tool name for MCP tools).

### Key Entities *(include if feature involves data)*

- **PermissionDecision**: The user's decision (allow/deny) with optional feedback, mode change, or rule persistence.
- **ConfirmationState**: The current state of the confirmation UI (selected option, input text, cursor position).
- **QuestionState**: The state for AskUserQuestion flow (current question index, selected options, answers).
- **ConfirmationQueue**: A queue of pending confirmations waiting for user resolution.
