# Tasks: Agent Constructor Configuration ✅ COMPLETE

**Status**: All tasks completed successfully - Feature ready for production

**Input**: Design documents from `/specs/004-agent-constructor-config/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only include them if explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Agent SDK Package**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- All paths relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and configuration interfaces

- [x] T001 Create configuration interfaces in packages/agent-sdk/src/types.ts
- [x] T002 [P] Create configuration resolver utilities in packages/agent-sdk/src/utils/configResolver.ts
- [x] T003 [P] Create configuration validator utilities in packages/agent-sdk/src/utils/configValidator.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core configuration infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Update AgentOptions interface in packages/agent-sdk/src/agent.ts to include optional configuration parameters
- [x] T005 Implement configuration resolution logic in packages/agent-sdk/src/utils/configResolver.ts
- [x] T006 Implement configuration validation logic in packages/agent-sdk/src/utils/configValidator.ts
- [x] T007 Create ConfigurationError class and error constants in packages/agent-sdk/src/types.ts (moved to types.ts instead of separate errors.ts file)

**Checkpoint**: Configuration foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Explicit AI Service Configuration (Priority: P1) 🎯 MVP

**Goal**: Enable developers to configure AI gateway settings (API key, base URL) through Agent constructor with environment variable fallbacks

**Independent Test**: Create Agent instance with custom apiKey and baseURL, verify it uses those values instead of environment variables

### Implementation for User Story 1

- [x] T008 [US1] Update Agent.create method in packages/agent-sdk/src/agent.ts to resolve gateway configuration from constructor args and environment variables
- [x] T009 [US1] Update AIManager constructor in packages/agent-sdk/src/managers/aiManager.ts to accept resolved GatewayConfig
- [x] T010 [US1] Update AIService constructor in packages/agent-sdk/src/services/aiService.ts to use injected GatewayConfig instead of process.env
- [x] T011 [US1] Remove direct process.env access for AIGW_TOKEN and AIGW_URL from packages/agent-sdk/src/services/aiService.ts
- [x] T012 [US1] Add configuration validation and error handling for missing gateway configuration in Agent.create method

**Checkpoint**: At this point, User Story 1 should be fully functional - Agent can be created with explicit gateway configuration and falls back to environment variables

---

## Phase 4: User Story 2 - Token Limit Configuration (Priority: P2)

**Goal**: Enable developers to configure custom token limits through Agent constructor to control message compression behavior

**Independent Test**: Create Agent with custom maxInputTokens, verify compression triggers at specified limit instead of environment variable or default

### Implementation for User Story 2

- [x] T013 [P] [US2] Update Agent.create method in packages/agent-sdk/src/agent.ts to resolve maxInputTokens from constructor args, environment variables, or defaults
- [x] T014 [US2] Update AIManager constructor in packages/agent-sdk/src/managers/aiManager.ts to accept resolved maxInputTokens parameter
- [x] T015 [US2] Remove direct process.env.WAVE_MAX_INPUT_TOKENS access from packages/agent-sdk/src/managers/aiManager.ts
- [x] T016 [US2] Update token limit validation logic to use resolved configuration in packages/agent-sdk/src/utils/configValidator.ts
- [x] T017 [US2] Update message compression logic to use injected maxInputTokens in packages/agent-sdk/src/managers/aiManager.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - Agent supports both gateway configuration and token limit configuration

---

## Phase 5: User Story 3 - Model Selection Configuration (Priority: P3)

**Goal**: Enable developers to specify AI models (agent model and fast model) through Agent constructor instead of environment variables

**Independent Test**: Create Agent with custom agentModel and fastModel, verify specified models are used for AI operations instead of environment variables or defaults

### Implementation for User Story 3

- [x] T018 [P] [US3] Update Agent.create method in packages/agent-sdk/src/agent.ts to resolve model configuration from constructor args, environment variables, or defaults
- [x] T019 [US3] Update AIManager constructor in packages/agent-sdk/src/managers/aiManager.ts to accept resolved ModelConfig
- [x] T020 [US3] Update AIService to use injected ModelConfig instead of constants from packages/agent-sdk/src/utils/constants.ts
- [x] T021 [US3] Remove direct process.env access for AIGW_MODEL and AIGW_FAST_MODEL from packages/agent-sdk/src/utils/constants.ts
- [x] T022 [US3] Update model selection logic in packages/agent-sdk/src/services/aiService.ts to use injected configuration
- [x] T023 [US3] Update constants.ts to support configuration injection while maintaining backward compatibility

**Checkpoint**: ✅ COMPLETE - All user stories are now fully functional - Agent supports complete configuration override with environment fallbacks

---

## Phase 6: Polish & Cross-Cutting Concerns ✅ COMPLETE

**Purpose**: Testing, validation, and quality improvements across all user stories

- [x] T024 [P] Create comprehensive configuration tests in packages/agent-sdk/tests/agent/agent.config.test.ts
- [x] T025 [P] Update existing AIService tests in packages/agent-sdk/tests/services/aiService.test.ts to use configuration injection
- [x] T026 [P] Update existing AIManager tests in packages/agent-sdk/tests/managers/aiManager.test.ts to use configuration injection (no AIManager test file exists currently)
- [x] T027 Build agent-sdk package to ensure TypeScript compilation
- [x] T028 Run type-check validation across agent-sdk package
- [x] T029 Run lint validation across agent-sdk package
- [x] T030 Validate quickstart.md examples work with new configuration API

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1 but builds on Agent.create changes
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Independent of US1/US2 but builds on Agent.create changes

### Within Each User Story

- Agent.create method changes before Manager updates
- Manager updates before Service updates  
- Service updates before removing environment variable access
- Core implementation before validation and error handling
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks can run sequentially (they modify same files)
- Once Foundational phase completes, user stories can start in parallel (if team capacity allows)
- Tasks within Phase 6 marked [P] can run in parallel

---

## Parallel Example: User Story 2

```bash
# These US2 tasks can run in parallel after foundational phase:
Task: "Update Agent.create method to resolve maxInputTokens (T013)"
Task: "Update token limit validation logic (T016)" 
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Gateway configuration)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Build and validate with type-check/lint

### Incremental Delivery

1. Complete Setup + Foundational → Configuration foundation ready
2. Add User Story 1 → Test independently → Gateway configuration working
3. Add User Story 2 → Test independently → Token limits configurable  
4. Add User Story 3 → Test independently → Models configurable
5. Each story adds value without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Gateway config)
   - Developer B: User Story 2 (Token limits) 
   - Developer C: User Story 3 (Model selection)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story should be independently completable and testable
- Maintain 100% backward compatibility through environment variable fallbacks
- Preserve testing-related environment variables (NODE_ENV, VITEST, WAVE_TEST_HOOKS_EXECUTION) unchanged
- Build agent-sdk package after modifications before testing
- Stop at any checkpoint to validate story independently
- Avoid: breaking changes, removing environment variable support, modifying testing infrastructure