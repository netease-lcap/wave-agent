# Research: Status Line Component Refactoring

## Objective
To extract the status line logic from `InputBox.tsx` into a dedicated `StatusLine.tsx` component for better modularity and maintainability.

## Current Implementation
The status line logic is currently inline in `InputBox.tsx` (lines 271-285). It uses `permissionMode` and `isShellCommand` to determine what to display.

## Proposed Changes
1. Create `packages/code/src/components/StatusLine.tsx`.
2. Define `StatusLineProps` with `permissionMode: string` and `isShellCommand: boolean`.
3. Move the rendering logic from `InputBox.tsx` to `StatusLine.tsx`.
4. Update `InputBox.tsx` to use the new component.

## Risks and Mitigations
- **Risk**: UI regression.
- **Mitigation**: Ensure the rendering logic is identical to the original implementation.
- **Risk**: Type errors.
- **Mitigation**: Run `pnpm -F wave-code run type-check` to verify types.
