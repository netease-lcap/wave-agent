# Tasks: Memory Management

**Input**: Design documents from `/specs/018-memory-management/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Research existing memory service and manager logic
- [X] T002 Document Project vs. User memory distinction in spec.md
- [X] T003 Document the memory saving flow in spec.md
- [X] T004 Define data models and storage formats in data-model.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T005 [P] Create unit test file for memory service in `packages/agent-sdk/tests/services/memory.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 & 2 - Save Memory (Priority: P1) 🎯 MVP

**Goal**: Enable saving project and user memory.

**Independent Test**: Ask the agent to remember something and verify it can be saved to either project or user storage.

### Tests for User Story 1 & 2 (REQUIRED) ⚠️

- [X] T007 [US1,US2] Write failing tests for memory saving detection
- [X] T008 [US1,US2] Write failing tests for file writing (Project vs User)

### Implementation for User Story 1 & 2

- [X] T009 [US1,US2] Implement memory saving detection in `packages/agent-sdk/src/prompts/autoMemory.ts`
- [X] T010 [US1,US2] Implement memory saving logic in `packages/agent-sdk/src/services/memory.ts`
- [X] T011 [US1,US2] Integrate memory retrieval into `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: User Stories 1 and 2 are fully functional and testable independently.

---

## Phase 4: User Story 3 - Manage Memory (Priority: P2)

**Goal**: Allow viewing and deleting memory entries.

**Independent Test**: Open memory management UI and delete an entry.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T013 [US3] Write failing tests for memory entry deletion

### Implementation for User Story 3

- [ ] T014 [US3] Create a UI component for managing (viewing/deleting) memory
- [ ] T015 [US3] Implement deletion logic in `packages/agent-sdk/src/services/memory.ts`

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: User Story 4 - Auto-Memory (Priority: P1)

**Goal**: Enable the agent to automatically save and retrieve project-specific knowledge.

**Independent Test**: Perform a task, start a new session, and verify the agent remembers the context.

### Tests for User Story 4 (REQUIRED) ⚠️

- [X] T019 [US4] Write failing tests for auto-memory directory resolution (git worktrees)
- [X] T020 [US4] Write failing tests for auto-memory context injection (200-line limit)
- [X] T021 [US4] Write failing tests for auto-memory "Safe Zone" permission bypass

### Implementation for User Story 4

- [X] T022 [US4] Implement auto-memory directory resolution in `packages/agent-sdk/src/services/memory.ts`
- [X] T023 [US4] Implement auto-memory context injection in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T024 [US4] Update `PermissionManager` to include auto-memory directory as a "Safe Zone"
- [X] T025 [US4] Add `autoMemoryEnabled` setting and environment variable support
- [X] T026 [US4] Ensure auto-memory directory and `MEMORY.md` are initialized on startup

**Checkpoint**: Auto-memory is fully functional and integrated.

---

## Phase 7: User Story 5 - Project-Level Modular Memory Rules (Priority: P1)

**Goal**: Load all `.md` files from `.wave/rules/` as project memory.

**Independent Test**: Create `.wave/rules/test.md`, verify it's loaded and included in the agent's system prompt.

- [X] T027 [US5] Define `MemoryRule` and `MemoryRuleMetadata` types in `packages/agent-sdk/src/types/memoryRule.ts`
- [X] T028 [US5] Export `MemoryRule` and `MemoryRuleMetadata` from `packages/agent-sdk/src/index.ts`
- [X] T029 [US5] Implement `MemoryRuleService.parseRule` using `markdownParser.ts` in `packages/agent-sdk/src/services/MemoryRuleService.ts`
- [X] T030 [US5] Implement `MemoryRuleService.isMatch` using `minimatch` in `packages/agent-sdk/src/services/MemoryRuleService.ts`
- [X] T031 [US5] Create unit tests for `MemoryRuleService` in `packages/agent-sdk/tests/MemoryRuleService.test.ts`
- [X] T032 [US5] Implement `MemoryRuleManager` skeleton with basic registry state in `packages/agent-sdk/src/managers/MemoryRuleManager.ts`
- [X] T033 [US5] Implement basic discovery of `.md` files in `.wave/rules/` in `MemoryRuleManager.ts`
- [X] T034 [US5] Implement `MemoryRuleManager.getActiveRules` to return all rules without path restrictions
- [X] T035 [US5] Integrate `MemoryRuleManager` into `Agent` class in `packages/agent-sdk/src/agent.ts`
- [X] T036 [US5] Update `AIManager` to include active memory rules in the system prompt in `packages/agent-sdk/src/managers/AIManager.ts`
- [X] T037 [US5] Create unit tests for project-level rule loading in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

---

## Phase 8: User Story 6 - Path-Specific Memory Rules (Priority: P1)

**Goal**: Activate memory rules only when working with matching files.

**Independent Test**: Create a rule with `paths: ["src/*.ts"]`, verify it's active when reading `src/main.ts` but inactive for `README.md`.

- [X] T038 [US6] Update `MemoryRuleManager.getActiveRules` to filter rules based on `filesInContext`
- [X] T039 [US6] Ensure `AIManager` passes current context files to `getActiveRules`
- [X] T040 [US6] Create unit tests for path-specific matching in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

---

## Phase 9: User Story 7 - Memory Rule Organization in Subdirectories (Priority: P2)

**Goal**: Support immediate subdirectories and symlinks in `.wave/rules/`.

**Independent Test**: Create `.wave/rules/subdir/rule.md` and a symlink, verify both are discovered.

- [X] T041 [US7] Update discovery logic in `MemoryRuleManager.ts` to include immediate subdirectories
- [X] T042 [US7] Implement symlink resolution and circularity detection in `MemoryRuleManager.ts`
- [X] T043 [US7] Create unit tests for subdirectory and symlink discovery in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

---

## Phase 10: User Story 8 - User-Level Modular Memory Rules (Priority: P2)

**Goal**: Load global memory rules from `~/.wave/rules/`.

**Independent Test**: Create `~/.wave/rules/global.md`, verify it's loaded in any project but overridden by project rules if applicable.

- [X] T044 [US8] Implement discovery of memory rules from `~/.wave/rules/` in `MemoryRuleManager.ts`
- [X] T045 [US8] Implement prioritization logic (project rules > user rules) in `MemoryRuleManager.ts`
- [X] T046 [US8] Create unit tests for user-level rules and prioritization in `packages/agent-sdk/tests/MemoryRuleManager.test.ts`

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T047 Implement error handling for malformed YAML frontmatter in `MemoryRuleService.ts`
- [X] T048 Create end-to-end integration tests in `packages/code/tests/MemoryRules.test.ts`
- [X] T049 Run `pnpm run type-check` and `pnpm run lint` across the workspace
---

## Phase 12: User Story 9 - Auto-Memory Background Extraction (Priority: P1)

**Goal**: Automatically extract and save memories using a background agent at the end of each turn.

**Independent Test**: Perform several turns of conversation, verify that `MEMORY.md` in the auto-memory directory is updated without user intervention.

- [X] T051 [US9] Create `ForkedAgentManager` to handle forked agent lifecycle independently from `BackgroundTaskManager` in `packages/agent-sdk/src/managers/forkedAgentManager.ts`
- [X] T052 [US9] Create `AutoMemoryService` to manage extraction lifecycle in `packages/agent-sdk/src/services/autoMemoryService.ts`
- [X] T053 [US9] Implement memory extraction prompt in `packages/agent-sdk/src/prompts/autoMemoryExtraction.ts`
- [X] T054 [US9] Integrate `AutoMemoryService` with `AIManager.executeStopHooks` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T055 [US9] Add `autoMemoryFrequency` configuration and resolution in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T056 [US9] Create unit tests for `AutoMemoryService` and `ForkedAgentManager`
