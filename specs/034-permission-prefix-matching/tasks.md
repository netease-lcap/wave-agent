# Tasks: Permission Prefix Matching

**Input**: Design documents from `/specs/034-permission-prefix-matching/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Create test file for PermissionManager in packages/agent-sdk/tests/managers/permissionManager.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Define test cases for prefix matching in packages/agent-sdk/tests/managers/permissionManager.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Prefix Matching for Commands (Priority: P1) 🎯 MVP

**Goal**: Allow a group of related commands by specifying a common prefix using `:*` suffix.

**Independent Test**: Add `Bash(git commit *)` to `permissions.allow` and verify `Bash(git commit -m "msg")` is allowed while `Bash(git push)` is denied.

### Implementation for User Story 1

- [x] T003 [US1] Implement prefix matching logic in `isAllowedByRule` method in packages/agent-sdk/src/managers/permissionManager.ts
- [x] T004 [US1] Verify prefix matching with unit tests in packages/agent-sdk/tests/managers/permissionManager.test.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Exact Matching (Priority: P2)

**Goal**: Ensure exact matching still works as expected for rules without `:*` suffix.

**Independent Test**: Add `Bash(ls -la)` to `permissions.allow` and verify only that exact command works.

### Implementation for User Story 2

- [x] T005 [US2] Add exact matching test cases to packages/agent-sdk/tests/managers/permissionManager.test.ts
- [x] T006 [US2] Verify exact matching logic in packages/agent-sdk/src/managers/permissionManager.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Strict Prefix Marker (Priority: P3)

**Goal**: Ensure `:*` only works as a prefix marker when it is at the very end of the pattern.

**Independent Test**: Add `Bash(echo :* test)` and verify it only matches that exact string, not as a wildcard.

### Implementation for User Story 3

- [x] T007 [US3] Add strict prefix marker test cases to packages/agent-sdk/tests/managers/permissionManager.test.ts
- [x] T008 [US3] Refine `isAllowedByRule` in packages/agent-sdk/src/managers/permissionManager.ts to ensure `:*` is only treated as a prefix marker at the end of the string

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T009 [P] Run `pnpm build` in packages/agent-sdk to ensure changes are propagated
- [x] T010 [P] Run `pnpm run type-check` and `pnpm lint` in packages/agent-sdk
- [x] T011 [P] Run all tests in packages/agent-sdk/tests/managers/permissionManager.test.ts to ensure no regressions
- [x] T012 [P] Validate implementation against quickstart.md scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1) is the MVP and should be completed first.
  - User Story 2 and 3 can proceed in parallel or sequentially.
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Can start after Foundational (Phase 2)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2)

### Parallel Opportunities

- T001 can run in parallel with other setup tasks if any.
- T009, T010, T011, T012 can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
