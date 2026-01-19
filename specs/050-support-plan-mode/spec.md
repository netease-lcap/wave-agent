# Feature Specification: Support Plan Mode

**Feature Branch**: `050-support-plan-mode`  
**Created**: 2026-01-19  
**Status**: Draft  
**Input**: User description: "support plan mode, system can analyze but not modify files or execute commands. switch into Plan Mode during a session using Shift+Tab to cycle through permission modes. when plan mode is active, system prompt should have a reminder to llm: \"You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.\" the plan file must in ~/.wave/plans dir and have a random english name."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switching to Plan Mode (Priority: P1)

As a user, I want to switch the system into a "Plan Mode" so that I can have the LLM analyze the codebase and propose a plan without accidentally modifying any files or running commands.

**Why this priority**: This is the core functionality of the feature, allowing users to safely explore and plan complex changes.

**Independent Test**: Can be tested by pressing Shift+Tab and verifying that the system enters Plan Mode and a new plan file is created.

**Acceptance Scenarios**:

1. **Given** the system is in "default" mode, **When** the user presses Shift+Tab, **Then** the system switches to "acceptEdits" mode.
2. **Given** the system is in "acceptEdits" mode, **When** the user presses Shift+Tab, **Then** the system switches to "plan" mode.
3. **Given** the system is in "plan" mode, **When** the user presses Shift+Tab, **Then** the system switches back to "default" mode.
4. **Given** the system switches to "plan" mode, **When** the mode is active, **Then** a plan file path with a random English name is determined in `~/.wave/plans/`.
5. **Given** the system is in "plan" mode, **When** the LLM uses the `Write` or `Edit` tool on the designated plan file, **Then** the action is permitted.
6. **Given** the system is in "plan" mode, **When** the user looks at the UI, **Then** there is a clear visual indicator that plan mode is active.

---

### User Story 2 - Planning and Restrictions in plan mode (Priority: P1)

As a user, I want the LLM to be restricted to only editing the plan file while in plan mode, so that my codebase remains untouched during the planning phase.

**Why this priority**: This ensures the safety and integrity of the codebase during the planning process.

**Independent Test**: Can be tested by attempting to edit a non-plan file or run a command while in plan mode and verifying it is blocked.

**Acceptance Scenarios**:

1. **Given** the system is in "plan" mode, **When** the LLM attempts to read a file, **Then** the action is permitted.
2. **Given** the system is in "plan" mode, **When** the LLM attempts to edit a file other than the designated plan file, **Then** the action is blocked.
3. **Given** the system is in "plan" mode, **When** the LLM attempts to execute a bash command, **Then** the action is blocked.
4. **Given** the system is in "plan" mode, **When** the LLM edits the plan file, **Then** the action is permitted.

---

### User Story 3 - System Prompt Guidance (Priority: P2)

As a user, I want the LLM to be explicitly told how to behave in plan mode, so that it effectively uses the plan file.

**Why this priority**: Ensures the LLM understands its constraints and the intended workflow.

**Independent Test**: Can be tested by inspecting the system prompt sent to the LLM when plan mode is active.

**Acceptance Scenarios**:

1. **Given** the system is in "plan" mode, **When** a message is sent to the LLM, **Then** the system prompt includes the reminder:
   ```text
   ## Plan File Info:
   [Plan file existence info and path]
   You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.
   ```

---

### Edge Cases

- **Directory Creation**: If `~/.wave/plans` does not exist, the system should create it automatically.
- **Name Collisions**: The random English name generator should minimize the chance of collisions, but if a file already exists, it should handle it (e.g., by generating a new name).
- **Session Persistence**: If the session is restarted, the system should ideally remember the current plan file if it was in Plan Mode, or start a new one if appropriate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a "plan" permission state.
- **FR-002**: Users MUST be able to cycle through permission modes in the following order: default -> acceptEdits -> plan -> default, using the Shift+Tab keyboard shortcut.
- **FR-003**: When in plan mode, the system MUST restrict the LLM to read-only actions for all files except the designated plan file.
- **FR-004**: When in plan mode, the system MUST prevent the LLM from executing any commands.
- **FR-005**: When plan mode is activated, the system MUST determine a plan file path in `~/.wave/plans/` with a random English name (e.g., `gentle-breeze.md`). The LLM MUST use the `Write` and `Edit` tools to manage the content of this file.
- **FR-006**: When plan mode is active, the system MUST append a specific reminder to the LLM's system prompt:
  ```text
  ## Plan File Info:
  ${A.planExists?`A plan file already exists at ${A.planFilePath}. You can read it and make incremental edits using the Edit tool if you need to.`:`No plan file exists yet. You should create your plan at ${A.planFilePath} using the Write tool if you need to.`}
  You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.
  ```
- **FR-007**: The system MUST ensure the `~/.wave/plans/` directory exists before creating a plan file.
- **FR-008**: The system MUST provide visual feedback to the user indicating the current permission mode.

### Key Entities

- **Permission Mode**: Represents the current restriction level of the system (e.g., default, plan).
- **Plan File**: A markdown file located in `~/.wave/plans/` used by the LLM to document its plan during plan mode.
