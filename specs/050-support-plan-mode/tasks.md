# Tasks: Support Plan Mode

**Input**: Design documents from `/specs/050-support-plan-mode/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as they are essential for verifying the permission enforcement and mode switching logic.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Add `plan` to `PermissionMode` type in `packages/agent-sdk/src/types/permissions.ts`
- [X] T002 [P] Implement random name generator utility in `packages/agent-sdk/src/utils/nameGenerator.ts`
- [X] T003 [P] Create `PlanManager` to handle directory creation and path generation in `packages/agent-sdk/src/managers/planManager.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Update `PermissionManager` to support `planFilePath` and `plan` mode logic in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T005 Update `Agent` class to integrate `PlanManager` and handle mode transitions in `packages/agent-sdk/src/agent.ts` (Fixed: ensure plan file path is generated when default mode is plan in configuration)
- [X] T006 Update `AIManager` to append the Plan Mode reminder (including plan file existence check) to the system prompt in `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Switching to Plan Mode (Priority: P1) 🎯 MVP

**Goal**: Allow users to cycle through permission modes including Plan Mode using Shift+Tab.

**Independent Test**: Verify that pressing Shift+Tab cycles through default -> acceptEdits -> plan -> default and that a plan file path is determined when entering plan mode.

### Tests for User Story 1

- [X] T007 [P] [US1] Unit test for `PlanManager` path generation in `packages/agent-sdk/tests/managers/planManager.test.ts`
- [X] T008 [P] [US1] Unit test for `InputManager` mode cycling in `packages/code/tests/managers/InputManager.plan.test.ts`

### Implementation for User Story 1

- [X] T009 [US1] Update `InputManager.ts` to include `plan` mode in the `Shift+Tab` cycle in `packages/code/src/managers/InputManager.ts`
- [X] T010 [US1] Ensure visual indicator reflects the new `plan` mode in `packages/code/src/components/PermissionIndicator.tsx` (if applicable)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Planning and Restrictions in Plan Mode (Priority: P1)

**Goal**: Enforce read-only restrictions on the codebase and block command execution while allowing edits to the plan file.

**Independent Test**: In plan mode, verify `Read` is allowed, `Edit` on non-plan files is blocked, `Edit` on plan file is allowed, and `Bash` is blocked.

### Tests for User Story 2

- [X] T011 [P] [US2] Unit tests for `PermissionManager` enforcement in `packages/agent-sdk/tests/managers/permissionManager.plan.test.ts`

### Implementation for User Story 2

- [X] T012 [US2] Implement tool-specific authorization logic for `plan` mode in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T013 [US2] Integrate permission checks in `Agent.ts` or relevant tool handlers to ensure `Bash` is blocked in `plan` mode.
- [X] T021 [P] Ensure `defaultMode` in configuration and `PermissionMode` share the same type definition in `packages/agent-sdk/src/types/configuration.ts`
- [X] T022 [P] Update validation logic in `LiveConfigManager` and `ConfigurationService` to use `PermissionMode` values consistently

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: User Story 3 - System Prompt Guidance (Priority: P2)

**Goal**: Provide the LLM with instructions on how to behave when Plan Mode is active.

**Independent Test**: Inspect the system prompt in `AIManager` when mode is `plan` and verify the reminder is present.

### Tests for User Story 3

- [X] T014 [P] [US3] Unit test for `AIManager` system prompt construction in `packages/agent-sdk/tests/managers/aiManager.plan.test.ts`

### Implementation for User Story 3

- [X] T015 [US3] Finalize `AIManager.ts` logic to include the specific reminder string with dynamic plan file info in `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T016 [P] Documentation updates in `docs/` (if any)
- [X] T017 [P] Run `pnpm run type-check` and `pnpm run lint` across the monorepo
- [X] T018 [P] Run all tests using `pnpm test`
- [X] T019 [P] Validate the feature using `specs/050-support-plan-mode/quickstart.md` scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2).
- **User Story 2 (P2)**: Can start after Foundational (Phase 2).
- **User Story 3 (P3)**: Can start after Foundational (Phase 2).

### Parallel Opportunities

- T001, T002, T003 can run in parallel.
- T007, T008, T011, T014 can run in parallel once their respective implementations start.
- Once Phase 2 is complete, US1, US2, and US3 can be worked on in parallel.

---

## Parallel Example: Setup

```bash
# Launch setup tasks together:
Task: "Add 'plan' to PermissionMode type in packages/agent-sdk/src/types/permissions.ts"
Task: "Implement random name generator utility in packages/agent-sdk/src/utils/nameGenerator.ts"
Task: "Create PlanManager to handle directory creation and path generation in packages/agent-sdk/src/managers/planManager.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 & 2)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1 (Switching).
4. Complete Phase 4: User Story 2 (Restrictions).
5. **STOP and VALIDATE**: Test the core "Plan Mode" safety and switching.

### Incremental Delivery

1. Foundation ready.
2. Add Switching (US1) -> Test.
3. Add Restrictions (US2) -> Test.
4. Add Prompt Guidance (US3) -> Test.
5. Final Polish.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- Each user story is independently completable and testable.
- Commit after each task or logical group.
- Stop at any checkpoint to validate story independently.
