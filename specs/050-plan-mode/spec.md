# Feature Specification: Support Plan Mode

**Feature Branch**: `050-plan-mode`  
**Created**: 2026-01-19  
**Input**: User description: "support plan mode, system can analyze but not modify files. switch into Plan Mode during a session using Shift+Tab to cycle through permission modes. when plan mode is active, system prompt should have a reminder to llm: \"You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.\" the plan file must in ~/.wave/plans dir and have a random english name."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switching to Plan Mode (Priority: P1)

As a user, I want to switch the system into a "Plan Mode" so that I can have the LLM analyze the codebase and propose a plan without accidentally modifying any files.

**Why this priority**: This is the core functionality of the feature, allowing users to safely explore and plan complex changes.

**Independent Test**: Can be tested by pressing Shift+Tab and verifying that the system enters Plan Mode and a new plan file is created.

**Acceptance Scenarios**:

1. **Given** the system is in "default" mode, **When** the user presses Shift+Tab, **Then** the system switches to "acceptEdits" mode.
2. **Given** the system is in "acceptEdits" mode, **When** the user presses Shift+Tab, **Then** the system switches to "plan" mode.
3. **Given** the system is in "plan" mode, **When** the user presses Shift+Tab, **Then** the system switches back to "default" mode (unless `bypassPermissions` was enabled at start).
4. **Given** the system was started with bypass flags, **When** the user is in "plan" mode and presses Shift+Tab, **Then** the system switches to "bypassPermissions" mode.
5. **Given** the system switches to "plan" mode, **When** the mode is active, **Then** a plan file path with a random English name is determined in `~/.wave/plans/`.
6. **Given** the system is in "plan" mode, **When** the LLM uses the `Write` or `Edit` tool on the designated plan file, **Then** the action is permitted.
7. **Given** the system is in "plan" mode, **When** the user looks at the UI, **Then** there is a clear visual indicator that plan mode is active.

---

### User Story 2 - Planning and Restrictions in plan mode (Priority: P1)

As a user, I want the LLM to be restricted to only editing the plan file while in plan mode, so that my codebase remains untouched during the planning phase.

**Why this priority**: This ensures the safety and integrity of the codebase during the planning process.

**Independent Test**: Can be tested by attempting to edit a non-plan file while in plan mode and verifying it is blocked.

**Acceptance Scenarios**:

1. **Given** the system is in "plan" mode, **When** the LLM attempts to read a file, **Then** the action is permitted.
2. **Given** the system is in "plan" mode, **When** the LLM attempts to edit a file other than the designated plan file, **Then** the action is blocked.
3. **Given** the system is in "plan" mode, **When** the LLM attempts to execute a bash command, **Then** the action is permitted.
4. **Given** the system is in "plan" mode, **When** the LLM edits the plan file, **Then** the action is permitted.

---

### User Story 3 - System Prompt Guidance (Priority: P2)

As a user, I want the LLM to be explicitly told how to behave in plan mode, so that it effectively uses the plan file.

**Why this priority**: Ensures the LLM understands its constraints and the intended workflow.

**Independent Test**: Can be tested by inspecting the system prompt sent to the LLM when plan mode is active.

**Acceptance Scenarios**:

1. **Given** the system is in "plan" mode, **When** a message is sent to the main agent, **Then** the reminder includes the plan file info and instructs the agent to build the plan incrementally by writing to or editing the plan file.
2. **Given** the system is in "plan" mode, **When** a message is sent to a subagent, **Then** the reminder tells the subagent to return findings as text output and does NOT instruct it to write or edit the plan file (since subagents lack Write/Edit tools).

---

### User Story 4 - Approve Plan via ExitPlanMode (Priority: P1)

As an agent in plan mode, I want to use the `ExitPlanMode` tool after I have finished writing my plan to the specified plan file, so that the user can review the plan content from that file and provide approval or feedback.

**Why this priority**: This is the core functionality requested. It enables the transition from planning to execution with user oversight based on the actual plan file content.

