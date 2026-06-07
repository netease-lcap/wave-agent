# Data Model: /goal Command

## Entities

### GoalState
Represents an active goal in the current session.

- **condition**: `string` (The user's goal condition, max 4000 characters)
- **startedAt**: `number` (Timestamp when the goal was set, `Date.now()`)
- **turnCount**: `number` (Incremented each evaluation cycle; used for max-turns circuit breaker)
- **tokenBaseline**: `number` (Total tokens at goal start; for reference only)
- **lastReason**: `string | undefined` (Evaluator's last reason for why the goal is not yet met)
- **consecutiveEvalFailures**: `number` (Counter for circuit breaker; resets on successful evaluation)

### EvaluateGoalResult
Result of a goal evaluation call.

- **isMet**: `boolean` (Whether the goal condition has been achieved)
- **reason**: `string` (Short explanation, 1-2 sentences)

### Session Persistence
Only the `condition` string persists across sessions. All counters (turnCount, startedAt, consecutiveEvalFailures) reset on restore.

## Relationships

- **GoalManager** holds a single optional `GoalState | null`. Only one goal can be active at a time.
- **GoalManager** is registered in the DI container as `"GoalManager"`.
- **GoalManager** depends on `MessageManager` (for messages and token tracking) and `AIManager` (for gateway/model config).
- **aiService.evaluateGoal()** makes a direct non-streaming OpenAI call with no rate limiter.

## Storage

### In-memory
`GoalState` lives in `GoalManager.state`. Lost on process exit (unless restored from session).

### Session persistence
Goal condition is stored in `SessionData.metadata.goalCondition`. On session restore, `GoalManager.restoreFromSession({ condition })` rehydrates with reset counters.

## Circuit Breakers

| Breaker | Threshold | Action |
|---------|-----------|--------|
| Max turns | 50 | Force-clear with "max turns exceeded" |
| Max duration | 30 minutes | Force-clear with "time limit exceeded" |
| Consecutive eval failures | 3 | Force-clear with error message |

## Validation Rules

- **Condition length**: Must not exceed 4000 characters.
- **Plan mode**: Goal cannot be set when permission mode is `"plan"`.
- **Subagent isolation**: Subagents skip goal evaluation (`!this.subagentType` check).
