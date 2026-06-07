# Feature Specification: /goal Command

**Feature Branch**: `079-goal-command`  
**Created**: 2026-06-07  
**Input**: Claude Code `/goal` reference — https://code.claude.com/docs/en/goal

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set an autonomous goal (Priority: P1)

As a user, I want to set a completion condition for my session so that the agent works autonomously across turns until the condition is met, without requiring manual prompting each turn.

**Why this priority**: This is the core functionality — "set it and forget it" autonomous work.

**Independent Test**: Run `/goal all tests in test/auth pass` and verify the agent continues working turns autonomously until the goal is achieved or a circuit breaker fires.

**Acceptance Scenarios**:

1. **Given** the agent is idle, **When** I type `/goal all tests in test/auth pass`, **Then** the agent sets the goal, displays a confirmation, and begins working autonomously.
2. **Given** a goal is active, **When** the agent completes a turn, **Then** the fast model evaluates whether the goal condition is met using the conversation transcript.
3. **Given** the evaluator determines the goal is not met, **When** the agent finishes evaluating, **Then** the agent continues with another turn including a system reminder of the reason and the goal condition.
4. **Given** the evaluator determines the goal is met, **When** the agent finishes evaluating, **Then** the goal is cleared, an achievement message is added, and Stop hooks run normally.

---

### User Story 2 - Check goal status (Priority: P2)

As a user, I want to check the current goal status so that I can see the condition, elapsed time, turn count, and last evaluation reason.

**Why this priority**: Observability into the autonomous loop without interrupting it.

**Independent Test**: Run `/goal` with an active goal and verify the status message includes condition, elapsed time, turn count, and last reason.

**Acceptance Scenarios**:

1. **Given** a goal is active, **When** I type `/goal`, **Then** the system displays the goal condition, elapsed time, turn count, and last evaluation reason.
2. **Given** no goal is active, **When** I type `/goal`, **Then** the system displays "No active goal" with instructions to set one.

---

### User Story 3 - Clear a goal (Priority: P2)

As a user, I want to cancel an active goal so that the agent stops the autonomous loop and returns to normal interactive mode.

**Why this priority**: User control over the autonomous loop is essential.

**Independent Test**: Run `/goal clear` and verify the goal is deactivated and the agent returns to normal mode.

**Acceptance Scenarios**:

1. **Given** a goal is active, **When** I type `/goal clear` (or `stop`, `off`, `reset`, `none`, `cancel`), **Then** the goal is cleared and the agent returns to normal interactive mode.
2. **Given** no goal is active, **When** I type `/goal clear`, **Then** the system displays "No active goal to clear".

---

### Edge Cases

- **Goal in plan mode**: If I try to set a goal while in plan mode, the system should reject it with an error message explaining that goals cannot run in plan mode.
- **Circuit breaker — max turns**: If the goal loop reaches 50 turns, the system should force-clear the goal with a "maximum turns exceeded" message and fall through to Stop hooks.
- **Circuit breaker — max duration**: If the goal has been active for 30 minutes, the system should force-clear with "time limit exceeded" and fall through to Stop hooks.
- **Circuit breaker — evaluation failures**: If 3 consecutive fast-model evaluation calls fail, the system should force-clear the goal with an error message.
- **Goal superseding Stop hooks**: While a goal is active, Stop hooks are skipped (the goal evaluator replaces them). On goal achievement or force-clear, Stop hooks run normally on the final turn.
- **Subagent isolation**: Subagents skip goal evaluation entirely — only the top-level agent evaluates goals.
- **Notifications take priority**: Pending background task notifications are drained before goal evaluation each turn.
- **/clear clears goal**: Running `/clear` also clears any active goal.
- **Condition length limit**: Goal conditions exceeding 4000 characters are rejected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support `/goal <condition>` to set an autonomous goal. The agent begins working immediately.
- **FR-002**: System MUST support `/goal` (no arguments) to display current goal status including condition, elapsed time, turn count, and last evaluation reason.
- **FR-003**: System MUST support `/goal clear|stop|off|reset|none|cancel` to deactivate an active goal.
- **FR-004**: After each AI turn (at recursionDepth=0), if a goal is active and not in a subagent, the system MUST evaluate the goal using the fast model.
- **FR-005**: Goal evaluation MUST bypass the 1 QPS rate limiter (direct non-streaming call, no `acquireSlot`).
- **FR-006**: Goal evaluation MUST use a condensed transcript (sliding window of last 10 exchange pairs, capped at ~8K tokens), not raw messages.
- **FR-007**: System MUST track evaluation tokens separately with `operation_type: "goal_evaluation"`, not mixed with agent tokens.
- **FR-008**: System MUST implement circuit breakers: max 50 turns, max 30 minutes duration, max 3 consecutive evaluation failures.
- **FR-009**: When a goal is active, goal evaluation MUST supersede Stop hooks. On goal achievement or force-clear, Stop hooks run normally.
- **FR-010**: System MUST reject setting a goal in plan mode.
- **FR-011**: System MUST reject goal conditions exceeding 4000 characters.
- **FR-012**: `/clear` MUST also clear any active goal.
- **FR-013**: Goal condition MUST persist across session restore (only the condition string; counters reset).
- **FR-014**: UI status line MUST display `◎ /goal active (<elapsed>)` in cyan when a goal is active.
- **FR-015**: Goal evaluation MUST drain pending notifications before evaluating, so the evaluator sees fresh results.
- **FR-016**: Between goal turns, loading state MUST remain active to prevent UI flicker.

### Key Entities

- **GoalState**: The in-memory state of an active goal.
    - **condition**: `string` — The user's goal condition (max 4000 chars).
    - **startedAt**: `number` — Timestamp when the goal was set.
    - **turnCount**: `number` — Incremented each evaluation cycle.
    - **tokenBaseline**: `number` — Total tokens at goal start.
    - **lastReason**: `string | undefined` — Evaluator's last reason.
    - **consecutiveEvalFailures**: `number` — Counter for circuit breaker.