**Independent Test**: Can be tested by putting the agent in plan mode, writing a plan to a file, calling `ExitPlanMode`, and verifying that the user sees the plan file content and is prompted for confirmation.

**Acceptance Scenarios**:

1. **Given** the agent is in plan mode and has written a plan to the designated file, **When** the agent calls `ExitPlanMode`, **Then** the user is shown the contents of the plan file and prompted to confirm via the standard `canUseTool` mechanism with three options (navigable via arrow keys).
2. **Given** the user is reviewing the plan from the file, **When** the user selects "Default", **Then** the tool succeeds and the agent exits plan mode into the default execution state.
3. **Given** the user is reviewing the plan from the file, **When** the user selects "Accept Edits", **Then** the tool succeeds and the agent exits plan mode into a state where subsequent edits are automatically accepted.
4. **Given** the user is reviewing the plan from the file, **When** the user chooses to "Tell agent what to do", **Then** the user provides feedback, the tool returns this feedback to the agent, and the agent remains in plan mode to refine the plan.

---

### Edge Cases

- **Directory Creation**: If `~/.wave/plans` does not exist, the system should create it automatically.
- **Name Collisions**: The random English name generator should minimize the chance of collisions, but if a file already exists, it should handle it (e.g., by generating a new name).
- **Session Persistence**: If the session is restarted or messages are compressed, the system MUST reuse the existing plan file path. This is achieved by using a `rootSessionId` (the ID of the first session in the chain) as a seed for deterministic name generation.
- **What happens when `ExitPlanMode` is called outside of plan mode?** The tool MUST NOT be available in the toolset when the agent is not in plan mode. If somehow invoked, it should return an error.
- **How does the system handle multiple calls to `ExitPlanMode`?** If already exiting or if the first call is pending, subsequent calls should be handled gracefully (e.g., ignored or returned as pending).

### User Story 5 - Plan Mode Re-entry Guidance (Priority: P1)

As a user who has previously exited plan mode, I want the system to recognize when I re-enter plan mode so that the agent knows about the existing plan file and can decide whether to continue or start fresh.

**Why this priority**: Without re-entry guidance, the agent may either ignore an existing plan file or assume it's still relevant, leading to wasted work or incorrect plans.

**Independent Test**: Enter plan mode, write a plan, approve ExitPlanMode, re-enter plan mode, and verify the agent receives a re-entry reminder about the existing plan file.

**Acceptance Scenarios**:

1. **Given** the agent has exited plan mode and a plan file exists, **When** the user re-enters plan mode, **Then** a re-entry `<system-reminder>` is injected instructing the model to read the existing plan, evaluate if the task is the same or different, and always edit the plan file before ExitPlanMode.
2. **Given** the agent has exited plan mode but no plan file exists, **When** re-entering plan mode, **Then** no re-entry reminder is injected (treat as first entry).
3. **Given** the re-entry reminder has been injected once, **When** subsequent turns occur in plan mode, **Then** the re-entry reminder is NOT re-injected (one-time only).

---

### User Story 6 - Mode Transition Awareness (Priority: P1)

As a user switching from default/acceptEdits mode to plan mode mid-conversation, I want the agent to immediately understand it must stop editing and switch to planning, even though the conversation history contains recent Edit/Write tool calls.

**Why this priority**: Without mode boundary awareness, the model may continue editing based on recent tool call history, ignoring the plan mode constraint.

**Independent Test**: Have a conversation with Edit/Write calls, then enter plan mode, and verify the plan mode reminder appears as the last instruction with explicit override language.

**Acceptance Scenarios**:

1. **Given** the conversation contains recent Edit/Write tool calls and the user enters plan mode, **When** the next API call is made, **Then** the plan mode `<system-reminder>` is injected as the last instruction the model sees (after all prior tool calls), explicitly stating "This supercedes any other instructions you have received."
2. **Given** the agent is in plan mode, **When** the agent attempts to use Edit or Write on any file other than the plan file, **Then** the permission system blocks the action at runtime.

