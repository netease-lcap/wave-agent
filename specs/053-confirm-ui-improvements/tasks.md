# Tasks: Confirm Component UI Improvements

**Input**: Design documents from `/specs/053-confirm-ui-improvements/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, quickstart.md

**Tests**: Unit tests are REQUIRED for this feature to verify the border configuration of the `Confirmation` component and its sub-components.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Verify existing project structure in `packages/code/src/components`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T002 [P] Research Ink `Box` component border properties for top-only configuration

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Minimalist Confirm Component (Priority: P1) 🎯 MVP

**Goal**: Modify the `Confirmation` component to only display a top border and remove border from plan content.

**Independent Test**: Render the `Confirmation` component and verify that only the top border is visible for the main component and no border for plan content.

### Tests for User Story 1 (REQUIRED) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T003 [P] [US1] Create unit test for `Confirmation` component in `packages/code/tests/components/Confirmation.test.tsx` to verify border configuration
- [x] T009 [P] [US1] Update unit test in `packages/code/tests/components/Confirmation.border.test.tsx` to verify plan content has no border or horizontal padding and is rendered as Markdown

### Implementation for User Story 1

- [x] T004 [US1] Modify `Confirmation` component in `packages/code/src/components/Confirmation.tsx` to set `borderBottom={false}`, `borderLeft={false}`, and `borderRight={false}` on the main `Box`
- [x] T005 [US1] Ensure internal padding is maintained in `packages/code/src/components/Confirmation.tsx` for legibility
- [x] T010 [US1] Remove border and horizontal padding from plan content `Box` in `packages/code/src/components/Confirmation.tsx` and use `Markdown` component for rendering

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T006 [P] Run `pnpm run type-check` in `packages/code`
- [x] T007 [P] Run `pnpm lint` in `packages/code`
- [x] T008 [P] Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion
- **Polish (Final Phase)**: Depends on User Story 1 completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001, T002, T003 can potentially run in parallel as they involve different files or research.
- Polish tasks (T006, T007, T008) can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch tests and research together:
Task: "Create unit test for Confirmation component in packages/code/tests/components/Confirmation.test.tsx"
Task: "Research Ink Box component border properties for top-only configuration"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
