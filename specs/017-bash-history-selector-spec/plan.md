# Implementation Plan: Bash History Selector

**Branch**: `017-bash-history-selector-spec` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-bash-history-selector-spec/spec.md`

## Summary

Implement an interactive Bash History Selector triggered by `!` at the start of the input. This allows users to search, re-execute, or edit previous commands. It involves updating `InputManager` and creating a `BashHistorySelector` Ink component.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: `.bash_history` or equivalent
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Fast search across history entries
**Constraints**: Max 10 items displayed at once
**Scale/Scope**: Input enhancement for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: UI in `code`, history utilities in `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for history entries and component props.
- [x] **Test Alignment**: Unit tests for history search and UI navigation.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for `!` trigger detection first.
- [x] **Type System Evolution**: Use existing `InputManager` state patterns.
- [x] **Data Model Minimalism**: Simple `HistoryEntry` interface.

## Project Structure

### Documentation (this feature)

```
specs/017-bash-history-selector-spec/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   └── utils/
│       └── history.ts          # History search utilities
└── tests/
    └── utils/
        └── history.test.ts

packages/code/
├── src/
│   ├── managers/
│   │   └── InputManager.ts     # Handle ! trigger and state
│   └── components/
│       └── BashHistorySelector.tsx # UI component
└── tests/
    └── components/
        └── BashHistorySelector.test.tsx
```

## Complexity Tracking

*No violations*
