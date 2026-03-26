# Feature Specification: /loop Slash Command

**Feature Branch**: `072-loop-slash-command`  
**Created**: 2026-03-24  
**Input**: User description: "support @loop.md , refer to @cron-tools.md @skill-loop-slash-command.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Schedule a recurring task (Priority: P1)

As a user, I want to schedule a command or a prompt to run at a regular interval so that I can monitor a long-running process or get regular updates without manual intervention.

**Why this priority**: This is the core functionality of the `/loop` command.

**Independent Test**: Can be tested by running `/loop 5m /echo "hello"` or `/loop 5m check the build` and verifying that the task is scheduled and runs immediately.

**Acceptance Scenarios**:

1. **Given** the agent is idle, **When** I type `/loop 5m /echo "ping"`, **Then** the system should schedule a cron job, confirm the scheduling with a job ID, and immediately output "ping".
2. **Given** the agent is idle, **When** I type `/loop check the build every 2h`, **Then** the system should schedule a cron job, confirm the scheduling, and immediately execute "check the build".

---

### User Story 2 - Schedule with default interval (Priority: P2)

As a user, I want to quickly loop a command or prompt without specifying a time so that I can use a sensible default frequency.

**Why this priority**: Improves user experience by reducing typing for common cases.

**Independent Test**: Can be tested by running `/loop /check-build` or `/loop check the build` and verifying it defaults to a sensible interval (e.g., 10 minutes).

**Acceptance Scenarios**:

1. **Given** the agent is idle, **When** I type `/loop check the build`, **Then** the system should schedule the task for a default interval and confirm the cadence.

---

### Edge Cases

- **Empty Prompt**: If I type `/loop 5m` without a command, the system should show usage instructions and not schedule anything.
- **Thundering Herd Prevention**: If I ask for "hourly", the system should pick a random minute (e.g., 7) instead of 0 to avoid global sync issues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support `/loop [interval] <prompt>` where interval and prompt are parsed by the AI according to the skill definition.
- **FR-006**: System MUST use the `CronCreate` tool to schedule the task as a recurring job.
- **FR-007**: System MUST immediately execute the parsed prompt once after successful scheduling.
- **FR-008**: System MUST provide a confirmation message containing:
    - The human-readable cadence.
    - The cron expression.
    - The Job ID.
    - A reminder that recurring tasks auto-expire after 7 days.
    - Instructions on how to cancel the job using natural language (e.g., "stop loop [ID]").
- **FR-009**: System MUST show usage instructions if the resulting prompt is empty.

### Key Entities

- **Loop Job**: A scheduled recurring task.
    - **Job ID**: Unique identifier for cancellation.
    - **Cron Expression**: The schedule in cron format.
    - **Prompt**: The command or text to be executed.
    - **Cadence**: Human-readable description of the frequency.
    - **Expiration**: The date/time when the job will auto-delete (7 days from creation).
