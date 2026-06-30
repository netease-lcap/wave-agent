# Research: /goal Command

## Decision: CLI-Internal Command with Agent Methods
- **Choice**: Implement `/goal` as a CLI-internal command registered in `AVAILABLE_COMMANDS`, with logic in `Agent.setGoal()`, `Agent.clearGoal()`, and `Agent.showGoalStatus()`.
- **Rationale**: Unlike `/loop` which uses a skill-based approach for flexible interval parsing, `/goal` has simple, fixed argument parsing (the entire argument is the condition string). No skill or AI parsing needed. The command is registered in the CLI layer (`AVAILABLE_COMMANDS`) rather than in `SlashCommandManager`, keeping the SDK logic as public `Agent` methods.
- **Alternatives considered**: Built-in skill (like `/loop`). Rejected because the command logic is trivial and doesn't benefit from Markdown-based prompt templates. Built-in slash command in `SlashCommandManager`. Rejected in favor of CLI-internal command pattern shared with `/clear` and `/compact`.

## Decision: GoalManager Class
- **Choice**: Create a `GoalManager` in `packages/agent-sdk/src/managers/goalManager.ts`.
- **Rationale**: Follows the existing "Manager" pattern (e.g., `CronManager`, `PlanManager`). It encapsulates goal state, circuit breaker logic, and evaluation orchestration.
- **Alternatives considered**: Putting goal logic directly in `AIManager`. Rejected to maintain separation of concerns and keep AIManager focused on AI communication.

## Decision: Fast Model Evaluation (No Rate Limiter)
- **Choice**: Add a lightweight `evaluateGoal()` function to `aiService.ts` that bypasses `acquireSlot()`.
- **Rationale**: The 1 QPS rate limiter is designed to throttle user-initiated AI calls. Goal evaluation is an internal loop that must evaluate after every turn without queuing delays. Claude Code does the same — the fast model evaluator bypasses rate limiting.
- **Alternatives considered**: Reusing `callAgent()` or `btw()`. Rejected because `callAgent()` has tool handling and streaming overhead, and `btw()` uses `acquireSlot()`.

## Decision: Conversation Messages via convertMessagesForAPI
- **Choice**: Pass conversation messages to the evaluator using `convertMessagesForAPI()` (same as compact), with images stripped to reduce token usage. Messages are sent as structured `ChatCompletionMessageParam[]` with a trailing user message containing the goal condition.
- **Rationale**: Consistent with how compact and other AI sub-calls handle messages. Structured messages preserve role/tool-call information that a flattened transcript loses. No need for custom serialization logic.
- **Alternatives considered**: Custom transcript condensation (sliding window + text serialization). Rejected because it duplicates logic that `convertMessagesForAPI` already handles, and loses structured context.

## Decision: Goal Supersedes Stop Hooks
- **Choice**: While a goal is active, goal evaluation replaces Stop hooks. On achievement or force-clear, Stop hooks run normally on the final turn.
- **Rationale**: If both Stop hooks and goal evaluation can restart the conversation, there's a risk of double-continuation. The goal evaluator is the authoritative continuation mechanism while active. Claude Code follows this pattern.
- **Alternatives considered**: Running Stop hooks before goal evaluation. Rejected because it creates confusing interactions where hooks might restart the conversation before the goal evaluator has a chance.

## Decision: In-Memory Only (No Session Persistence)
- **Choice**: Goal state lives in `GoalManager.state` only. No session persistence across process restarts.
- **Rationale**: Goal is an ephemeral autonomous loop that doesn't survive process restarts in practice (Claude Code also doesn't persist goal state). Removing session persistence eliminates fragile message-scanning logic and the `extractGoalCondition`/`restoreFromSession` code path.
- **Alternatives considered**: Session persistence via `SessionData.metadata.goalCondition`. Rejected because it added complexity (regex scanning of messages, counter reset on restore) for a feature that rarely benefits users.

## Decision: UI Indicator in StatusLine
- **Choice**: Add `◎ /goal active (<elapsed>)` in cyan to the existing `StatusLine` component.
- **Rationale**: Minimal UI change that provides clear visual feedback. The `◎` symbol is distinctive and not used elsewhere.
- **Alternatives considered**: Separate goal banner component. Rejected as over-engineering for a status indicator.