---

### User Story 7 - Plan Mode Exit Notification (Priority: P2)

As a user who has just approved a plan, I want the agent to be explicitly told it has exited plan mode and can now take actions, so there is no confusion about the mode transition.

**Why this priority**: Prevents the agent from continuing to behave as if it's still in plan mode after approval.

**Independent Test**: Approve ExitPlanMode and verify an "exited plan mode" system-reminder appears on the next turn.

**Acceptance Scenarios**:

1. **Given** ExitPlanMode is approved, **When** the next API turn begins, **Then** an "exited plan mode" `<system-reminder>` is injected as a one-time message.
2. **Given** the exit notification was injected, **When** the following turn begins, **Then** the exit notification is NOT injected again (one-time only).

---

### User Story 8 - Throttled Plan Mode Reminders (Priority: P2)

As a user working in plan mode for an extended session, I want the plan mode reminders to be throttled so they don't waste tokens on every tool round, but I still want periodic full instructions to prevent the agent from forgetting constraints.

**Why this priority**: Sending full plan mode instructions on every tool round wastes tokens; throttling reduces cost while maintaining constraint awareness.

**Independent Test**: Work in plan mode for multiple turns and verify reminders appear every 5 human turns, alternating between full and sparse.

**Acceptance Scenarios**:

1. **Given** plan mode is active and a full reminder was just injected, **When** fewer than 5 human turns have passed, **Then** no plan mode reminder is injected.
2. **Given** plan mode is active and 5 human turns have passed since the last reminder, **When** the next API call is made, **Then** a plan mode reminder is injected.
3. **Given** every 5th plan mode reminder injection, **When** the reminder is injected, **Then** it is the full 5-phase workflow instructions.
4. **Given** a non-5th plan mode reminder injection, **When** the reminder is injected, **Then** it is a short sparse reminder referencing the earlier full instructions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a "plan" permission state.
- **FR-002**: Users MUST be able to cycle through permission modes in the following order: default -> acceptEdits -> plan -> default, using the Shift+Tab keyboard shortcut.
- **FR-002.1**: `bypassPermissions` MUST ONLY be included in the cycle if the session was started with `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`.
- **FR-003**: When in plan mode, the system MUST restrict the LLM to read-only actions for all files except the designated plan file.
- **FR-004**: When in plan mode, the system MUST allow the LLM to execute commands.
- **FR-005**: When plan mode is activated, the system MUST determine a plan file path in `~/.wave/plans/` with a human-readable name (adjective-noun format). This name MUST be deterministic within a session chain by using the `rootSessionId` as a seed, ensuring the same plan file is reused even after message compression or session restoration.
- **FR-006**: When plan mode is active, the system MUST inject a `<system-reminder>` wrapped user message (isMeta: true) into the conversation messages. This preserves prompt caching by keeping the system prompt constant across mode changes. The reminder content depends on the recipient:
  - **Main agent**: The reminder MUST contain the plan file info and instruct the agent to build the plan incrementally by writing to or editing the plan file:
    ```text
    Plan mode is active. ... you MUST NOT make any edits (with the exception of the plan file mentioned below) ...

    ## Plan File Info:
    ${planFileInfo}
    You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this is the only allowed to take READ-ONLY actions.
    ```
  - **Subagent**: The reminder MUST NOT instruct the subagent to write or edit the plan file, since subagents (especially Plan subagents) do not have access to Write/Edit tools. Instead, it MUST tell the subagent to return findings as text output and that the parent agent will write the plan file. The subagent reminder MAY include the plan file path for reading context when the file already exists:
    ```text
    Plan mode is active. ... your role is to explore the codebase and return your findings as text output. Do NOT attempt to write or edit any files — the parent agent will write the plan file based on your text response.

    ## Plan File Info:
    ${subagentPlanFileInfo}
    ```
