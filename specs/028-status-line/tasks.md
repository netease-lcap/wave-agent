# Tasks: Status Line Component Refactoring

## Phase 1: Implementation

- [x] Create `packages/code/src/components/StatusLine.tsx` with the extracted logic.
- [x] Update `StatusLine.tsx` to support `isBtwActive` prop and display BTW mode.
- [x] Update `InputBox.tsx` to pass `isBtwActive` to `StatusLine`.

## Phase 2: Verification

- [x] Run `pnpm -F wave-code run type-check` to verify types.
- [x] Manually verify the UI in the CLI.

## Phase 3: Token Usage Percentage

- [x] Add `maxInputTokens: number` to `ChatContextType` and state in `useChat.tsx`.
- [x] Set `maxInputTokens` from `agent.getMaxInputTokens()` in `initializeAgent`.
- [x] Pass `maxInputTokens` to `LoadingIndicator` and `InputBox` in `ChatInterface.tsx`.
- [x] Add `latestTotalTokens` and `maxInputTokens` props to `InputBox`, pass to `StatusLine`.
- [x] Update `StatusLine` to display right-aligned "X% context" with color coding.
- [x] Update `LoadingIndicator` to show percentage alongside token count.
- [x] Verify build with `pnpm -F wave-code build`.
