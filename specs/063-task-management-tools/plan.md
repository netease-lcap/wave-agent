# Implementation Plan: Task Management Tools

**Branch**: `063-task-management-tools` | **Date**: 2026-02-11 | **Spec**: [/specs/063-task-management-tools/spec.md]
**Input**: Feature specification from `/specs/063-task-management-tools/spec.md`

## Summary

The primary requirement is to implement a new set of task management tools (`TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`) that persist tasks as JSON files in a task-list-specific directory (`~/.wave/tasks/{taskListId}/{taskId}.json`). The `taskListId` is determined by the `WAVE_TASK_LIST_ID` environment variable or the `rootSessionId` of the session chain. Additionally, the legacy `TodoWrite` tool will be decommissioned and removed from the agent's toolset. The technical approach involves creating a new task manager service in `agent-sdk` to handle file-based persistence and updating the tool registry to expose the new tools while removing the old one.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk`, `vitest`
**Storage**: File-based JSON storage in `~/.wave/tasks/{taskListId}/{taskId}.json`
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Node.js (CLI environment)
**Project Type**: Monorepo (pnpm)
**Performance Goals**: Sub-100ms for task operations (local file I/O)
**Constraints**: Must handle directory creation, task list isolation (via `taskListId`), and concurrent file access (if applicable).
**Scale/Scope**: Task-list-scoped task management for AI agent workflows.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Logic will be placed in `packages/agent-sdk`.
- [x] **TypeScript Excellence**: Strict typing will be used for all new tools and services.
- [x] **Test Alignment**: Unit tests in `packages/agent-sdk/tests` and integration tests for tool execution.
- [x] **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **Documentation Minimalism**: Only necessary spec/plan/research files created.
- [x] **Quality Gates**: `type-check`, `lint`, and `test:coverage` will be run.
- [x] **Source Code Structure**: Task manager in `services/` or `managers/` of `agent-sdk`.
- [x] **Test-Driven Development**: Critical persistence logic will follow TDD.
- [x] **Type System Evolution**: Evolve existing tool/task types if possible.
- [x] **Data Model Minimalism**: Task entity follows `tmp.js` structure, no extra fields.
- [x] **Planning and Task Delegation**: General-purpose agent used for planning.
- [x] **User-Centric Quickstart**: `quickstart.md` will focus on CLI tool usage.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/063-task-management-tools/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (to be created)
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── task-manager.ts    # New task persistence logic
│   ├── tools/
│   │   ├── task-create.ts     # New tool
│   │   ├── task-get.ts        # New tool
│   │   ├── task-update.ts     # New tool
│   │   ├── task-list.ts       # New tool
│   │   └── todo-write.ts      # TO BE REMOVED
│   └── types.ts               # Updated Task types
└── tests/
    ├── managers/
    │   └── task-manager.test.ts
    └── tools/
        └── task-tools.test.ts
```

**Structure Decision**: Logic will be centralized in `packages/agent-sdk` as it handles the core agent capabilities and tool definitions.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 3: Task List ID Implementation

### Step 1: Update TaskManager initialization
- Modify `Agent` class in `packages/agent-sdk/src/agent.ts` to resolve the `taskListId` during construction:
  1. Check `process.env.WAVE_TASK_LIST_ID`.
  2. If not set, use `this.messageManager.getRootSessionId()` as the default.
- Initialize `TaskManager` using this resolved `taskListId`.
- Ensure that the `TaskManager` instance is created only once with this ID, so it remains stable even if `messageManager.getSessionId()` changes later (e.g., during compression).

### Step 2: Update Tools to pass `taskListId`
- Ensure `TaskCreate`, `TaskGet`, `TaskUpdate`, and `TaskList` tools correctly interact with the updated `TaskManager`.
