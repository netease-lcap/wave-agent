# Feature Specification: Prompt Engineering Framework

**Feature Branch**: `022-prompt-engineering`  
**Created**: 2026-03-25  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Centralized Prompt Management (Priority: P1)

As a developer, I want to manage all system prompts and tool descriptions in a centralized and structured way so that I can easily update, version, and optimize them without modifying core logic.

**Why this priority**: This is the core value of the feature, enabling better maintainability and iteration of the agent's behavior.

**Independent Test**: Can be tested by verifying that all prompts are moved to a dedicated prompt management system and that the agent still behaves correctly.

**Acceptance Scenarios**:

1. **Given** a set of system prompts and tool descriptions, **When** I move them to the Prompt Engineering Framework, **Then** the agent should still receive the correct prompts during initialization.
2. **Given** the framework is in place, **When** I update a prompt in the framework, **Then** the agent should immediately use the updated prompt in the next session.

---

### User Story 2 - Dynamic Tool Descriptions (Priority: P1)

As a developer, I want to provide dynamic tool descriptions based on the current context (e.g., available subagents, skills, or working directory) so that the agent has the most relevant information for tool selection.

**Why this priority**: This is already partially implemented via `prompt()` in tools, but formalizing it within the framework will make it more robust and easier to manage.

**Independent Test**: Can be tested by verifying that tool descriptions change based on the provided context.

**Acceptance Scenarios**:

1. **Given** a tool with a dynamic prompt, **When** the tool is registered with different contexts, **Then** the tool's description in the OpenAI function call configuration should reflect the correct prompt for each context.

---

### User Story 3 - System-Reminder Message Injection (Priority: P1)

As a developer, I want to inject transient instructions into the conversation as `<system-reminder>` wrapped user messages (not system prompt changes) so that the system prompt stays constant across mode transitions, preserving prompt caching and reducing token costs.

**Why this priority**: Modifying the system prompt mid-session (e.g., appending plan mode instructions) invalidates the entire cached system prompt prefix on every mode change. Injecting instructions as user messages with `<system-reminder>` tags preserves the cache while still delivering contextual instructions to the model. This pattern is used by Claude Code for all dynamic mode-specific guidance.

**Independent Test**: Enter plan mode, verify the system prompt is unchanged from the previous turn and plan mode instructions appear as `<system-reminder>` user messages in the API request.

**Acceptance Scenarios**:

1. **Given** the agent enters plan mode, **When** the next API request is assembled, **Then** plan mode instructions MUST be injected as a `<system-reminder>` wrapped user message, NOT appended to the system prompt.
2. **Given** the agent exits plan mode, **When** the next API request is assembled, **Then** an "exited plan mode" `<system-reminder>` user message MUST be injected (one-time only).
3. **Given** the agent re-enters plan mode after having exited, **When** a plan file already exists, **Then** a re-entry `<system-reminder>` user message MUST be injected instructing the model to read the existing plan and evaluate whether to continue or start fresh.
4. **Given** the system prompt has been cached by a prior request, **When** mode transitions occur, **Then** the system prompt MUST remain byte-identical, enabling cache hit on the system message prefix.

---

### User Story 4 - Throttled Reminder Injection (Priority: P2)

As a developer, I want plan mode reminders to be throttled so they are only injected every N human turns (not on every tool round) to reduce token waste while maintaining constraint awareness.

**Why this priority**: Without throttling, plan mode reminders are injected on every API call (including tool rounds within a single human turn), wasting tokens. Throttling to every 5 human turns reduces cost while periodic full reminders prevent the model from forgetting constraints.

**Independent Test**: Work in plan mode for 10+ turns, verify reminders appear every 5 human turns, alternating between full and sparse versions.

**Acceptance Scenarios**:

1. **Given** plan mode is active and a reminder was just injected, **When** fewer than 5 human turns have passed, **Then** no plan mode reminder is injected.
2. **Given** 5 human turns have passed since the last reminder, **When** the next API request is made, **Then** a plan mode reminder is injected.
3. **Given** every 5th reminder injection, **When** the reminder is injected, **Then** it MUST be the full plan mode instructions (complete 5-phase workflow).
4. **Given** a non-5th reminder injection, **When** the reminder is injected, **Then** it MUST be a short sparse reminder referencing earlier full instructions.

