# Tasks: Implement "clear" command

## Phase 1: SDK Changes (agent-sdk)
- [x] Implement `clearMessages()` as an async public method in `packages/agent-sdk/src/agent.ts` containing the full clear logic directly: abort AI, clear goal, SessionEnd hooks, clear messages, clear memory cache, sync tasks, SessionStart hooks, save session.

## Phase 2: CLI Changes (code)
- [x] Register `clear` as a CLI-internal command in `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`.
- [x] Wire the callback in `useChat.tsx` to call `agent.clearMessages()`.
- [x] Ensure the CLI reacts to session ID changes to clear the terminal.
- [x] Remove the clear command from `SlashCommandManager.initializeBuiltinCommands()` (method removed entirely).

## Verification
- [x] Run `pnpm -F wave-agent-sdk test` to verify the SDK logic.
- [x] Run `pnpm -F wave-code test` to ensure no regressions in command handling.
- [x] Manual verification of `/clear` command in CLI.
