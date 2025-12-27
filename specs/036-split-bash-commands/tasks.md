# Tasks: Split Chained Bash Commands for Permissions

**Input**: Design documents from `/specs/036-split-bash-commands/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: New tests will be added to `packages/agent-sdk/tests/managers/permissionManager.test.ts` to verify the splitting and filtering logic.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Verify existing `splitBashCommand` and `SAFE_COMMANDS` in `packages/agent-sdk/src/managers/permissionManager.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Implement `expandBashRule` method in `packages/agent-sdk/src/managers/permissionManager.ts` to split commands and filter safe ones
- [X] T003 Add unit tests for `expandBashRule` in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Allow Chained Commands with Safe Builtins (Priority: P1) 🎯 MVP

**Goal**: Ensure chained commands with safe builtins only save non-safe parts to permissions.

**Independent Test**: Run `mkdir test && cd test`, select "Don't ask again", and verify only `Bash(mkdir test)` is added to `permissions.allow`.

### Implementation for User Story 1

- [X] T004 [US1] Update `addPermissionRule` in `packages/agent-sdk/src/agent.ts` to use `permissionManager.expandBashRule`
- [X] T005 [US1] Add integration test in `packages/agent-sdk/tests/agent/agent.autoAccept.test.ts` for chained command with safe builtin

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Allow Complex Chained Commands (Priority: P2)

**Goal**: Ensure complex chains (pipes, etc.) are split and saved individually.

**Independent Test**: Run `npm install | grep error`, select "Don't ask again", and verify both `Bash(npm install)` and `Bash(grep error)` are added.

### Implementation for User Story 2

- [X] T006 [US2] Add test cases to `packages/agent-sdk/tests/managers/permissionManager.test.ts` for complex chains (pipes, subshells)
- [X] T007 [US2] Verify `expandBashRule` correctly handles complex chains via tests

**Checkpoint**: User Story 2 is fully functional and testable independently.

---

## Phase 5: User Story 3 - Handle Multiple Safe Commands in a Chain (Priority: P3)

**Goal**: Ensure chains of only safe commands don't add anything to permissions.

**Independent Test**: Run `cd /tmp && ls`, select "Don't ask again", and verify no new rules are added.

### Implementation for User Story 3

- [X] T008 [US3] Add test case to `packages/agent-sdk/tests/managers/permissionManager.test.ts` for chain of only safe commands
- [X] T009 [US3] Verify `expandBashRule` returns empty array for safe-only chains

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T010 [P] Run `pnpm run type-check` and `pnpm lint` in `packages/agent-sdk`
- [X] T011 [P] Run all tests in `packages/agent-sdk` to ensure no regressions
- [X] T012 [P] Validate with `quickstart.md` scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories.
- **User Stories (Phase 3+)**: Depend on Foundational phase.
- **Polish (Final Phase)**: Depends on all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: MVP. No dependencies on other stories.
- **User Story 2 (P2)**: No dependencies on other stories.
- **User Story 3 (P3)**: No dependencies on other stories.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently.

### Incremental Delivery

1. Complete Setup + Foundational.
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently.
4. Add User Story 3 → Test independently.
