# Tasks: Status Line Component Refactoring

## Phase 1: Implementation

- [x] Create `packages/code/src/components/StatusLine.tsx` with the extracted logic.
- [x] Update `StatusLine.tsx` to support `isBtwActive` prop and display BTW mode.
- [x] Update `InputBox.tsx` to pass `isBtwActive` to `StatusLine`.

## Phase 2: Verification

- [x] Run `pnpm -F wave-code run type-check` to verify types.
- [x] Manually verify the UI in the CLI.
