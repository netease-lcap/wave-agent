# Research: Status Line Component Refactoring

## Objective
To extract the status line logic from `InputBox.tsx` into a dedicated `StatusLine.tsx` component for better modularity and maintainability, and to add token usage percentage display.

## Current Implementation
The status line logic is currently inline in `InputBox.tsx` (lines 271-285). It uses `permissionMode` and `isShellCommand` to determine what to display. Token usage is shown only as a raw count in `LoadingIndicator` during AI thinking — there is no persistent context budget visibility.

## Proposed Changes
1. Create `packages/code/src/components/StatusLine.tsx`.
2. Define `StatusLineProps` with `permissionMode: string` and `isShellCommand: boolean`.
3. Move the rendering logic from `InputBox.tsx` to `StatusLine.tsx`.
4. Update `InputBox.tsx` to use the new component.
5. Add `latestTotalTokens` and `maxInputTokens` props to `StatusLine` for percentage display.
6. Add `maxInputTokens` to `ChatContextType` via `Agent.getMaxInputTokens()`.
7. Show right-aligned "X% context" in `StatusLine` with color coding (gray/yellow/red).
8. Show percentage alongside token count in `LoadingIndicator`.

## Existing Code to Reuse
- `calculateComprehensiveTotalTokens()` — `packages/agent-sdk/src/utils/tokenCalculation.ts`
- `extractLatestTotalTokens()` — `packages/agent-sdk/src/utils/tokenCalculation.ts`
- `Agent.getMaxInputTokens()` — `packages/agent-sdk/src/agent.ts`
- `DEFAULT_WAVE_MAX_INPUT_TOKENS = 200000` — `packages/agent-sdk/src/utils/constants.ts`

## Risks and Mitigations
- **Risk**: UI regression.
- **Mitigation**: Ensure the rendering logic is identical to the original implementation.
- **Risk**: Type errors.
- **Mitigation**: Run `pnpm -F wave-code run type-check` to verify types.
- **Risk**: Percentage flickers or shows misleading values during streaming.
- **Mitigation**: Only show percentage when `latestTotalTokens > 0`; use same token calculation as compaction trigger.
