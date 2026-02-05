# Feature Specification: Support AskUserQuestion Tool

**Feature Branch**: `052-add-ask-user-tool`  
**Created**: 2026-01-19  
**Status**: Implemented  
**Input**: User description: "support AskUserQuestion tool"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clarify Ambiguous Instructions (Priority: P1)

As an AI agent, when I receive an ambiguous instruction from the user, I want to ask clarifying questions using a structured multiple-choice interface so that I can proceed with the correct understanding of the user's intent.

**Why this priority**: This is the core value of the tool. It prevents the agent from making incorrect assumptions and improves the quality of the interaction.

**Independent Test**: Can be tested by giving the agent an ambiguous task (e.g., "Refactor this function") and verifying that it uses the `AskUserQuestion` tool to ask about the desired refactoring pattern instead of just guessing.

**Acceptance Scenarios**:

1. **Given** the agent is processing a task, **When** it encounters ambiguity, **Then** it MUST call the `AskUserQuestion` tool with relevant options.
2. **Given** the user is presented with questions, **When** the user selects an option, **Then** the agent MUST receive the answer and continue the task based on that choice.

---

### User Story 2 - Choose Between Implementation Approaches (Priority: P2)

As an AI agent, when I have multiple valid ways to implement a feature, I want to present these options to the user so they can decide which approach best fits their needs.

**Why this priority**: Empowers the user to make architectural or design decisions without having to write the code themselves.

**Independent Test**: Can be tested by asking the agent to "Add authentication" and verifying it asks whether to use JWT, OAuth2, or Session-based auth.

**Acceptance Scenarios**:

1. **Given** the agent is in the planning or implementation phase, **When** multiple approaches are identified, **Then** it SHOULD use `AskUserQuestion` to let the user choose.
2. **Given** the options include a recommended one, **Then** the agent SHOULD mark it as "(Recommended)" in the label.

---

### User Story 3 - Gather Requirements in Plan Mode (Priority: P2)

As an AI agent in Plan Mode, I want to ask the user for missing requirements before I finalize my plan, ensuring the plan is accurate and approved.

**Why this priority**: Ensures that the planning phase is interactive and results in a high-quality plan.

**Independent Test**: Can be tested by entering Plan Mode with a vague request and verifying the agent asks questions before calling `ExitPlanMode`.

**Acceptance Scenarios**:

1. **Given** the agent is in Plan Mode, **When** requirements are missing, **Then** it MUST use `AskUserQuestion` to gather them.
2. **Given** the agent is ready to finalize the plan, **Then** it MUST NOT use `AskUserQuestion` for plan approval (it must use `ExitPlanMode` instead).

---

### Edge Cases

- **User provides custom input**: What happens when the user selects "Other" and provides text not in the options? The system must handle this as a valid answer string.
- **Multiple questions**: How does the system handle up to 4 questions at once? The UI must display them clearly and collect all answers.
- **Multi-select answers**: How are multiple selected options returned? They should be returned as a comma-separated string or a similar structured format.
- **Tool rejection**: What if the user declines to answer? The agent should be notified and decide whether to proceed with assumptions or ask again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a built-in tool named `AskUserQuestion`.
- **FR-002**: The tool MUST accept an array of 1 to 4 questions.
- **FR-003**: Each question MUST have a clear question text and a short header (max 12 characters).
- **FR-004**: Each question MUST provide 2 to 4 multiple-choice options.
- **FR-005**: Each option MUST have a label and an optional description.
- **FR-006**: The tool MUST support a `multiSelect` flag for each question to allow multiple answers.
- **FR-007**: The UI MUST provide an "Other" option for every question to allow custom text input.
- **FR-008**: The tool MUST return the user's answers as a mapping from question text to the selected answer(s).
- **FR-009**: In Plan Mode, the agent MUST be instructed to use `AskUserQuestion` for clarifications but NOT for plan approval.
- **FR-010**: The agent MUST be discouraged from asking questions via plain text and encouraged to use this tool instead.
- **FR-011**: `AskUserQuestion` MUST NOT be available when `permissionMode` is set to `bypassPermissions`.

### Key Entities *(include if feature involves data)*

- **Question**: Represents a single inquiry to the user.
    - `question`: The full text of the question.
    - `header`: A short identifier for the question.
    - `options`: A list of predefined choices.
    - `multiSelect`: Whether multiple choices are allowed.
- **Option**: A single choice within a question.
    - `label`: The text shown to the user.
    - `description`: Additional context for the choice.
- **Answer**: The user's response to a question.
    - `questionText`: The text of the question being answered.
    - `selectedOption`: The label of the selected option or custom text.

## Assumptions

- The UI component for rendering these questions already exists or will be implemented as part of the `code` package.
- The `AskUserQuestion` tool will be treated as a "restricted" tool requiring user interaction, similar to `Bash` or `Write`.
- The "Other" option is handled automatically by the UI and doesn't need to be explicitly defined in the tool's input schema by the agent.
