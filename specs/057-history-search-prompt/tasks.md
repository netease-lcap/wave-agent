# Tasks: History Search Prompt

**Input**: Design documents from `/specs/057-history-search-prompt/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 [P] Define `PromptEntry` type in `packages/agent-sdk/src/types.ts`
- [ ] T002 [P] Add `HISTORY_FILE` constant to `packages/agent-sdk/src/utils/constants.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 Create `PromptHistoryManager` class in `packages/agent-sdk/src/utils/promptHistory.ts`
- [ ] T004 [P] Export `PromptHistoryManager` from `packages/agent-sdk/src/index.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Search and Reuse Previous Prompts (Priority: P1) 🎯 MVP

**Goal**: Implement `Ctrl+R` search interface to find and reuse previous prompts from `~/.wave/history.jsonl`.

**Independent Test**: Press `Ctrl+R` in the input field, type a search term, select a prompt with arrow keys, and press Enter to populate the input field.

### Tests for User Story 1 (REQUIRED) ⚠️

- [ ] T005 [P] [US1] Unit tests for `PromptHistoryManager` (read/search) in `packages/agent-sdk/tests/utils/promptHistory.test.ts`
- [ ] T006 [P] [US1] Integration test for `HistorySearch` component in `packages/code/tests/components/HistorySearch.test.tsx`

### Implementation for User Story 1

- [ ] T007 [US1] Implement `getHistory` and `searchHistory` in `packages/agent-sdk/src/utils/promptHistory.ts`
- [ ] T008 [US1] Create `HistorySearch` component in `packages/code/src/components/HistorySearch.tsx`
- [ ] T009 [US1] Integrate `HistorySearch` into `packages/code/src/components/InputBox.tsx` and add `Ctrl+R` listener

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Migration from Bash History (Priority: P2)

**Goal**: Save new prompts to `~/.wave/history.jsonl` and remove bash history saving/selection.

**Independent Test**: Send a prompt and verify it's in `history.jsonl` but NOT in `bash-history.json`. Verify the old bash history selector is gone.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T010 [P] [US2] Unit tests for `PromptHistoryManager` (addEntry) in `packages/agent-sdk/tests/utils/promptHistory.test.ts`
- [ ] T011 [P] [US2] Integration test for prompt saving in `packages/code/tests/components/InputBox.test.tsx`

### Implementation for User Story 2

- [ ] T012 [US2] Implement `addEntry` in `packages/agent-sdk/src/utils/promptHistory.ts`
- [ ] T013 [US2] Update `packages/code/src/components/InputBox.tsx` to save prompts using `PromptHistoryManager`
- [ ] T014 [US2] Remove `BashHistorySelector` usage and related bash history logic from `packages/code/src/components/InputBox.tsx`
- [ ] T015 [US2] Remove `BashHistorySelector.tsx` from `packages/code/src/components/`
- [ ] T016 [US2] Deprecate or remove bash history utilities in `packages/agent-sdk/src/utils/bashHistory.ts` if unused

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T017 [P] Run `pnpm build` in `packages/agent-sdk` to ensure changes propagate
- [ ] T018 [P] Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [ ] T019 [P] Verify `quickstart.md` validation scenarios
- [ ] T020 [P] Final manual verification of `~/.wave/history.jsonl` format and `Ctrl+R` behavior

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Can start after Foundational (Phase 2). While it removes the old selector, it can be implemented in parallel with US1's new selector.

### Parallel Opportunities

- T001, T002 (Setup)
- T005, T006 (US1 Tests)
- T010, T011 (US2 Tests)
- T017-T020 (Polish)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit tests for PromptHistoryManager (read/search) in packages/agent-sdk/tests/utils/promptHistory.test.ts"
Task: "Integration test for HistorySearch component in packages/code/tests/components/HistorySearch.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently (Ctrl+R search)

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently → Migration complete
