# Requirements Checklist: Clear Command

## Functional Requirements
- [x] Implement `clearMessages()` as an async public method in `Agent` containing the full clear logic directly (abort AI, clear goal, SessionEnd hooks, clear messages, clear memory cache, sync tasks, SessionStart hooks, save session).
- [x] Register `clear` as a CLI-internal command in `AVAILABLE_COMMANDS`.
- [x] Wire the CLI callback to call `Agent.clearMessages()`.
- [x] Ensure the CLI reacts to `sessionId` changes to clear the terminal.
- [x] Remove the clear command from `SlashCommandManager.initializeBuiltinCommands()` (method removed entirely).

## Non-Functional Requirements
- [x] Maintain consistency across all consumers of the SDK.
- [x] Simplify the CLI and reduce its complexity.
- [x] Provide programmatic access to the `clear` command in the SDK via `Agent.clearMessages()`.

## Verification Requirements
- [x] Run automated tests for the SDK logic.
- [x] Run automated tests for the CLI command handling.
- [x] Manually verify the `/clear` command in the CLI.
