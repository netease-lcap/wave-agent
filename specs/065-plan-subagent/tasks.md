# Tasks: Plan Subagent Support

**Input**: Design documents from `/specs/065-plan-subagent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md

**Tests**: Tests are included as they are essential for verifying the Plan subagent functionality and read-only restrictions.

**Organization**: Tasks are grouped by implementation phase to enable systematic development and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: System Prompt Definition

**Purpose**: Define the Plan subagent system prompt with read-only restrictions and planning guidance

- [X] T001 [P] [US1,US2] Define `PLAN_SUBAGENT_SYSTEM_PROMPT` constant in `packages/agent-sdk/src/constants/prompts.ts`
- [X] T002 [P] [US2] Include critical read-only restrictions section in system prompt
- [X] T003 [P] [US1,US4] Include process workflow and output format requirements in system prompt

**Checkpoint**: System prompt complete with all required sections

---

## Phase 2: Subagent Definition

**Purpose**: Create Plan subagent configuration and register it as a built-in subagent

- [X] T004 [US1] Implement `createPlanSubagent()` function in `packages/agent-sdk/src/utils/builtinSubagents.ts`
- [X] T005 [US1,US2] Configure Plan subagent with read-only tools: ["Glob", "Grep", "Read", "Bash", "LS", "LSP"]
- [X] T006 [US1] Set model to "inherit" to use parent agent's model
- [X] T007 [US1] Set scope to "builtin" and priority to 3
- [X] T008 [US1] Add Plan subagent to `getBuiltinSubagents()` array

**Checkpoint**: Plan subagent registered and available in system

---

## Phase 3: Unit Testing

**Purpose**: Verify Plan subagent configuration and behavior through unit tests

- [X] T009 [P] [US1] Add test for Plan subagent loading in `packages/agent-sdk/tests/utils/builtinSubagents.test.ts`
- [X] T010 [P] [US2] Add test verifying read-only tool configuration
- [X] T011 [P] [US1] Add test verifying system prompt includes critical sections
- [X] T012 [P] [US1] Add test verifying "inherit" model setting
- [X] T013 [P] [US1] Add test verifying scope is "builtin" and priority is 3
- [X] T014 [P] [US2] Add test verifying Write, Edit, NotebookEdit tools are not included

**Checkpoint**: All unit tests pass

---

## Phase 4: Integration Testing

**Purpose**: Verify Plan subagent works correctly in real usage scenarios

- [X] T015 [US1] Test spawning Plan subagent via Task tool
- [X] T016 [US2] Test read-only enforcement (attempt Write/Edit operations)
- [X] T017 [US3] Test spawning multiple Plan subagents in parallel
- [X] T018 [US4] Test Plan subagent output includes critical files section
- [X] T019 [US1] Test Plan subagent can explore codebase with read-only tools

**Checkpoint**: All integration tests pass

---

## Phase 5: Documentation

**Purpose**: Document the new Plan subagent for users and developers

- [X] T020 [P] Update `AGENTS.md` to mention Plan subagent
- [X] T021 [P] Update `packages/agent-sdk/README.md` to list Plan in built-in subagents
- [X] T022 [P] Update root `README.md` to mention Plan subagent
- [X] T023 [P] Create `specs/065-plan-subagent/quickstart.md` with usage examples

**Checkpoint**: Documentation complete

---

## Phase 6: Quality Gates

**Purpose**: Ensure code quality and consistency

- [X] T024 [P] Run `pnpm run type-check` across the monorepo
- [X] T025 [P] Run `pnpm run lint` across the monorepo
- [X] T026 [P] Run `pnpm test` to verify all tests pass
- [X] T027 Validate feature using `specs/065-plan-subagent/quickstart.md` scenarios

**Checkpoint**: All quality gates pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (System Prompt)**: No dependencies - can start immediately
- **Phase 2 (Subagent Definition)**: Depends on Phase 1 completion
- **Phase 3 (Unit Testing)**: Depends on Phase 2 completion
- **Phase 4 (Integration Testing)**: Depends on Phase 3 completion
- **Phase 5 (Documentation)**: Can run in parallel with Phase 3 and 4
- **Phase 6 (Quality Gates)**: Depends on all previous phases

### User Story Dependencies

- **User Story 1 (Plan Mode with Built-in Plan Subagent)**: T001, T003, T004, T006, T007, T008, T009, T011, T012, T013, T015, T019
- **User Story 2 (Read-Only Tool Restrictions)**: T001, T002, T005, T010, T014, T016
- **User Story 3 (Multiple Planning Perspectives)**: T017
- **User Story 4 (Critical Files Identification)**: T003, T018

### Parallel Opportunities

- T001, T002, T003 can run in parallel (different sections of same file)
- T009, T010, T011, T012, T013, T014 can run in parallel (different test cases)
- T020, T021, T022, T023 can run in parallel (different files)
- T024, T025, T026 can run in parallel (different commands)

---

## Implementation Strategy

### MVP First (User Story 1 & 2)

1. Complete Phase 1: System Prompt (T001-T003)
2. Complete Phase 2: Subagent Definition (T004-T008)
3. Complete Phase 3: Unit Testing (T009-T014)
4. **STOP and VALIDATE**: Test the core Plan subagent functionality

### Incremental Delivery

1. System Prompt complete -> Test
2. Subagent Definition complete -> Test
3. Unit Tests complete -> Validate
4. Integration Tests complete -> Validate
5. Documentation complete
6. Quality Gates pass -> Ship

---

## Notes

- [P] tasks = different files or independent test cases, no dependencies
- [Story] label maps task to specific user story for traceability
- Each phase can be validated independently before moving to next
- Commit after each phase completion
- Plan subagent follows the exact pattern of Explore built-in subagent
