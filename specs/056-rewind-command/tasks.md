# Tasks: Rewind Command

**Input**: Design documents from `/specs/056-rewind-command/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create project structure and empty files per implementation plan
- [X] T002 [P] Define `FileSnapshot` and `Checkpoint` interfaces in `packages/agent-sdk/src/types/reversion.ts`
- [X] T003 [P] Add `reversionManager` and `messageId` to `ToolContext` in `packages/agent-sdk/src/tools/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement `ReversionManager` with atomic snapshot buffering in `packages/agent-sdk/src/managers/reversionManager.ts`
- [X] T005 [P] Implement `ReversionService` for directory-based versioned storage in `packages/agent-sdk/src/services/reversionService.ts`
- [X] T006 [P] Add `truncateHistory` method to `MessageManager` in `packages/agent-sdk/src/managers/messageManager.ts`
- [X] T007 [P] Register `/rewind` command in `packages/agent-sdk/src/managers/slashCommandManager.ts` (Note: Later refactored to be handled by `InputManager` in `packages/code`)
- [X] T008 [P] Unit tests for `ReversionManager` in `packages/agent-sdk/tests/managers/reversionManager.test.ts`
- [X] T009 [P] Unit tests for `ReversionService` in `packages/agent-sdk/tests/services/reversionService.test.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic Message Rewind (Priority: P1) 🎯 MVP

**Goal**: Allow users to revert conversation history to a previous user message checkpoint.

**Independent Test**: Send 3 messages, run `/rewind`, select the 2nd message, and verify history is truncated to that point.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T010 [P] [US1] Integration test for history truncation in `packages/agent-sdk/tests/integration/rewind_history.test.ts`
- [X] T011 [P] [US1] Unit test for `RewindCommand` UI component in `packages/code/tests/components/RewindCommand.test.ts`

### Implementation for User Story 1

- [X] T012 [US1] Implement `RewindCommand` Ink component for message selection in `packages/code/src/components/RewindCommand.tsx`
- [X] T013 [US1] Connect `/rewind` slash command to `RewindCommand` UI in `packages/code/src/index.tsx` (Note: Later refactored to use `InputManager` and `useInputManager` pattern)
- [X] T027 [US1] Refactor `/rewind` to use `InputManager` and `showRewindManager` pattern for consistency with `/bashes` and `/mcp`
- [X] T014 [US1] Implement history truncation logic in `MessageManager.truncateHistory` and update persistence

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Rewind with File Reversion (Priority: P2)

**Goal**: Automatically revert file changes made by the agent during the turns being rewound.

**Independent Test**: Agent creates a file, user rewinds to before the creation, verify file is deleted.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T015 [P] [US2] Integration test for file reversion (create/modify/delete) in `packages/agent-sdk/tests/integration/rewind_files.test.ts`
- [X] T016 [P] [US2] Unit tests for tool snapshotting in `packages/agent-sdk/tests/tools/reversion_hooks.test.ts`

### Implementation for User Story 2

- [X] T017 [US2] Update `WriteTool` to record snapshots in `packages/agent-sdk/src/tools/writeTool.ts`
- [X] T018 [US2] Update `EditTool` to record snapshots in `packages/agent-sdk/src/tools/editTool.ts`
- [X] T019 [US2] Update `MultiEditTool` to record snapshots in `packages/agent-sdk/src/tools/multiEditTool.ts`
- [X] T020 [US2] Update `DeleteFileTool` to record snapshots in `packages/agent-sdk/src/tools/deleteFileTool.ts`
- [X] T021 [US2] Implement sequential reverse rollback logic in `ReversionManager.revertTo`
- [X] T022 [US2] Integrate `reversionManager.revertTo` call into `MessageManager.truncateHistory`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T023 [P] Add progress indicators for file reversion in `RewindCommand.tsx`
- [X] T024 [P] Ensure `agent-sdk` is built and all packages are linked
- [X] T025 Run `pnpm run type-check` and `pnpm lint` across the monorepo
- [X] T026 Run `quickstart.md` validation scenarios manually

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (Phase 1).
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2).
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) and User Story 1 (Phase 3) for the trigger mechanism.
- **Polish (Final Phase)**: Depends on all user stories.

### Parallel Opportunities

- T002, T003 (Setup)
- T005, T006, T007, T008, T009 (Foundational)
- T010, T011 (US1 Tests)
- T015, T016 (US2 Tests)
- T017, T018, T019, T020 (Tool updates)

---

## Parallel Example: User Story 2 Tools

```bash
# Update all file tools in parallel:
Task: "Update WriteTool to record snapshots in packages/agent-sdk/src/tools/writeTool.ts"
Task: "Update EditTool to record snapshots in packages/agent-sdk/src/tools/editTool.ts"
Task: "Update MultiEditTool to record snapshots in packages/agent-sdk/src/tools/multiEditTool.ts"
Task: "Update DeleteFileTool to record snapshots in packages/agent-sdk/src/tools/deleteFileTool.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (Message Rewind).
3. **STOP and VALIDATE**: Verify history is correctly truncated.

### Incremental Delivery

1. Foundation ready (Phase 1 & 2).
2. Message Rewind (Phase 3) -> MVP.
3. File Reversion (Phase 4) -> Full Feature.
4. Polish (Phase 5).
