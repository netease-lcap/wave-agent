# Tasks: Implement "clear" command in SDK

## Phase 1: SDK Changes (agent-sdk)
- [x] Register the `clear` command in `SlashCommandManager.initializeBuiltinCommands()`.
- [x] Implement the `clear` command handler to abort AI messages, clear history, and sync tasks.

## Phase 2: CLI Changes (code)
- [x] Ensure the CLI reacts to session ID changes to clear the terminal.
- [x] Use the SDK's built-in `clear` command via the standard slash command path.

## Phase 3: SDK Refinement (agent-sdk)
- [x] Update `clearMessages()` in `agent.ts` to be `async` and call the `clear` command.

## Verification
- [x] Run `pnpm -F wave-agent-sdk test tests/managers/slashCommandManager.clear.test.ts`.
- [x] Run `pnpm -F wave-code test tests/managers/inputHandlers.test.ts`.
- [x] Manual verification of `/clear` command in CLI.
