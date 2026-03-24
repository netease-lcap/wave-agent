# Feature Specification: /loop Slash Command

**Feature Branch**: `072-loop-slash-command`  
**Created**: 2026-03-24  
**Input**: User description: "support @loop.md , refer to @cron-tools.md @skill-loop-slash-command.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Schedule a recurring task with explicit interval (Priority: P1)

As a user, I want to schedule a command or a prompt to run every 5 minutes so that I can monitor a long-running process or get regular updates without manual intervention.

**Why this priority**: This is the core functionality of the `/loop` command.

**Independent Test**: Can be tested by running `/loop 5m /echo "hello"` or `/loop 5m check the build` and verifying that the task is scheduled and runs immediately.

**Acceptance Scenarios**:

1. **Given** the agent is idle, **When** I type `/loop 5m /echo "ping"`, **Then** the system should schedule a cron job for `*/5 * * * *`, confirm the scheduling with a job ID, and immediately output "ping".
2. **Given** the agent is idle, **When** I type `/loop check the build every 2h`, **Then** the system should schedule a cron job for `0 */2 * * *`, confirm the scheduling, and immediately execute "check the build".

---

### User Story 2 - Schedule with default interval (Priority: P2)

As a user, I want to quickly loop a command or prompt without specifying a time so that I can use a sensible default frequency.

**Why this priority**: Improves user experience by reducing typing for common cases.

**Independent Test**: Can be tested by running `/loop /check-build` or `/loop check the build` and verifying it defaults to 10 minutes.

**Acceptance Scenarios**:

1. **Given** the agent is idle, **When** I type `/loop check the build`, **Then** the system should schedule the task for every 10 minutes (default) and confirm the cadence.

---

### User Story 3 - Handling non-clean intervals (Priority: P3)

As a user, I want the system to handle intervals that don't fit perfectly into cron so that my tasks still run at a regular, supported cadence.

**Why this priority**: Ensures system stability and prevents invalid cron expressions.

**Independent Test**: Can be tested by running `/loop 7m /echo "test"` and verifying it rounds to a supported interval.

**Acceptance Scenarios**:

1. **Given** I request an interval of `7m`, **When** I run the command, **Then** the system should round to `5m` or `10m`, notify me of the rounding, and schedule the task.

---

### Edge Cases

- **Empty Prompt**: If I type `/loop 5m` without a command, the system should show usage instructions and not schedule anything.
- **Invalid Interval**: If I type `/loop every PR /check`, the system should treat "every PR" as part of the prompt and use the default interval.
- **Thundering Herd Prevention**: If I ask for "hourly", the system should pick a random minute (e.g., 7) instead of 0 to avoid global sync issues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST parse `/loop [interval] <prompt>` where interval can be a leading token (e.g., `5m`), a trailing "every" clause (e.g., `every 2h`), or absent.
- **FR-002**: System MUST support interval units `s` (seconds), `m` (minutes), `h` (hours), and `d` (days).
- **FR-003**: System MUST convert intervals to standard 5-field cron expressions (Minute, Hour, Day of Month, Month, Day of Week).
- **FR-004**: System MUST round intervals to the nearest "clean" interval that divides its unit evenly (e.g., 60 for minutes, 24 for hours) if the requested interval does not.
- **FR-005**: System MUST notify the user when an interval is rounded.
- **FR-006**: System MUST use the `CronCreate` tool to schedule the task as a recurring job.
- **FR-007**: System MUST immediately execute the parsed prompt once after successful scheduling.
- **FR-008**: System MUST provide a confirmation message containing:
    - The human-readable cadence.
    - The cron expression.
    - The Job ID.
    - A reminder that recurring tasks auto-expire after 7 days.
    - Instructions on how to cancel the job using natural language (e.g., "stop loop [ID]").
- **FR-009**: System MUST show usage instructions if the resulting prompt is empty.
- **FR-010**: System MUST avoid scheduling on `:00` or `:30` minute marks for approximate requests (like "hourly" or "every morning") unless the user explicitly specifies a sharp time.

### Key Entities

- **Loop Job**: A scheduled recurring task.
    - **Job ID**: Unique identifier for cancellation.
    - **Cron Expression**: The schedule in cron format.
    - **Prompt**: The command or text to be executed.
    - **Cadence**: Human-readable description of the frequency.
    - **Expiration**: The date/time when the job will auto-delete (7 days from creation).
