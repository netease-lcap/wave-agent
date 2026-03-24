# Implementation Plan: Message Compression

**Branch**: `014-message-compression` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-message-compression/spec.md`

## Summary

Implement a history compression system in `agent-sdk` to manage token limits by automatically summarizing older messages.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: Session history
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Efficient summarization
**Constraints**: Full history replacement for history compression
**Scale/Scope**: Core resource management for all agent sessions

## Constitution Check

- [x] **Package-First Architecture**: History compression in `agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing for `compress` blocks.
- [x] **Test Alignment**: Unit tests for compression logic.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for token threshold detection first.
- [x] **Type System Evolution**: Use existing message block patterns.
- [x] **Data Model Minimalism**: Simple summary string.

## Project Structure

### Documentation (this feature)

```
specs/014-message-compression/
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
```

## Complexity Tracking

*No violations*
