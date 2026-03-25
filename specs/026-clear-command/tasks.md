# Tasks: Move "clear" command to initializeBuiltinCommands()

## Phase 1: SDK Changes (agent-sdk)
- [x] Register the `clear` command in `SlashCommandManager.initializeBuiltinCommands()`.
- [x] Implement the `clear` command handler to abort AI messages, clear history, and sync tasks.

## Phase 2: CLI Changes (code)
- [x] Remove `clearMessages` from `ChatContext` and state in `useChat.tsx`.
- [x] Remove manual handling of the `clear` command in `handleCommandSelect` in `inputHandlers.ts`.
- [x] Remove `onClearMessages` from `InputManagerCallbacks` in `inputReducer.ts`.
- [x] Remove `onClearMessages` from `useInputManager` hook in `useInputManager.ts`.
- [x] Remove `onClearMessages` from `InputBox` component in `InputBox.tsx`.
- [x] Update `useChat.tsx` to no longer pass `clearMessages` to `useInputManager`.

## Phase 3: SDK Refinement (agent-sdk)
- [x] Update `clearMessages()` in `agent.ts` to be `async` and call the `clear` command.

## Verification
- [x] Run `pnpm -F wave-agent-sdk test tests/managers/slashCommandManager.clear.test.ts`.
- [x] Run `pnpm -F wave-code test tests/managers/inputHandlers.test.ts`.
- [x] Manual verification of `/clear` command in CLI.
