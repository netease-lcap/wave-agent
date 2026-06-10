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
Evaluate the goal using the fast model. Converts messages via `convertMessagesForAPI()` and passes them as structured `ChatCompletionMessageParam[]`. Fires `onGoalEvaluating(true)` before and `onGoalEvaluating(false)` after. Increments `consecutiveEvalFailures` on failure; resets on success. Tracks evaluation tokens with `operation_type: "goal_evaluation"`.

### getStatusString(): string
Return a formatted status string for the `/goal` command (condition, elapsed, turn count, last reason).

### setOnGoalStateChange(callback): void
Register a callback for goal state changes. Used to update the UI status line.

### setOnGoalEvaluating(callback): void
Register a callback for goal evaluation state. Used to show/hide the evaluating indicator in the UI.
