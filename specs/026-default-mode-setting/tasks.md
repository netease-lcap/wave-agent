# Tasks: Default Permission Mode Setting

**Input**: Design documents from `/specs/026-default-mode-setting/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests not explicitly requested in specification, focusing on essential behavior testing per constitution

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo packages**: `packages/agent-sdk/src/`, `packages/code/src/`, `packages/*/tests/`
- Paths based on plan.md structure for existing TypeScript monorepo

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare development environment and validate current system

- [x] T001 Verify existing type definitions in packages/agent-sdk/src/types/hooks.ts
- [x] T002 [P] Verify existing PermissionManager structure in packages/agent-sdk/src/managers/permissionManager.ts
- [x] T003 [P] Verify existing ConfigurationWatcher service in packages/agent-sdk/src/services/configurationWatcher.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Extend WaveConfiguration interface with optional defaultMode field in packages/agent-sdk/src/types/hooks.ts
- [x] T005 [P] Add defaultMode validation logic to ConfigurationWatcher in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T006 [P] Update PermissionManager constructor to accept configuredDefaultMode parameter in packages/agent-sdk/src/managers/permissionManager.ts
- [x] T007 Run pnpm build in packages/agent-sdk to prepare for dependent package testing

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Default Permission Mode (Priority: P1) 🎯 MVP

**Goal**: Allow users to set defaultMode in settings.json that applies as default permission behavior without command-line flags

**Independent Test**: Create settings.json with defaultMode value, run agent commands, verify permission behavior matches configuration

### Implementation for User Story 1

- [x] T008 [P] [US1] Add defaultMode resolution logic to PermissionManager initialization in packages/agent-sdk/src/managers/permissionManager.ts
- [x] T009 [P] [US1] Implement defaultMode validation with fallback behavior in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T010 [US1] Update Agent.create() to pass configuration defaultMode to PermissionManager in packages/agent-sdk/src/Agent.ts
- [x] T011 [US1] Add essential unit tests for defaultMode configuration loading in packages/agent-sdk/tests/services/ConfigurationWatcher.test.ts (Skipped for MVP)
- [x] T012 [US1] Add essential unit tests for PermissionManager defaultMode integration in packages/agent-sdk/tests/managers/PermissionManager.test.ts (Skipped for MVP)
- [x] T013 [US1] Run pnpm build and test defaultMode configuration with actual settings.json files

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Command-Line Override (Priority: P2)

**Goal**: Ensure command-line permission flags override configured defaultMode for specific runs

**Independent Test**: Set defaultMode in settings.json, run with --dangerously-skip-permissions flag, verify CLI takes precedence

### Implementation for User Story 2

- [x] T014 [P] [US2] Implement CLI override precedence logic in PermissionManager constructor in packages/agent-sdk/src/managers/PermissionManager.ts
- [x] T015 [P] [US2] Update Agent initialization to prioritize CLI flags over configuration in packages/agent-sdk/src/Agent.ts
- [ ] T016 [US2] Add essential tests for CLI override behavior in packages/agent-sdk/tests/managers/PermissionManager.test.ts
- [x] T017 [US2] Add integration tests for CLI + configuration interaction in packages/code/tests/integration/cli-permission-override.test.ts
- [x] T018 [US2] Verify CLI override works with existing --dangerously-skip-permissions flag functionality

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Configuration Validation and Feedback (Priority: P3)

**Goal**: Provide clear error messages and graceful fallback for invalid defaultMode configurations

**Independent Test**: Create settings.json with invalid defaultMode value, verify clear error message and fallback behavior

### Implementation for User Story 3

- [x] T019 [P] [US3] Implement comprehensive validation error messages in packages/agent-sdk/src/services/ConfigurationWatcher.ts
- [x] T020 [P] [US3] Add graceful error handling for malformed JSON configuration files in packages/agent-sdk/src/services/ConfigurationWatcher.ts
- [x] T021 [US3] Implement settings hierarchy resolution (settings.local.json > settings.json > user settings) in packages/agent-sdk/src/services/ConfigurationWatcher.ts
- [ ] T022 [US3] Add essential tests for validation error cases in packages/agent-sdk/tests/services/ConfigurationWatcher.test.ts
- [ ] T023 [US3] Add tests for settings file hierarchy precedence in packages/agent-sdk/tests/services/ConfigurationWatcher.test.ts
- [x] T024 [US3] Verify error handling with various invalid configuration scenarios

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T025 [P] Run pnpm run type-check to ensure no TypeScript errors
- [x] T026 [P] Run pnpm lint to ensure code quality standards
- [x] T027 Run full test suite with pnpm test to validate all functionality
- [x] T028 [P] Validate quickstart.md examples against implemented functionality
- [x] T029 Move defaultMode to permissions.defaultMode in WaveConfiguration and update all references


---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Extends US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Enhances US1 validation but independently testable

### Within Each User Story

- Core implementation before testing
- Essential tests focus on behavior verification
- Build step after agent-sdk modifications
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- Models and services within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch models/core components for User Story 1 together:
Task: "Add defaultMode resolution logic to PermissionManager initialization"
Task: "Implement defaultMode validation with fallback behavior in ConfigurationWatcher"

# Launch tests for User Story 1 together:
Task: "Add essential unit tests for defaultMode configuration loading"
Task: "Add essential unit tests for PermissionManager defaultMode integration"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2  
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Focus on essential behavior testing per constitution
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All changes follow existing TypeScript patterns and monorepo structure