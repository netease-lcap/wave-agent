# Contract: GoalManager

## Description
Manages the lifecycle of an autonomous goal — setting, evaluating, clearing, and circuit breaking.

## Methods

### setGoal(condition: string): void
Set or replace the active goal. Resets all counters. Fires `onGoalStateChange(true, condition, "0m")`.

- **Precondition**: `condition.length <= 4000`
- **Postcondition**: `isGoalActive() === true`

### clearGoal(): void
Clear the active goal. Fires `onGoalStateChange(false)`. No-op if no goal is active.

### getGoal(): GoalState | null
Return the current goal state, or null if inactive.

### isGoalActive(): boolean
Return whether a goal is currently active.

### incrementTurnCount(): void
Increment the turn counter. Used by the evaluation loop in AIManager.

### checkCircuitBreakers(): string | null
Check circuit breaker thresholds. Returns a clear-reason string if a breaker has tripped, null otherwise.

### evaluateGoal(abortSignal?: AbortSignal): Promise<{ isMet: boolean; reason: string }>
Evaluate the goal using the fast model. Increments `consecutiveEvalFailures` on failure; resets on success. Tracks evaluation tokens with `operation_type: "goal_evaluation"`.

### condenseTranscript(messages: Message[]): string
Convert recent messages to condensed text for the evaluator. Uses a sliding window of 10 exchange pairs, always including the goal-setting message. Capped at ~32K chars (~8K tokens).

### getStatusString(): string
Return a formatted status string for the `/goal` command (condition, elapsed, turn count, last reason).

### serializeForSession(): { condition: string } | null
Return the condition string for session persistence, or null if inactive.

### restoreFromSession(data: { condition: string }): void
Restore a goal from session data with reset counters. Fires `onGoalStateChange(true, condition, "0m")`.

### setOnGoalStateChange(callback): void
Register a callback for goal state changes. Used to update the UI status line.
