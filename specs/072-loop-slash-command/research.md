# Research: /loop Slash Command & Cron Tools

## Decision: Built-in Skill Implementation
- **Choice**: Implement `/loop` as a built-in skill in `packages/agent-sdk/src/builtin-skills/loop/SKILL.md`.
- **Rationale**: The system already has a mechanism for registering skills as slash commands. This follows the pattern of `/settings`.
- **Alternatives considered**: Hardcoding the command in `SlashCommandManager`. Rejected because skills are more flexible and allow for Markdown-based prompts.

## Decision: Cron Manager
- **Choice**: Create a `CronManager` in `packages/agent-sdk/src/managers/cronManager.ts`.
- **Rationale**: Follows the existing "Manager" pattern (e.g., `MessageManager`, `AIManager`). It will handle the in-memory session store, scheduling logic, jitter, and idle-checks.
- **Alternatives considered**: Putting cron logic in `AIManager`. Rejected to maintain separation of concerns.

## Decision: Idle-Check Mechanism
- **Choice**: Use `AIManager.isLoading` to determine if the REPL is idle.
- **Rationale**: `isLoading` is set to `true` during message processing and tool execution. This perfectly matches the requirement that "Jobs only fire while the REPL is idle (not mid-query)."

## Decision: Jitter & Expiration
- **Choice**: 
    - **Recurring Jitter**: Random delay up to 10% of period (max 15 min).
    - **One-shot Jitter**: Random early fire up to 90s if scheduled on :00 or :30.
    - **Expiration**: 7-day limit for recurring jobs, checked in the `CronManager` loop.
- **Rationale**: Directly implements the requirements in `cron-tools.md`.

## Decision: Tool Implementation
- **Choice**: Implement `CronCreate`, `CronDelete`, and `CronList` as standard tools in `packages/agent-sdk/src/tools/`.
- **Rationale**: Allows the AI (and the `/loop` skill) to interact with the `CronManager`.

## Decision: Immediate Execution
- **Choice**: The `/loop` skill will use `aiManager.sendAIMessage()` to immediately execute the parsed prompt after scheduling.
- **Rationale**: Matches the requirement in `skill-loop-slash-command.md`.

## Decision: Cron Parsing Library
- **Choice**: Use `cron-parser` or a similar lightweight library.
- **Rationale**: 
    - **Cron to Execution Time**: The `CronManager` needs to convert that cron string into a concrete timestamp for the next execution. A library handles the complex calendar logic (e.g., "next Monday at 9 AM") and allows for accurate jitter calculation (10% of the period between runs).
    - **Standardization**: Ensures the system follows standard cron conventions that users expect.
- **Alternatives considered**: Manual time calculation. Rejected as it's error-prone and doesn't scale to complex cron schedules.

## Decision: Thundering Herd Prevention
- **Choice**: For approximate requests (e.g., "hourly"), the skill/AI will pick a random minute (not 0 or 30).
- **Rationale**: Requirement from `cron-tools.md`.
