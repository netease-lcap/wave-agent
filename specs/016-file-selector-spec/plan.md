# Implementation Plan: File Selector

**Branch**: `016-file-selector-spec` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-file-selector-spec/spec.md`

## Summary

Implement an interactive File Selector triggered by `@` to allow users to quickly search and select files or directories. This involves updating `InputManager` to handle the trigger and state, and creating a `FileSelector` Ink component for the UI.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: Local Filesystem
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Debounced search (300ms) to ensure responsiveness
**Constraints**: Max 10 items displayed at once
**Scale/Scope**: Input enhancement for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: UI in `code`, filesystem utilities in `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for selector state and component props.
- [x] **Test Alignment**: Unit tests for `InputManager` and `FileSelector`.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for trigger detection first.
- [x] **Type System Evolution**: Use existing `InputManager` state patterns.
- [x] **Data Model Minimalism**: Simple `FileItem` interface.

## Project Structure

### Documentation (this feature)

```
specs/016-file-selector-spec/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/code/
├── src/
│   ├── managers/
│   │   └── InputManager.ts     # Handle @ trigger and state
│   └── components/
│       └── FileSelector.tsx    # UI component
└── tests/
    ├── managers/
    │   └── InputManager.test.ts
    └── components/
        └── FileSelector.test.tsx
```

## Complexity Tracking

*No violations*
