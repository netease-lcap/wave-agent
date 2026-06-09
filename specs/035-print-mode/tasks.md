# Tasks: Print Mode

**Input**: Design documents from `/specs/035-print-mode/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Core Fix — Suppress Subagent Output

**Purpose**: Remove subagent output from print mode

- [X] T001 [US1] Remove `onSubagentUserMessageAdded` callback from `packages/code/src/print-cli.ts` — stops dumping subagent system prompts
- [X] T002 [US1] Remove `onSubagentAssistantMessageAdded`, `onSubagentAssistantReasoningUpdated`, `onSubagentAssistantContentUpdated` callbacks from `packages/code/src/print-cli.ts` — stops streaming subagent output
- [X] T003 [US1] Remove unused `subagentReasoningStates` and `subagentContentStates` Maps from `packages/code/src/print-cli.ts`

---

## Phase 2: User Story 1 — Clean Response-Only Output (Priority: P0)

**Goal**: Verify that `wave -p 'hi'` outputs only the main agent's response with no subagent noise.

**Independent Test**: Run `wave -p 'hi'` and verify no auto-memory extraction output appears.

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T004 [P] [US1] Integration test: `wave -p 'hi'` outputs only main agent content, no subagent prompts in `packages/code/tests/print-cli.test.ts`
- [ ] T005 [P] [US1] Integration test: `wave -p 'use the Agent tool'` outputs main agent response with tool indicator, no subagent content in `packages/code/tests/print-cli.test.ts`

---

## Phase 3: User Story 2 — Streaming Progress Indicators (Priority: P2)

**Goal**: Verify main agent reasoning, tool blocks, and errors are still displayed.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T006 [P] [US2] Unit test: reasoning header appears when main agent reasons in `packages/code/tests/print-cli.test.ts`
- [ ] T007 [P] [US2] Unit test: tool block indicator appears for main agent tool calls in `packages/code/tests/print-cli.test.ts`
- [ ] T008 [P] [US2] Unit test: error block is displayed in `packages/code/tests/print-cli.test.ts`

---

## Phase 4: User Story 3 — Claude Code Compatibility (Priority: P1)

**Goal**: Verify behavior matches `claude -p`.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T009 [US3] Manual comparison: `claude -p 'hi'` vs `wave -p 'hi'` — both show only main agent response, no subagent output

---

## Phase 5: Polish

- [ ] T010 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [ ] T011 Run `quickstart.md` validation scenarios manually

---

## Dependencies & Execution Order

### Phase Dependencies

- **Core Fix (Phase 1)**: No dependencies. Already implemented.
- **User Story 1 (Phase 2)**: Depends on Core Fix (Phase 1).
- **User Story 2 (Phase 3)**: Depends on Core Fix (Phase 1).
- **User Story 3 (Phase 4)**: Depends on Core Fix (Phase 1).
- **Polish (Phase 5)**: Depends on all user stories.

### Parallel Opportunities

- T004, T005 (US1 Tests)
- T006, T007, T008 (US2 Tests)
