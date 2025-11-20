# Feature Specification: Tool Block Stage Updates

**Feature Branch**: `013-tool-block-states`  
**Created**: 2025-11-20  
**Status**: Draft  
**Input**: User description: "onToolBlockUpdated params should add a state or stage field, which can be start streaming running end. remove old isRunning. so that sdk user can print tool name at start, print chunk during streaming, print running during running, print result at end."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Announce tool start (Priority: P1)

An SDK integrator wants to announce when a tool call begins so observers can see which tool is executing.

**Why this priority**: Without a deterministic start signal, downstream logging and UI cannot orient users to the upcoming tool activity.

**Independent Test**: Subscribe to `onToolBlockUpdated`, trigger a tool execution, and verify that a single "start" stage event arrives with expected metadata before any other stage.

**Acceptance Scenarios**:

1. **Given** an SDK integration subscribed to `onToolBlockUpdated`, **When** a tool execution begins, **Then** the first event received includes `stage="start"` and the tool's display name so the integrator can surface it.
2. **Given** the same listener, **When** the start event is emitted, **Then** the payload does not contain the deprecated `isRunning` flag, preventing conflicting signals.

---

### User Story 2 - Stream tool output chunks (Priority: P2)

An SDK integrator wants to show incremental tool output while it is produced so end users see progress in real time.

**Why this priority**: Timely delivery of output chunks improves transparency and responsiveness for long-running tool operations.

**Independent Test**: Trigger a tool that streams output and confirm that consecutive events with `stage="streaming"` contain the emitted chunks and can be rendered without waiting for completion.

**Acceptance Scenarios**:

1. **Given** a tool that emits streaming output, **When** `onToolBlockUpdated` fires with `stage="streaming"`, **Then** each event includes the latest output chunk so the integrator can append it to the display.

---

### User Story 3 - Monitor running state and completion (Priority: P3)

An SDK integrator wants to indicate that a tool is still running and then summarize the outcome when it finishes.

**Why this priority**: Clear differentiation between "still running" and "finished" states lets integrators show accurate status messages and final results.

**Independent Test**: Trigger a long-running tool and verify that a `stage="running"` event signals ongoing work, followed by a single `stage="end"` event containing final data.

**Acceptance Scenarios**:

1. **Given** a long-running tool, **When** progress updates occur without new chunks, **Then** `onToolBlockUpdated` emits `stage="running"` so status indicators stay accurate.
2. **Given** the same tool reaches completion, **When** `onToolBlockUpdated` emits the final update, **Then** the event uses `stage="end"` and carries the final output or error summary for display.

---

### Edge Cases

- What happens when a stage value is missing or not one of `start`, `streaming`, `running`, `end`?
- How does the system handle tools that produce both streaming chunks and a final summary in rapid succession?
- What if a tool fails before emitting `stage="end"`—how is failure communicated?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `onToolBlockUpdated` MUST include a `stage` field on every payload, with allowed values `start`, `streaming`, `running`, or `end`.
- **FR-002**: On the `start` stage, the payload MUST include the tool's identifier and human-readable name so integrators can announce which tool is beginning.
- **FR-003**: During the `streaming` stage, each event MUST include the latest output chunk and maintain ordering so integrators can render incremental output.
- **FR-004**: The `running` stage MUST be available for long operations even when no new chunks exist, enabling integrators to show "still running" indicators.
- **FR-005**: The `end` stage MUST occur exactly once per tool execution and include the final result data or error summary needed for final display.
- **FR-006**: The deprecated `isRunning` field MUST be removed from all `onToolBlockUpdated` payloads to eliminate conflicting state signals.
- **FR-007**: Existing non-stage payload fields (e.g., timestamps, tool metadata) MUST remain unaffected so current integrations continue to receive expected context.

### Assumptions

- All existing SDK consumers can update to use the new `stage` field without simultaneous support for `isRunning`.
- Tools that neither stream output nor require running updates will emit `start` followed directly by `end`.
- Error conditions will be expressed within the `end` stage payload when a tool fails.
