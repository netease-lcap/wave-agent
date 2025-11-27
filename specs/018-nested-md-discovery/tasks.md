# Tasks: Nested Markdown Discovery for Slash Commands

**Input**: Design documents from `/specs/018-nested-md-discovery/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Following TDD approach as required by Wave Agent Constitution - tests are included and must be written FIRST.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Paths are adjusted based on plan.md structure for Wave Agent monorepo

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Ensure feature branch `018-nested-md-discovery` is checked out and dependencies installed
- [X] T002 [P] Run `pnpm build` in packages/agent-sdk to establish baseline
- [X] T003 [P] Verify existing test infrastructure works with `pnpm test` in packages/agent-sdk

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create enhanced type definitions in packages/agent-sdk/src/types/commands.ts (add nested command fields)
- [X] T005 [P] Create utility functions for path-to-command-ID conversion in packages/agent-sdk/src/utils/commandPathResolver.ts
- [X] T006 [P] Add command ID validation utilities in packages/agent-sdk/src/utils/commandPathResolver.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic Nested Command Discovery (Priority: P1) 🎯 MVP

**Goal**: System discovers nested directories and registers commands with colon syntax (`/openspec:apply`)

**Independent Test**: Create `.wave/commands/openspec/apply.md` and verify it's discovered as `/openspec:apply`

### Tests for User Story 1 (TDD - Write FIRST) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T007 [P] [US1] Test nested command discovery in packages/agent-sdk/tests/utils/customCommands.nested.test.ts
- [X] T008 [P] [US1] Test command ID generation from file paths in packages/agent-sdk/tests/utils/commandPathResolver.test.ts
- [X] T009 [P] [US1] Test depth limit enforcement (ignore files deeper than 1 level) in packages/agent-sdk/tests/utils/customCommands.nested.test.ts

### Implementation for User Story 1

- [X] T010 [P] [US1] Implement recursive directory scanning with depth control in packages/agent-sdk/src/utils/customCommands.ts
- [X] T011 [P] [US1] Implement command ID generation from file paths in packages/agent-sdk/src/utils/commandPathResolver.ts  
- [X] T012 [US1] Update scanCommandsDirectory function to use recursive scanning in packages/agent-sdk/src/utils/customCommands.ts
- [X] T013 [US1] Add nested command metadata to returned CustomSlashCommand objects in packages/agent-sdk/src/utils/customCommands.ts
- [X] T014 [US1] Add error handling for deep nesting and invalid file names in packages/agent-sdk/src/utils/customCommands.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Multi-Level Command Discovery (Priority: P2)

**Goal**: System supports both root-level commands (`/help`) and nested commands (`/openspec:apply`) seamlessly

**Independent Test**: Create commands at both root and nested levels, verify both syntaxes work correctly

### Tests for User Story 2 (TDD - Write FIRST) ⚠️

- [X] T015 [P] [US2] Test mixed flat and nested command discovery in packages/agent-sdk/tests/utils/customCommands.mixed.test.ts
- [X] T016 [P] [US2] Test command parsing for colon syntax in packages/agent-sdk/tests/managers/slashCommandManager.nested.test.ts
- [X] T017 [P] [US2] Test command execution with nested syntax in packages/agent-sdk/tests/managers/slashCommandManager.nested.test.ts

### Implementation for User Story 2

- [X] T018 [US2] Update command input parsing to handle colon syntax in packages/agent-sdk/src/managers/slashCommandManager.ts
- [X] T019 [US2] Ensure parseAndValidateSlashCommand handles nested command IDs in packages/agent-sdk/src/managers/slashCommandManager.ts (✅ already working correctly)
- [X] T020 [US2] Verify getCommands() returns both flat and nested commands correctly in packages/agent-sdk/src/managers/slashCommandManager.ts (✅ confirmed via tests)
- [X] T021 [US2] Test integration with existing CommandSelector component (verify no changes needed) in packages/code/src/components/CommandSelector.tsx (✅ no changes needed)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T022 [P] Run comprehensive integration tests across packages/agent-sdk and packages/code
- [X] T023 [P] Performance validation - ensure command discovery adds <50ms to startup time (✅ fast recursive scanning)
- [X] T024 [P] Run type-check and lint validation as per constitution requirements
- [X] T025 Run quickstart.md validation with real command structure examples
- [X] T026 [P] Update AGENTS.md context with any new technical learnings (if needed) (✅ no update needed - existing patterns used)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1 but is independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD requirement)
- Type definitions before utility functions
- Utility functions before core discovery logic
- Core discovery before manager integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, both user stories can start in parallel
- All tests for a user story marked [P] can run in parallel
- Type definitions and utility functions marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (TDD first):
Task: "Test nested command discovery in packages/agent-sdk/tests/utils/customCommands.nested.test.ts"
Task: "Test command ID generation from file paths in packages/agent-sdk/tests/utils/commandPathResolver.test.ts"
Task: "Test depth limit enforcement in packages/agent-sdk/tests/utils/customCommands.nested.test.ts"

# Then launch parallel implementations:
Task: "Implement recursive directory scanning in packages/agent-sdk/src/utils/customCommands.ts"
Task: "Implement command ID generation in packages/agent-sdk/src/utils/commandPathResolver.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently using quickstart examples
5. Deploy/demo if ready - basic nested command discovery working

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP ready! (nested command discovery)
3. Add User Story 2 → Test independently → Full feature (mixed flat/nested support)
4. Each story adds value without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (nested discovery core)
   - Developer B: User Story 2 (integration and mixed support)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- TDD required: verify tests fail before implementing
- Run `pnpm build` in agent-sdk after changes before testing in code package
- Stop at any checkpoint to validate story independently
- Constitution compliance: no new docs, TDD workflow, package boundaries maintained

## Success Metrics

**Total Tasks**: 26 tasks
- **User Story 1**: 8 tasks (3 tests + 5 implementation)
- **User Story 2**: 7 tasks (3 tests + 4 implementation) 
- **Setup/Foundation**: 6 tasks
- **Polish**: 5 tasks

**Parallel Opportunities**: 13 tasks marked [P] can run in parallel within their phases

**Independent Test Criteria**:
- US1: Create nested directory with .md file, verify colon syntax command discovered
- US2: Create both flat and nested commands, verify both syntaxes work correctly

**Suggested MVP Scope**: User Story 1 only (basic nested discovery with colon syntax)