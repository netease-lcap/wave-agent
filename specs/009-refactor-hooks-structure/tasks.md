# Tasks: Refactor Hooks System File Structure

**Input**: Design documents from `/specs/009-refactor-hooks-structure/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Tests are NOT explicitly requested in the feature specification, so no test tasks are included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create missing directory structure for file movements

- [x] T001 Create types directory at packages/agent-sdk/src/types/
- [x] T002 Create types test directory at packages/agent-sdk/tests/types/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create and populate new files in target locations before updating imports

**⚠️ CRITICAL**: No import updates can begin until this phase is complete

- [x] T003 [P] Move and rename src/types.ts to src/types/index.ts
- [x] T004 [P] Move src/hooks/types.ts to src/types/hooks.ts and update internal imports
- [x] T005 [P] Move src/hooks/matcher.ts to src/utils/matcher.ts and update internal imports
- [x] T006 [P] Move src/hooks/manager.ts to src/managers/hookManager.ts and update internal imports to reference new locations
- [x] T007 Create consolidated src/services/hook.ts by merging executor and settings functionality from src/hooks/executor.ts and src/hooks/settings.ts
- [x] T008 Refactor executor functions in src/services/hook.ts to remove logger dependencies and convert from class methods to standalone functions
- [x] T009 [P] Move tests/hooks/types.test.ts to tests/types/hooks.test.ts and update imports
- [x] T010 [P] Move tests/hooks/matcher.test.ts to tests/utils/matcher.test.ts and update imports
- [x] T011 [P] Move tests/hooks/manager.test.ts to tests/managers/hookManager.test.ts and update imports
- [x] T012 Create consolidated tests/services/hook.test.ts by merging executor and settings test functionality from tests/hooks/executor.test.ts and tests/hooks/settings.test.ts

**Checkpoint**: Foundation ready - import path updates can now begin

---

## Phase 3: User Story 1 - Developer Imports Hook Components Correctly (Priority: P1) 🎯 MVP

**Goal**: Update all import statements across the codebase to reference components in their new locations

**Independent Test**: Import all hook-related exports and verify they resolve correctly and deliver the same functionality as before

### Implementation for User Story 1

- [x] T013 [US1] Update HookManager imports in src/agent.ts to reference src/managers/hookManager.ts
- [x] T014 [P] [US1] Update hook executor function imports in src/managers/hookManager.ts to reference src/services/hook.ts
- [x] T015 [P] [US1] Update hook settings function imports in src/managers/hookManager.ts to reference src/services/hook.ts
- [x] T016 [P] [US1] Update HookMatcher imports in src/managers/hookManager.ts to reference src/utils/matcher.ts
- [x] T017 [P] [US1] Update hook type imports across all moved files to reference src/types/hooks.ts
- [x] T018 [US1] Remove hooks export from src/index.ts (line 20: export * from "./hooks/index.js")
- [x] T019 [US1] Add individual exports for hook components in src/index.ts referencing their new locations

**Checkpoint**: At this point, User Story 1 should be fully functional - all imports resolve and components work

---

## Phase 4: User Story 2 - Codebase Follows Logical Architecture Patterns (Priority: P2)

**Goal**: Ensure files are organized by their architectural role with proper constitutional compliance

**Independent Test**: Review file structure and verify each file is in a directory that matches its responsibility per Constitution VII

### Implementation for User Story 2

- [x] T020 [US2] Verify HookManager placement in managers/ directory aligns with state management responsibility
- [x] T021 [US2] Verify hook executor functions placement in services/ directory aligns with execution responsibility
- [x] T022 [US2] Verify hook settings functions placement in services/ directory aligns with I/O operations responsibility
- [x] T023 [US2] Verify HookMatcher placement in utils/ directory aligns with pure utility function responsibility
- [x] T024 [US2] Verify hook types placement in types/ directory aligns with cross-file type definitions responsibility
- [x] T025 [US2] Remove empty src/hooks/ directory completely
- [x] T026 [US2] Remove empty tests/hooks/ directory completely

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - imports work and architecture is clean

---

## Phase 5: User Story 3 - Build and Test Systems Continue Working (Priority: P1)

**Goal**: Ensure existing build pipeline, test suites, and dependent projects continue to function

**Independent Test**: Run full test suite and build process and verify all tests pass and builds succeed

### Implementation for User Story 3

- [x] T027 [US3] Run TypeScript type checking with `pnpm type-check` to verify no import resolution errors
- [x] T028 [US3] Run linting with `pnpm lint` to verify code quality standards are maintained
- [x] T029 [US3] Run test suite with `pnpm test` to verify all existing tests pass with new file structure
- [x] T030 [US3] Build agent-sdk package with `pnpm build` to verify compilation succeeds
- [x] T031 [US3] Verify test file discovery by running tests in each new directory (managers, services, utils, types)
- [x] T032 [US3] Update any remaining internal references or imports that may have been missed

**Checkpoint**: All user stories should now be independently functional and build system works

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup and validation

- [x] T033 [P] Verify no remaining references to src/hooks/ or tests/hooks/ directories exist in codebase
- [x] T034 [P] Validate that all hook functionality works identically to before refactoring
- [x] T035 [P] Confirm all constitutional principles are satisfied (managers for state, services for I/O, utils for pure functions)
- [x] T036 Run final comprehensive test to ensure refactoring is complete and functional

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in priority order (P1 → P2 → P1)
- **Polish (Final Phase)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 completion (import paths must work before architecture validation)
- **User Story 3 (P1)**: Depends on User Stories 1 and 2 completion (build/test validation requires working imports and clean architecture)

### Within Each User Story

- Import updates must happen atomically to prevent broken intermediate states
- File movements in foundational phase before import updates in user story phases
- Type checking and validation after each major change
- Build verification after all changes complete

### Parallel Opportunities

- All Setup tasks can run in parallel (different directories)
- Within Foundational phase: File movements to different directories marked [P] can run in parallel
- Within User Story 1: Import updates to different files marked [P] can run in parallel
- Within User Story 2: Architecture verification tasks can run in parallel
- Within User Story 3: Different build/test validation tasks can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all import updates for User Story 1 together:
Task: "Update hook executor function imports in src/managers/hookManager.ts to reference src/services/hook.ts"
Task: "Update hook settings function imports in src/managers/hookManager.ts to reference src/services/hook.ts"
Task: "Update HookMatcher imports in src/managers/hookManager.ts to reference src/utils/hookMatcher.ts"
Task: "Update hook type imports across all moved files to reference src/types/hooks.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test that all hook components can be imported and work correctly
5. Ready for basic usage with new import paths

### Incremental Delivery

1. Complete Setup + Foundational → Files moved and ready
2. Add User Story 1 → Test imports work → Basic functionality restored
3. Add User Story 2 → Test architecture is clean → Constitutional compliance achieved
4. Add User Story 3 → Test build/tests pass → Full refactoring complete
5. Each story adds validation without breaking previous functionality

### Single Developer Strategy

Since this is a focused refactoring within a single package:

1. Complete Setup + Foundational together (file movements)
2. Complete User Story 1 (import updates)
3. Complete User Story 2 (architecture validation)
4. Complete User Story 3 (build/test validation)
5. Polish phase for final cleanup

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Focus on maintaining identical functionality while improving organization
- All changes are within packages/agent-sdk/ - no cross-package dependencies affected