# Implementation Plan: Message Compression

**Branch**: `014-message-compression-spec` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-message-compression-spec/spec.md`

## Summary

Implement a two-tier compression system: history compression in `agent-sdk` to manage token limits, and input compression in `code` to keep the UI clean when pasting large amounts of text.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: Session history
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Efficient summarization and responsive UI during paste
**Constraints**: 200-character threshold for input compression; full history replacement for history compression
**Scale/Scope**: Core resource management for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: History compression in `agent-sdk`, input compression in `code`.
- [x] **TypeScript Excellence**: Strict typing for `compress` blocks and `longTextMap`.
- [x] **Test Alignment**: Unit tests for compression logic and placeholder handling.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for token threshold detection first.
- [x] **Type System Evolution**: Use existing message block patterns.
- [x] **Data Model Minimalism**: Simple summary string and placeholder map.

## Project Structure

### Documentation (this feature)

```
specs/014-message-compression-spec/
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
│   ├── managers/
│   │   └── aiManager.ts        # Trigger history compression
│   └── utils/
│       └── messageOperations.ts # Compression logic
└── tests/
    └── utils/
        └── messageOperations.test.ts

packages/code/
├── src/
│   └── managers/
│       └── InputManager.ts     # Handle input compression
└── tests/
    └── managers/
        └── InputManager.test.ts
```

## Complexity Tracking

*No violations*
