# Research: /goal Command

## Decision: Built-in Slash Command
- **Choice**: Implement `/goal` as a built-in slash command in `SlashCommandManager`.
- **Rationale**: Unlike `/loop` which uses a skill-based approach for flexible interval parsing, `/goal` has simple, fixed argument parsing (the entire argument is the condition string). No skill or AI parsing needed.
- **Alternatives considered**: Built-in skill (like `/loop`). Rejected because the command logic is trivial and doesn't benefit from Markdown-based prompt templates.

## Decision: GoalManager Class
- **Choice**: Create a `GoalManager` in `packages/agent-sdk/src/managers/goalManager.ts`.
- **Rationale**: Follows the existing "Manager" pattern (e.g., `CronManager`, `PlanManager`). It encapsulates goal state, circuit breaker logic, and evaluation orchestration.
- **Alternatives considered**: Putting goal logic directly in `AIManager`. Rejected to maintain separation of concerns and keep AIManager focused on AI communication.

## Decision: Fast Model Evaluation (No Rate Limiter)
- **Choice**: Add a lightweight `evaluateGoal()` function to `aiService.ts` that bypasses `acquireSlot()`.
- **Rationale**: The 1 QPS rate limiter is designed to throttle user-initiated AI calls. Goal evaluation is an internal loop that must evaluate after every turn without queuing delays. Claude Code does the same — the fast model evaluator bypasses rate limiting.
- **Alternatives considered**: Reusing `callAgent()` or `btw()`. Rejected because `callAgent()` has tool handling and streaming overhead, and `btw()` uses `acquireSlot()`.

## Decision: Transcript Condensation
- **Choice**: Use a sliding window of the last 10 user+assistant exchange pairs, serialized to condensed text, capped at ~8K tokens.
- **Rationale**: Sending raw `ChatCompletionMessageParam[]` is too expensive (includes tool JSON). A condensed text format keeps evaluation fast and cheap while preserving enough context for accurate judgment.
- **Alternatives considered**: Sending all messages. Rejected due to cost; sending only the last message. Rejected because the evaluator needs context about what was done.

## Decision: Goal Supersedes Stop Hooks
- **Choice**: While a goal is active, goal evaluation replaces Stop hooks. On achievement or force-clear, Stop hooks run normally on the final turn.
- **Rationale**: If both Stop hooks and goal evaluation can restart the conversation, there's a risk of double-continuation. The goal evaluator is the authoritative continuation mechanism while active. Claude Code follows this pattern.
- **Alternatives considered**: Running Stop hooks before goal evaluation. Rejected because it creates confusing interactions where hooks might restart the conversation before the goal evaluator has a chance.

## Decision: Session Persistence via Message Scan
- **Choice**: Detect active goal condition from session messages on restore by scanning for "Goal set:" and "Goal achieved/cleared/cancelled" markers.
- **Rationale**: Messages are already persisted. Scanning them on restore avoids adding a separate persistence mechanism. The `SessionData.metadata.goalCondition` field is populated by `extractGoalCondition()` in `session.ts`.
- **Alternatives considered**: Separate JSON file for goal state. Rejected as unnecessary complexity for a single string.

## Decision: UI Indicator in StatusLine
- **Choice**: Add `◎ /goal active (<elapsed>)` in cyan to the existing `StatusLine` component.
- **Rationale**: Minimal UI change that provides clear visual feedback. The `◎` symbol is distinctive and not used elsewhere.
- **Alternatives considered**: Separate goal banner component. Rejected as over-engineering for a status indicator.
