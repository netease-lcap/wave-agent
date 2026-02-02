# Implementation Plan: Rewind Command

**Branch**: `056-rewind-command` | **Date**: 2026-02-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/056-rewind-command/spec.md`

## Summary

Implement a `/rewind` builtin command that allows users to revert the conversation to a specific user message checkpoint. This involves deleting the selected message and all subsequent messages, and sequentially reverting all file operations (create, modify, delete) performed by the agent during those turns. The technical approach involves a new `ReversionManager` in `agent-sdk` to track file snapshots and a UI component in `code` for message selection.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Ink (for CLI UI), fs/promises (for file I/O)
**Storage**: JSONL for session messages, `.reversion.jsonl` for file snapshots
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Fast message deletion and file reversion (< 500ms for typical turns)
**Constraints**: Must handle external file modifications by overwriting them with snapshots.
**Scale/Scope**: Core builtin command affecting message history and filesystem state.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Logic split between `agent-sdk` (managers/services) and `code` (UI). Pass.
2. **TypeScript Excellence**: Strict typing for snapshots and reversion logic. Pass.
3. **Test Alignment**: Mandatory unit and integration tests for `ReversionManager` and `/rewind` command. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code` can use new managers. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec/plan/research/data-model/quickstart. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: `ReversionManager` in `managers`, snapshot logic in `services`. Pass.
8. **Data Model Minimalism**: Simple `FileSnapshot` entity. Pass.

## Project Structure

### Documentation (this feature)

```
specs/056-rewind-command/
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
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── reversionManager.ts
│   │   │   └── slashCommandManager.ts
│   │   ├── services/
│   │   │   └── reversionService.ts
│   │   └── tools/
│   │       ├── writeTool.ts
│   │       ├── editTool.ts
│   │       ├── multiEditTool.ts
│   │       └── deleteFileTool.ts
│   └── tests/
│       └── managers/
│           └── reversionManager.test.ts
└── code/
    ├── src/
    │   └── components/
    │       └── RewindCommand.tsx
    └── tests/
        └── components/
            └── RewindCommand.test.ts
```

**Structure Decision**: Monorepo structure following existing patterns. Core logic in `agent-sdk` for reuse and UI in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
