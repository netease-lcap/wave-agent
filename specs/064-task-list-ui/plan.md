# Implementation Plan: Task List UI

**Branch**: `064-task-list-ui` | **Date**: 2026-02-11 | **Spec**: [/specs/064-task-list-ui/spec.md](/specs/064-task-list-ui/spec.md)
**Input**: Feature specification from `/specs/064-task-list-ui/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

The primary requirement is to display a persistent task list summary at the bottom of the message list in the CLI interface. This UI component will visualize tasks managed by the tools defined in spec 063, showing their subjects and statuses. The task list is read-only and does not support keyboard navigation or selection. The technical approach involves creating a new React Ink component in the `code` package that subscribes to or reads from the task storage and renders it within the main chat view.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: React Ink, agent-sdk
**Storage**: File-based JSON storage in `~/.wave/tasks/{sessionId}/{taskId}.json` (as per spec 063)
**Testing**: Vitest, HookTester
**Target Platform**: CLI (Linux/macOS/Windows)
**Project Type**: Monorepo (packages/code, packages/agent-sdk)
**Performance Goals**: Near-instant UI updates when tasks change
**Constraints**: Must fit within terminal width, handle truncation of long subjects, non-interactive/read-only display
**Scale/Scope**: Displaying 1-10 active tasks typically

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: UI logic in `packages/code`, task data logic in `packages/agent-sdk`. (PASS)
2. **TypeScript Excellence**: Strict typing for task UI components. (PASS)
3. **Test Alignment**: Unit tests for the new component and integration tests for task list rendering. (PASS)
4. **Documentation Minimalism**: No unnecessary docs, only `quickstart.md` for users. (PASS)
5. **Quality Gates**: `pnpm test:coverage` must be maintained. (PASS)
6. **Planning and Task Delegation**: Using general-purpose agent for planning. (PASS)

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)

```
specs/064-task-list-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/code/
├── src/
│   ├── components/
│   │   └── TaskList.tsx    # New component
│   ├── hooks/
│   │   └── useTasks.ts     # Hook to fetch/subscribe to tasks
│   └── components/
│       └── ChatInterface.tsx # Integration point
packages/agent-sdk/
├── src/
│   ├── managers/
│   │   └── TaskManager.ts  # Existing/Updated from spec 063
```

**Structure Decision**: Following the established pattern in `packages/code` for UI components and hooks.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
