# Tasks: Built-in Subagent Support

**Input**: Design documents from `/specs/025-builtin-subagent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No explicit test requests in feature specification - focusing on essential functionality testing only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo packages**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Following existing agent-sdk structure per plan.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create built-in subagent utility file structure in packages/agent-sdk/src/utils/builtinSubagents.ts
- [x] T002 [P] Setup test structure for built-in subagents in packages/agent-sdk/tests/utils/builtinSubagents.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement getBuiltinSubagents() function in packages/agent-sdk/src/utils/builtinSubagents.ts
- [x] T004 [P] Create "Explore" built-in subagent configuration with fastModel support in packages/agent-sdk/src/utils/builtinSubagents.ts
- [x] T005 Extend loadSubagentConfigurations() to include built-ins in packages/agent-sdk/src/utils/subagentParser.ts  
- [x] T006 [P] Add SubagentManager fastModel handling for "fastModel" model value in packages/agent-sdk/src/managers/subagentManager.ts
- [x] T007 Add essential tests for built-in loading in packages/agent-sdk/tests/utils/builtinSubagents.test.ts
- [x] T008 [P] Extend existing subagentParser tests in packages/agent-sdk/tests/utils/subagentParser.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic Subagent Access (Priority: P1) 🎯 MVP

**Goal**: Users can access pre-configured built-in subagents without needing configuration files

**Independent Test**: Call Task tool with "Explore" subagent type and verify successful execution with search results

### Implementation for User Story 1

- [x] T009 [US1] Update Task tool to list built-in subagents in available options in packages/agent-sdk/src/tools/taskTool.ts
- [x] T010 [US1] Add error handling for invalid subagent types to include built-ins in packages/agent-sdk/src/tools/taskTool.ts  
- [x] T011 [US1] Verify built-in subagents appear in SubagentManager configurations in packages/agent-sdk/src/managers/subagentManager.ts
- [x] T012 [US1] Test Task tool integration with "Explore" built-in subagent end-to-end

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Consistent Subagent Interface (Priority: P2)

**Goal**: Built-in subagents work identically to user-configured subagents with consistent behavior

**Independent Test**: Verify built-in subagents produce identical message structures and lifecycle as user subagents

### Implementation for User Story 2

- [ ] T013 [P] [US2] Ensure built-in subagents create identical SubagentBlock structures in packages/agent-sdk/src/managers/subagentManager.ts
- [ ] T014 [P] [US2] Verify virtual filePath handling for built-ins in packages/agent-sdk/src/utils/subagentParser.ts
- [ ] T015 [US2] Add priority system validation tests in packages/agent-sdk/tests/utils/subagentParser.test.ts
- [ ] T016 [US2] Test built-in vs user subagent consistency in packages/agent-sdk/tests/managers/subagentManager.test.ts
- [ ] T017 [US2] Validate tool filtering and model specification work identically

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T018 [P] Build agent-sdk package with pnpm build
- [ ] T019 [P] Run type checking with pnpm run type-check  
- [ ] T020 [P] Run linting with pnpm lint
- [ ] T021 Validate quickstart.md usage scenarios
- [ ] T022 Test error handling edge cases (missing tools, invalid configurations)

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
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Validates US1 but should be independently testable

### Within Each User Story

- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T002, T004, T006, T008 can run in parallel within their phases
- T013, T014 can run in parallel within User Story 2
- T018, T019, T020 can run in parallel during Polish phase
- Once Foundational phase completes, both user stories can start in parallel (if team capacity allows)

---

## Parallel Example: User Story 2

```bash
# Launch consistency validation tasks together:
Task: "Ensure built-in subagents create identical SubagentBlock structures in packages/agent-sdk/src/managers/subagentManager.ts"
Task: "Verify virtual filePath handling for built-ins in packages/agent-sdk/src/utils/subagentParser.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently with Task tool
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently with "Explore" subagent → Deploy/Demo (MVP!)
3. Add User Story 2 → Test consistency → Deploy/Demo
4. Each story adds value without breaking previous stories

### Key Validation Points

- **After T005**: Built-ins appear in loadSubagentConfigurations() output
- **After T009**: Task tool lists "Explore" in available subagents
- **After T012**: End-to-end Task tool execution with built-in subagent works
- **After T016**: Built-in and user subagents produce identical behavior

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability  
- Each user story should be independently completable and testable
- Must run pnpm build after agent-sdk changes (T018)
- Focus on essential functionality - comprehensive testing not required per constitution
- "fastModel" handling requires extending SubagentManager model resolution logic