- **FR-007**: The system MUST ensure the `~/.wave/plans/` directory exists before creating a plan file.
- **FR-008**: The system MUST provide visual feedback to the user indicating the current permission mode.
- **FR-009**: System MUST provide a tool named `ExitPlanMode`.
- **FR-009.1**: The tool description MUST include: "Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval."
- **FR-009.2**: The tool documentation MUST explain that the agent should have already written the plan to the file specified in the system message, and that the tool does not take plan content as a parameter.
- **FR-010**: `ExitPlanMode` tool MUST trigger a confirmation request to the user that offers three specific choices:
    - **Option 1: Default**: Exit plan mode and proceed with standard execution.
    - **Option 2: Accept Edits**: Exit plan mode and proceed in a mode where edits are automatically accepted.
    - **Option 3: Feedback**: Provide instructions/feedback to the agent and remain in plan mode.
- **FR-011**: The confirmation request MUST reuse the existing `canUseTool` mechanism, extending it if necessary to support these three specific response types.
- **FR-011.1**: The system MUST display the contents of the plan file to the user during the confirmation process.
- **FR-012**: Upon user selection of "Default" or "Accept Edits", the system MUST transition the agent out of "plan mode" into the respective target mode.
- **FR-013**: Upon user selection of "Feedback", the agent MUST remain in "plan mode" and receive the user's input as the tool's output.
- **FR-014**: `ExitPlanMode` MUST ONLY be included in the available tools list when the agent is in "plan mode".
- **FR-015**: If the agent is NOT in "plan mode", the `ExitPlanMode` tool MUST NOT be exposed to the LLM.
- **FR-016**: `ExitPlanMode` MUST NOT be available when `permissionMode` is set to `bypassPermissions`.
- **FR-017**: When used via the ACP bridge, `ExitPlanMode` MAY provide a simplified approval process (e.g., "Approve Plan" and "Reject Plan") and automatically transition to `default` mode upon approval.
- **FR-018**: System MUST track `hasExitedPlanMode` state. When the agent exits plan mode (via ExitPlanMode or mode transition), this flag MUST be set to true.
- **FR-019**: When entering plan mode and `hasExitedPlanMode` is true and a plan file already exists, the system MUST inject a re-entry `<system-reminder>` message instructing the model to: (a) read the existing plan file, (b) evaluate whether the user's request is a new task or continuation, (c) always edit the plan file before calling ExitPlanMode. The flag MUST be cleared after injection (one-time).
- **FR-020**: When plan mode is active, the system MUST inject plan mode reminders every 5 human turns (non-meta, non-tool-result user messages), not on every tool round. Every 5th reminder MUST be the full instructions; intermediate reminders MUST be sparse (short reminder referencing earlier full instructions).
- **FR-021**: When exiting plan mode, the system MUST inject a one-time "exited plan mode" `<system-reminder>` message on the next turn, notifying the model it can now make edits and take actions. If the plan file exists, the message MUST include the plan file path for reference.
- **FR-022**: All plan mode `<system-reminder>` messages MUST use `isMeta: true` and MUST NOT be rendered in the UI.
- **FR-023**: After compaction, if plan mode is active, the system MUST re-inject the full plan mode reminder so the model retains its instructions.
- **FR-024**: The `hasExitedPlanMode` flag MUST be tracked in `PermissionManager` and persist across mode transitions within the same session.
- **FR-025**: The "needs plan mode exit attachment" flag (`needsPlanModeExitAttachment`) MUST be set when transitioning away from plan mode and cleared after the exit `<system-reminder>` is injected (one-time).

### Key Entities

- **Permission Mode**: Represents the current restriction level of the system (e.g., default, plan).
- **Plan File**: A markdown file located in `~/.wave/plans/` used by the LLM to document its plan during plan mode.
- **Plan Mode State**: A state within the agent's lifecycle where it is generating or proposing a sequence of actions.
- **ExitPlanMode Tool**: The specific tool used to transition out of the Plan Mode State.
