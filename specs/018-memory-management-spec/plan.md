# Implementation Plan: Memory Management

**Branch**: `018-memory-management-spec` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-memory-management-spec/spec.md`

## Summary

Implement a Memory Management system that allows the agent to persist information across conversations. Triggered by `#`, it allows saving to "Project" (`AGENTS.md`) or "User" (global) storage. Memory is injected into the AI's system prompt.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: agent-sdk, code (Ink, React)
**Storage**: Markdown files (`AGENTS.md`, `~/.wave/memory.md`)
**Testing**: Vitest
**Target Platform**: CLI (Node.js)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Efficient merging of memory files
**Constraints**: Must handle missing files gracefully
**Scale/Scope**: Core agent capability for all sessions

## Constitution Check

- [x] **Package-First Architecture**: Memory service in `agent-sdk`, UI in `code`.
- [x] **TypeScript Excellence**: Strict typing for memory entries and service methods.
- [x] **Test Alignment**: Unit tests for saving, reading, and merging memory.
- [x] **Build Dependencies**: `pnpm build` required for `agent-sdk` changes.
- [x] **Quality Gates**: `type-check` and `lint` must pass.
- [x] **Test-Driven Development**: Write failing tests for memory saving first.
- [x] **Type System Evolution**: Extend `AIManager` to include memory context.
- [x] **Data Model Minimalism**: Simple Markdown-based storage.

## Project Structure

### Documentation (this feature)

```
specs/018-memory-management-spec/
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
│   ├── services/
│   │   └── memory.ts           # Memory I/O service
│   └── managers/
│       └── aiManager.ts        # Inject memory into prompt
└── tests/
    └── services/
        └── memory.test.ts

packages/code/
├── src/
│   ├── managers/
│   │   └── InputManager.ts     # Handle # trigger and state
│   └── components/
│       └── MemoryTypeSelector.tsx # UI component
└── tests/
    └── components/
        └── MemoryTypeSelector.test.tsx
```

## Complexity Tracking

*No violations*
