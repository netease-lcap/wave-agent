# Tasks: Refactor Configuration Management

**Input**: Design documents from `/specs/027-refactor-config-management/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the feature specification, focusing on refactoring tasks only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project structure validation and refactoring preparation

- [x] T001 Validate current codebase structure and run baseline tests `pnpm test`
- [x] T002 [P] Run type checking baseline `pnpm run type-check`
- [x] T003 [P] Run linting baseline `pnpm run lint`
- [x] T004 Create backup branch point before refactoring begins

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core service infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create ConfigurationService interface in packages/agent-sdk/src/services/configurationService.ts
- [x] T006 [P] Create EnvironmentService interface in packages/agent-sdk/src/services/environmentService.ts
- [x] T007 [P] Create ConfigurationLoadResult type in packages/agent-sdk/src/types/configuration.ts
- [x] T008 [P] Create EnvironmentProcessResult type in packages/agent-sdk/src/types/environment.ts
- [x] T009 Export new service interfaces from packages/agent-sdk/src/services/index.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Environment Variable Management Cleanup (Priority: P1) 🎯 MVP

**Goal**: Eliminate redundant environment variable passing to hook execution and ensure hooks access variables only through process.env

**Independent Test**: Hooks can access environment variables through process.env without requiring them to be passed as additional parameters

### Implementation for User Story 1

- [x] T010 [P] [US1] Extract mergeEnvironmentConfigs function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/environmentService.ts
- [x] T011 [P] [US1] Extract validateEnvironmentConfig function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/environmentService.ts
- [x] T012 [US1] Implement applyEnvironmentVariables method in packages/agent-sdk/src/services/environmentService.ts
- [x] T013 [US1] Implement processEnvironmentConfig method in packages/agent-sdk/src/services/environmentService.ts
- [x] T014 [US1] Remove additionalEnvVars parameter from executeCommand in packages/agent-sdk/src/services/hook.ts
- [x] T015 [US1] Remove additionalEnvVars parameter from executeCommands in packages/agent-sdk/src/services/hook.ts
- [x] T016 [US1] Update LiveConfigManager to use EnvironmentService in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T017 [US1] Update HookManager to remove environment variable passing in packages/agent-sdk/src/managers/hookManager.ts

**Checkpoint**: At this point, hooks should access environment variables only through process.env

---

## Phase 4: User Story 2 - Centralized Configuration Management (Priority: P2)

**Goal**: Move settings.json loading, validation, and merging logic from hook-specific files to centralized configuration modules

**Independent Test**: Configuration management functions are accessible from central location and hook files contain only execution logic

### Implementation for User Story 2

- [x] T018 [P] [US2] Extract loadWaveConfigFromFile function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts
- [x] T019 [P] [US2] Extract loadWaveConfigFromFiles function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts
- [x] T020 [P] [US2] Extract loadMergedWaveConfig function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts
- [x] T021 [US2] Implement loadConfiguration method in packages/agent-sdk/src/services/configurationService.ts
- [x] T022 [US2] Implement loadMergedConfiguration method in packages/agent-sdk/src/services/configurationService.ts
- [x] T023 [US2] Implement validateConfiguration method in packages/agent-sdk/src/services/configurationService.ts
- [x] T024 [US2] Update ConfigurationWatcher to use ConfigurationService in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T025 [US2] Update LiveConfigManager to use ConfigurationService in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T026 [US2] Remove loadConfigurationFromSettings method from packages/agent-sdk/src/managers/hookManager.ts (method did not exist in current codebase)

**Checkpoint**: Configuration management is now centralized and hook files focus only on execution

**✅ COMPLETED PHASES 1-4** (as of current implementation):
- Phase 1: Setup completed - All baseline tests, type checks, and linting pass
- Phase 2: Foundational completed - Core service interfaces and types implemented
- Phase 3: User Story 1 completed - Environment variable management centralized in EnvironmentService
- Phase 4: User Story 2 completed - Configuration loading centralized in ConfigurationService
- All 1190 tests passing, TypeScript compilation clean

---

## Phase 5: User Story 4 - Simplified Configuration Loading (Priority: P2)

**Goal**: Remove complex fallback mechanisms and provide clear user feedback about configuration status

**Independent Test**: System clearly reports configuration status without silent fallbacks when invalid configuration is provided

### Implementation for User Story 4

- [x] T027 [P] [US4] Remove loadWaveConfigFromFileWithFallback function from packages/agent-sdk/src/services/configurationService.ts
- [x] T028 [P] [US4] Remove loadMergedWaveConfigWithFallback function from packages/agent-sdk/src/services/configurationService.ts
- [x] T029 [US4] Update ConfigurationService.loadConfiguration to return clear success/failure status in packages/agent-sdk/src/services/configurationService.ts
- [x] T030 [US4] Update ConfigurationService.loadMergedConfiguration to provide clear error messages in packages/agent-sdk/src/services/configurationService.ts
- [x] T031 [US4] Update ConfigurationWatcher to use simplified loading without fallbacks in packages/agent-sdk/src/services/configurationWatcher.ts
- [x] T032 [US4] Update LiveConfigManager to handle configuration errors with user feedback in packages/agent-sdk/src/managers/liveConfigManager.ts
- [x] T033 [US4] Add configuration status logging to EnvironmentService in packages/agent-sdk/src/services/environmentService.ts

**Checkpoint**: Configuration loading provides transparent feedback without silent fallbacks

---

## Phase 6: User Story 3 - Improved Code Organization (Priority: P3)

**Goal**: Ensure clean separation between configuration management and hook execution with clear module boundaries

**Independent Test**: Configuration logic is found in appropriately named modules and hook files contain only execution logic

### Implementation for User Story 3

- [x] T034 [P] [US3] Remove all loadWaveConfig* function exports from packages/agent-sdk/src/services/hook.ts (already completed - functions were moved to ConfigurationService)
- [x] T035 [P] [US3] Remove all environment management function exports from packages/agent-sdk/src/services/hook.ts (already completed - functions were moved to EnvironmentService)
- [x] T036 [P] [US3] Remove config path utility re-exports from packages/agent-sdk/src/services/hook.ts (already completed - utilities are imported directly where needed)
- [x] T037 [US3] Update all imports to use ConfigurationService in packages/agent-sdk/src/managers/liveConfigManager.ts (already completed)
- [x] T038 [US3] Update all imports to use EnvironmentService in packages/agent-sdk/src/managers/liveConfigManager.ts (already completed)
- [x] T039 [US3] Verify hook.ts contains only execution-related functions in packages/agent-sdk/src/services/hook.ts (verified - only executeCommand, executeCommands, isCommandSafe)
- [x] T040 [US3] Update service exports to include new configuration services in packages/agent-sdk/src/index.ts (already completed)

**Checkpoint**: All configuration logic is properly separated and organized in dedicated services

**✅ COMPLETED PHASES 1-6** (as of current implementation):
- Phase 1: Setup completed - All baseline tests, type checks, and linting pass
- Phase 2: Foundational completed - Core service interfaces and types implemented  
- Phase 3: User Story 1 completed - Environment variable management centralized in EnvironmentService
- Phase 4: User Story 2 completed - Configuration loading centralized in ConfigurationService
- Phase 5: User Story 4 completed - Configuration loading provides clear feedback without fallbacks
- Phase 6: User Story 3 completed - Clean code organization with proper separation of concerns
- All 1190 tests passing, TypeScript compilation clean

---

## Phase 7: Testing & Validation

**Purpose**: Ensure refactoring maintains functionality and passes all validation

- [x] T041 [P] Create ConfigurationService tests in packages/agent-sdk/tests/services/configurationService.test.ts
- [x] T042 [P] Create EnvironmentService tests in packages/agent-sdk/tests/services/environmentService.test.ts
- [x] T043 [P] Update hook.test.ts to remove config-related tests in packages/agent-sdk/tests/services/hook.test.ts
- [x] T044 [P] Update hookManager.test.ts for new integration in packages/agent-sdk/tests/managers/hookManager.test.ts
- [x] T045 [P] Update liveConfigManager.test.ts for new service integration in packages/agent-sdk/tests/managers/liveConfigManager.test.ts
- [x] T046 Run full test suite `pnpm test` and verify all tests pass
- [x] T047 Run type checking `pnpm run type-check` and resolve any issues
- [x] T048 Run linting `pnpm run lint` and resolve any issues
- [x] T049 Build agent-sdk `pnpm build` and verify successful compilation
- [x] T050 Manual testing of configuration loading and hook execution per quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Testing (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May use types from US1 but independently testable
- **User Story 4 (P2)**: Depends on User Story 2 completion - builds on centralized configuration
- **User Story 3 (P3)**: Depends on User Stories 1, 2, and 4 - final cleanup and organization

### Within Each User Story

- Service interface creation before implementation
- Function extraction before integration updates
- Core implementation before dependent component updates
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Within User Story 1: T010, T011 can run in parallel (different functions)
- Within User Story 2: T018, T019, T020 can run in parallel (different functions)
- Within User Story 4: T027, T028 can run in parallel (different functions)
- Within User Story 3: T034, T035, T036 can run in parallel (different concerns)
- Testing phase: T041, T042, T043, T044, T045 can run in parallel (different test files)

---

## Parallel Example: User Story 2

```bash
# Launch function extractions for User Story 2 together:
Task: "Extract loadWaveConfigFromFile function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts"
Task: "Extract loadWaveConfigFromFiles function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts"
Task: "Extract loadMergedWaveConfig function from packages/agent-sdk/src/services/hook.ts to packages/agent-sdk/src/services/configurationService.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test that hooks work without additional environment variables
5. Verify environment variables are accessible through process.env only

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Validate environment variable cleanup (MVP!)
3. Add User Story 2 → Test independently → Validate centralized configuration
4. Add User Story 4 → Test independently → Validate simplified loading
5. Add User Story 3 → Test independently → Validate clean organization
6. Each story adds value without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (environment cleanup)
   - Developer B: User Story 2 (centralized config)
   - Developer C: User Story 4 (simplified loading)
3. User Story 3 (organization) happens after others complete
4. Testing phase can be distributed across team members

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- This is a refactoring project - maintain existing functionality while improving architecture
- Focus on one user story at a time to minimize risk
- Validate after each story that existing functionality still works
- Agent-sdk must be built with `pnpm build` after modifications before testing in dependent packages