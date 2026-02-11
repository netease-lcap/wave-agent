# Tasks: Task List Toggle

**Input**: Design documents from `/specs/064-task-list-toggle/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify existing project structure in `packages/code/src/`
- [x] T002 [P] Ensure `pnpm test` environment is ready in `packages/code`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T003 [P] Add `showTaskManager` state and `setShowTaskManager` setter to `InputManager` in `packages/code/src/managers/InputManager.ts`
- [x] T004 [P] Expose `showTaskManager` and `setShowTaskManager` via `useInputManager` hook in `packages/code/src/hooks/useInputManager.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Toggle Task List Visibility (Priority: P1) 🎯 MVP

**Goal**: Implement the Ctrl+T shortcut to toggle the task list visibility.

**Independent Test**: Press `Ctrl+T` in the CLI and verify the `showTaskManager` state toggles.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T005 [P] [US1] Add unit test for `Ctrl+T` shortcut handling in `packages/code/tests/managers/InputManager.test.ts`
- [x] T006 [P] [US1] Add unit test for `useInputManager` hook toggle logic in `packages/code/tests/hooks/useInputManager.test.ts`

### Implementation for User Story 1

- [x] T007 [US1] Implement `Ctrl+T` key handler in `handleNormalInput` within `packages/code/src/managers/InputManager.ts`
- [x] T008 [US1] Integrate `TaskManager` component into `packages/code/src/components/MessageList.tsx` using `showTaskManager` state
- [x] T009 [US1] Pass `onCancel` prop to `TaskManager` in `MessageList.tsx` to allow hiding via internal component actions

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Persistent Task List Display (Priority: P2)

**Goal**: Ensure the task list remains anchored at the bottom of the message list during updates.

**Independent Test**: Show the task list, send a message, and verify the task list stays at the bottom.

### Tests for User Story 2 (REQUIRED) ⚠️

- [ ] T010 [P] [US2] Add integration test for `MessageList` rendering with `TaskManager` in `packages/code/tests/components/MessageList.test.ts`

### Implementation for User Story 2

- [x] T011 [US2] Verify and adjust `Box` layout in `packages/code/src/components/MessageList.tsx` to ensure `TaskManager` is correctly anchored at the bottom

**Checkpoint**: User Story 2 is verified.

---

## Phase 5: User Story 3 - Task List Content (Priority: P3)

**Goal**: Ensure the task list displays up-to-date task information.

**Independent Test**: Create a task and verify it appears in the toggled task list.

### Tests for User Story 3 (REQUIRED) ⚠️

- [ ] T012 [P] [US3] Add unit test for `TaskManager` data binding with `ChatContext` in `packages/code/tests/components/TaskManager.test.ts`

### Implementation for User Story 3

- [x] T013 [US3] Ensure `TaskManager` in `packages/code/src/components/MessageList.tsx` correctly receives and renders tasks from `useChat` context
- [x] T014 [US3] Add "No tasks" message to `packages/code/src/components/TaskManager.tsx` if the task list is empty

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T015 [P] Run `pnpm run type-check` and `pnpm run lint` in `packages/code`
- [ ] T016 [P] Verify `pnpm test:coverage` in `packages/code`
- [ ] T017 [P] Validate `quickstart.md` instructions in the CLI

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup.
- **User Stories (Phase 3+)**: Depend on Foundational.
- **Polish (Final Phase)**: Depends on all user stories.

### User Story Dependencies

- **User Story 1 (P1)**: MVP - No dependencies on other stories.
- **User Story 2 (P2)**: Depends on US1 for visibility toggle.
- **User Story 3 (P3)**: Depends on US1 for visibility toggle.

### Parallel Opportunities

- T003 and T004 can run in parallel.
- T005 and T006 (tests) can run in parallel.
- T010 and T012 (tests) can run in parallel.
- Polish tasks T015, T016, T017 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1:
Task: "Add unit test for Ctrl+T shortcut handling in packages/code/tests/managers/InputManager.test.ts"
Task: "Add unit test for useInputManager hook toggle logic in packages/code/tests/hooks/useInputManager.test.ts"
```

---

## Implementation Strategy

### Task Delegation
- Use `typescript-expert` for `InputManager.ts` and `useInputManager.ts`.
- Use `vitest-expert` for all `.test.ts` files.
- Use `typescript-expert` for `MessageList.tsx` and `TaskManager.tsx`.

### MVP First (User Story 1 Only)
1. Complete Setup & Foundational.
2. Complete User Story 1 (Toggle logic).
3. **STOP and VALIDATE**: Verify `Ctrl+T` toggles the component.
