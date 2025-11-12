# Tasks: Split Types by Domain

**Input**: Design documents from `/specs/010-split-types-by-domain/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No test tasks required - existing test suite will validate refactoring works correctly through TypeScript compilation and existing tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo package**: `packages/agent-sdk/src/types/`
- All paths are within the existing agent-sdk package structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and foundation setup

- [X] T001 Analyze current types in packages/agent-sdk/src/types/index.ts and identify all type definitions
- [X] T002 Create backup of existing packages/agent-sdk/src/types/index.ts for rollback safety
- [X] T003 [P] Run TypeScript compilation baseline check with pnpm run type-check to ensure current state

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core domain files that MUST be complete before user story implementations

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create packages/agent-sdk/src/types/core.ts with Logger, Usage, ConfigurationError, CONFIG_ERRORS
- [X] T005 [P] Create packages/agent-sdk/src/types/messaging.ts file structure with dependencies import
- [X] T006 [P] Create packages/agent-sdk/src/types/mcp.ts file structure (no dependencies)
- [X] T007 [P] Create packages/agent-sdk/src/types/processes.ts file structure (no dependencies)
- [X] T008 [P] Create packages/agent-sdk/src/types/commands.ts file structure (no dependencies)
- [X] T009 [P] Create packages/agent-sdk/src/types/skills.ts file structure with dependencies import
- [X] T010 [P] Create packages/agent-sdk/src/types/config.ts file structure (no dependencies)

**Checkpoint**: Foundation domain files created - user story implementation can now begin

---

## Phase 3: User Story 1 - Developer Imports Domain-Specific Types (Priority: P1) 🎯 MVP

**Goal**: Enable developers to import types from specific domain files (messaging, MCP, configuration, etc.) instead of monolithic index

**Independent Test**: Import types from domain files (e.g., `import { Message } from 'wave-agent-sdk/types/messaging'`) and verify correct functionality

### Implementation for User Story 1

- [X] T011 [P] [US1] Implement core types in packages/agent-sdk/src/types/core.ts (Logger, Usage, ConfigurationError, CONFIG_ERRORS)
- [X] T012 [P] [US1] Implement messaging types in packages/agent-sdk/src/types/messaging.ts with Usage dependency
- [X] T013 [P] [US1] Implement MCP types in packages/agent-sdk/src/types/mcp.ts (McpServerConfig, McpConfig, McpTool, McpServerStatus)
- [X] T014 [P] [US1] Implement process types in packages/agent-sdk/src/types/processes.ts (BackgroundShell)
- [X] T015 [P] [US1] Implement command types in packages/agent-sdk/src/types/commands.ts (SlashCommand, CustomSlashCommand configs)
- [X] T016 [P] [US1] Implement skill types in packages/agent-sdk/src/types/skills.ts with Logger dependency and SKILL_DEFAULTS
- [X] T017 [P] [US1] Implement configuration types in packages/agent-sdk/src/types/config.ts (GatewayConfig, ModelConfig)
- [X] T018 [US1] Verify TypeScript compilation passes with pnpm run type-check after domain file creation
- [X] T019 [US1] Test domain-specific imports work correctly by creating simple test imports

**Checkpoint**: At this point, all domain files exist and can be imported independently

---

## Phase 4: User Story 2 - Unused Types Removal (Priority: P2)

**Goal**: Remove unused type definitions (AIRequest, AIResponse, ConfigurationResolver, ConfigurationValidator) to reduce cognitive load

**Independent Test**: Search codebase for removed type usage and confirm zero references exist, verify compilation still passes

### Implementation for User Story 2

- [X] T020 [US2] Search codebase for AIRequest usage and confirm zero references in packages/agent-sdk/
- [X] T021 [US2] Search codebase for AIResponse usage and confirm zero references in packages/agent-sdk/
- [X] T022 [US2] Search codebase for ConfigurationResolver usage and confirm zero references in packages/agent-sdk/
- [X] T023 [US2] Search codebase for ConfigurationValidator usage and confirm zero references in packages/agent-sdk/
- [X] T024 [P] [US2] Remove AIRequest and AIResponse interfaces from domain files (already excluded)
- [X] T025 [P] [US2] Remove ConfigurationResolver and ConfigurationValidator interfaces from domain files (already excluded)
- [X] T026 [US2] Verify TypeScript compilation passes after unused type removal with pnpm run type-check
- [X] T027 [US2] Verify existing configuration utilities still work without removed interface contracts

**Checkpoint**: At this point, unused types are removed and codebase compiles successfully

---

## Phase 5: User Story 3 - Backward Compatibility for Existing Imports (Priority: P3)

**Goal**: Maintain backward compatibility so existing code importing from main types file continues to work

**Independent Test**: Run existing code that imports from main types index and verify all functionality remains intact

### Implementation for User Story 3

- [X] T028 [US3] Create comprehensive barrel export in packages/agent-sdk/src/types/index.ts re-exporting all domain types
- [X] T029 [US3] Verify all existing type names remain accessible through main index import
- [X] T030 [US3] Test legacy import pattern `import { Message, Logger } from 'wave-agent-sdk/types'` works correctly
- [X] T031 [US3] Verify no breaking changes to existing type names or signatures
- [X] T032 [US3] Run full TypeScript compilation across entire codebase with pnpm run type-check
- [X] T033 [US3] Verify existing tests pass to confirm backward compatibility maintained
- [X] T034 [US3] Test mixed import scenarios (domain + legacy imports in same file)

**Checkpoint**: All user stories should now be independently functional with full backward compatibility

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and optimization across all user stories

- [ ] T035 [P] Run complete build with pnpm build to verify agent-sdk builds successfully
- [ ] T036 [P] Verify tree-shaking works correctly with domain-specific imports
- [ ] T037 [P] Add JSDoc documentation to domain files explaining their purpose
- [ ] T038 Validate quickstart.md examples work with new domain structure
- [ ] T039 Run final type-check and lint validation across entire codebase
- [ ] T040 Performance check: verify no compilation time regression

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1, focuses on cleanup
- **User Story 3 (P3)**: Should start after US1 completion - Needs domain files to exist for re-export

### Within Each User Story

- Domain file creation before type implementation
- Core types before dependent domain types (messaging, skills depend on core)
- Individual domain implementations can proceed in parallel
- Validation after implementation

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Within User Story 1: All domain file implementations marked [P] can run in parallel after core.ts
- User Stories 1 and 2 can run in parallel (US2 is cleanup focused)
- All Polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# After T011 (core.ts) completes, launch all dependent domain implementations:
Task: "Implement messaging types in packages/agent-sdk/src/types/messaging.ts"
Task: "Implement MCP types in packages/agent-sdk/src/types/mcp.ts"
Task: "Implement process types in packages/agent-sdk/src/types/processes.ts"
Task: "Implement command types in packages/agent-sdk/src/types/commands.ts"
Task: "Implement skill types in packages/agent-sdk/src/types/skills.ts"
Task: "Implement configuration types in packages/agent-sdk/src/types/config.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test domain imports work independently
5. Proceed to additional user stories if desired

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test domain imports → Deploy/Demo (MVP!)
3. Add User Story 2 → Cleanup unused types → Validate
4. Add User Story 3 → Full backward compatibility → Deploy/Demo
5. Each story adds value without breaking previous functionality

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (domain implementations)
   - Developer B: User Story 2 (cleanup analysis and removal)
   - Developer C: User Story 3 (backward compatibility setup)
3. Stories complete and integrate with coordination

---

## Notes

- [P] tasks = different files, no dependencies between tasks
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- No new test files needed - existing tests validate refactoring works
- Commit after each logical group of tasks
- Stop at any checkpoint to validate story independently
- Focus on maintaining zero breaking changes throughout process