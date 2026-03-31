# Implementation Plan: Status Line Component Refactoring

**Branch**: `030-status-line` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/030-status-line/spec.md`

## Summary

Move the status line logic (displaying the current mode and shell command status) from `InputBox.tsx` into a dedicated `StatusLine.tsx` component for better modularity.

## Technical Context

**Language/Version**: TypeScript (React)
**Primary Dependencies**: Ink (for CLI UI)
**Testing**: Type-check
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (code)
**Performance Goals**: No performance impact.
**Constraints**: Must maintain the same UI and behavior.

## Constitution Check

1. **Package-First Architecture**: Logic moved to a dedicated component in `packages/code`. Pass.
2. **TypeScript Excellence**: Strict typing for props. Pass.
3. **Test Alignment**: Verified with type-check. Pass.
4. **Build Dependencies**: No new dependencies. Pass.
5. **Documentation Minimalism**: Follows the standard spec/plan structure. Pass.
6. **Quality Gates**: `type-check` passed. Pass.
7. **Source Code Structure**: `StatusLine.tsx` in `packages/code/src/components`. Pass.
8. **Data Model Minimalism**: Simple `StatusLineProps` interface. Pass.

## Project Structure

### Documentation (this feature)

```
specs/030-status-line/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
└── code/
    ├── src/
    │   └── components/
    │       ├── InputBox.tsx
    │       └── StatusLine.tsx
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