---

### User Story 5 - Override Language for Mode Transitions (Priority: P1)

As a developer, I want `<system-reminder>` instructions injected after mode transitions to include explicit override language (e.g., "This supercedes any other instructions you have received") so that the model understands that the new constraints take precedence over prior tool call history in the conversation.

**Why this priority**: When switching from default/acceptEdits mode to plan mode mid-conversation, the message history contains recent Edit/Write tool calls that may mislead the model into continuing to edit. The override language, combined with the reminder being the most recent instruction the model sees, ensures the model respects the new mode constraints.

**Independent Test**: Have a conversation with Edit/Write tool calls, then enter plan mode, and verify the plan mode reminder contains "supercedes" override language and appears after all prior tool calls in the message stream.

**Acceptance Scenarios**:

1. **Given** the conversation contains recent Edit/Write tool calls, **When** the user enters plan mode, **Then** the plan mode `<system-reminder>` MUST be injected as the last user message in the API request (after all prior tool calls).
2. **Given** the plan mode reminder is injected, **When** the model reads it, **Then** the reminder MUST contain the phrase "This supercedes any other instructions you have received" or equivalent override language.
3. **Given** the plan mode reminder is injected after mode transition, **When** the model attempts to use Edit or Write on any file other than the plan file, **Then** the permission system blocks the action at runtime (defense-in-depth).

---

### Edge Cases

- **Missing Prompts**: What happens when a required prompt is missing from the framework? (System should fall back to a default prompt or show a clear error message).
- **Large Prompts**: How does the system handle very large prompts that might exceed token limits? (Framework should provide tools for prompt compression or truncation).
- **Conflicting Prompts**: How does the system handle conflicting instructions from different prompt sources? (Framework should define a clear precedence order).
- **Rapid Mode Toggling**: When the user rapidly toggles between plan and non-plan mode, `<system-reminder>` messages for both entry and exit should not be injected simultaneously. The exit attachment flag should be cleared when re-entering plan mode.
- **Re-entry After Compaction**: When compaction removes all conversation history including prior `<system-reminder>` messages, the system MUST re-inject the full plan mode reminder (not sparse) since no earlier full instructions exist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a centralized registry for all system prompts.
- **FR-002**: System MUST support dynamic prompt generation based on execution context.
- **FR-003**: System MUST allow tools to provide their own prompts to override or enhance their descriptions.
- **FR-004**: System MUST support prompt versioning and A/B testing.
- **FR-005**: System MUST provide a way to validate prompts against token limits.
- **FR-006**: System MUST support prompt templates with variable substitution.
- **FR-007**: System MUST incorporate best practices from Claude Code (e.g., action safety, collaborator mindset, concise output).
- **FR-008**: System MUST inject mode-specific instructions (e.g., plan mode, plan mode exit, plan mode re-entry) as `<system-reminder>` wrapped user messages rather than system prompt modifications, to preserve the cached system prompt prefix across mode transitions.
- **FR-009**: All `<system-reminder>` injected messages MUST use `isMeta: true` and MUST NOT be rendered in the UI.
- **FR-010**: System MUST include override language ("This supercedes any other instructions you have received") in plan mode `<system-reminder>` messages to ensure the model respects new mode constraints despite prior tool call history.
- **FR-011**: System MUST throttle plan mode `<system-reminder>` injection to every 5 human turns (non-meta, non-tool-result user messages), not on every tool round. Every 5th injected reminder MUST be full instructions; intermediate reminders MUST be sparse.
- **FR-012**: System MUST re-inject the full (not sparse) plan mode `<system-reminder>` after compaction when plan mode is active, since prior reminders are removed by compaction.
- **FR-013**: System MUST track `hasExitedPlanMode` and `needsPlanModeExitAttachment` state flags for one-time injection of re-entry and exit notification `<system-reminder>` messages.

### Key Entities *(include if feature involves data)*

- **Prompt Registry**: A central store for all prompt templates and configurations.
- **Prompt Template**: A string with placeholders that can be filled with context data.
- **Execution Context**: Data about the current session, available tools, and environment used to fill prompt templates.
- **Tool Prompt**: A dynamic description provided by a tool plugin.
