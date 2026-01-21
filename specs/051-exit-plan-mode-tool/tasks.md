# Tasks: ExitPlanMode Tool

**Feature**: ExitPlanMode Tool for plan approval
**Branch**: `051-exit-plan-mode-tool`
**Implementation Strategy**: MVP first, focusing on the core tool logic and UI confirmation flow.

## Phase 1: Setup

- [X] T001 Initialize feature branch and verify environment

## Phase 2: Foundational

- [X] T002 Define `ExitPlanMode` tool in `packages/agent-sdk/src/tools/exitPlanMode.ts`
- [X] T003 Add `ExitPlanMode` to `RESTRICTED_TOOLS` in `packages/agent-sdk/src/types/permissions.ts`
- [X] T004 Update `ToolManager` to filter `ExitPlanMode` based on `permissionMode` in `packages/agent-sdk/src/managers/toolManager.ts`
- [X] T005 Register `ExitPlanMode` tool in `Agent` class in `packages/agent-sdk/src/agent.ts`

## Phase 3: User Story 1 - Approve Plan via ExitPlanMode (Priority: P1)

**Goal**: Implement the `ExitPlanMode` tool and its 3-option confirmation UI.
**Independent Test**: Put agent in plan mode, write to plan file, call `ExitPlanMode`, verify 3-option UI with plan content, and verify state transitions for each option.

- [X] T006 [US1] Implement `ExitPlanMode` tool logic to read plan file and call `checkPermission` in `packages/agent-sdk/src/tools/exitPlanMode.ts`
- [X] T007 [US1] Update `Confirmation` component to support 3-option UI for `ExitPlanMode` in `packages/code/src/components/Confirmation.tsx`
- [X] T008 [US1] Update `ToolResultDisplay` component to display `planContent` for `ExitPlanMode` in `packages/code/src/components/ToolResultDisplay.tsx`
- [X] T009 [US1] Add unit tests for `ExitPlanMode` tool in `packages/agent-sdk/tests/tools/exitPlanMode.test.ts`
- [X] T010 [US1] Add integration tests for the full `ExitPlanMode` flow in `packages/agent-sdk/tests/agent/exitPlanMode.integration.test.ts`

## Phase 4: Polish & Cross-cutting concerns

- [X] T011 Run `pnpm build` and verify cross-package compatibility
- [X] T012 Run `pnpm run type-check` and `pnpm lint` across the monorepo

## Dependencies

- Phase 2 must be completed before Phase 3.
- T006 is a prerequisite for T009 and T010.
- T007 and T008 are prerequisites for T010.

## Parallel Execution Examples

- T002, T003, T004 can be done in parallel.
- T007 and T008 can be done in parallel.
- T009 and T010 can be done in parallel once T006 is finished.
