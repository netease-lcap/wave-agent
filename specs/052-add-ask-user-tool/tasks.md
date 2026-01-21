# Tasks: Support AskUserQuestion Tool

**Input**: Design documents from `/specs/052-add-ask-user-tool/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create tool implementation file in packages/agent-sdk/src/tools/askUserQuestion.ts
- [X] T002 [P] Create unit test file in packages/agent-sdk/tests/tools/askUserQuestion.test.ts
- [X] T003 [P] Create integration test file in packages/agent-sdk/tests/integration/askUserQuestion.integration.test.ts
- [X] T004 [P] Create UI test file in packages/code/tests/components/Confirmation.test.tsx

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Define Question and Option interfaces in packages/agent-sdk/src/types/permissions.ts per data-model.md
- [X] T006 Add AskUserQuestion to RESTRICTED_TOOLS in packages/agent-sdk/src/types/permissions.ts
- [X] T007 Register AskUserQuestion tool in packages/agent-sdk/src/managers/toolManager.ts
- [X] T008 Update Confirmation component props to accept AskUserQuestion data in packages/code/src/components/Confirmation.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Clarify Ambiguous Instructions (Priority: P1) 🎯 MVP

**Goal**: Enable the agent to ask clarifying questions using a structured multiple-choice interface.

**Independent Test**: Give the agent an ambiguous task (e.g., "Refactor this function") and verify it calls `AskUserQuestion` instead of guessing.

### Tests for User Story 1 (REQUIRED) ⚠️

- [X] T009 [P] [US1] Write failing unit test for AskUserQuestion tool execution in packages/agent-sdk/tests/tools/askUserQuestion.test.ts
- [X] T010 [P] [US1] Write failing integration test for ambiguity clarification flow in packages/agent-sdk/tests/integration/askUserQuestion.integration.test.ts

### Implementation for User Story 1

- [X] T011 [US1] Implement AskUserQuestion tool logic in packages/agent-sdk/src/tools/askUserQuestion.ts
- [X] T012 [US1] Implement basic multiple-choice UI in packages/code/src/components/Confirmation.tsx
- [X] T013 [US1] Implement keyboard navigation (arrows/numbers) for option selection in packages/code/src/components/Confirmation.tsx
- [X] T014 [US1] Implement "Other" option with text input in packages/code/src/components/Confirmation.tsx
- [X] T015 [US1] Update system prompt to encourage AskUserQuestion usage in packages/agent-sdk/src/managers/aiManager.ts

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Choose Between Implementation Approaches (Priority: P2)

**Goal**: Allow the agent to present multiple implementation approaches for user selection.

**Independent Test**: Ask the agent to "Add authentication" and verify it asks to choose between JWT, OAuth2, or Session-based auth.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T016 [P] [US2] Write unit test for multi-question support in packages/agent-sdk/tests/tools/askUserQuestion.test.ts
- [X] T017 [P] [US2] Write integration test for multi-approach selection in packages/agent-sdk/tests/integration/askUserQuestion.integration.test.ts

### Implementation for User Story 2

- [X] T018 [US2] Implement multi-question rendering (up to 4) in packages/code/src/components/Confirmation.tsx
- [X] T019 [US2] Implement multi-select support (checkboxes) in packages/code/src/components/Confirmation.tsx
- [X] T020 [US2] Implement "(Recommended)" label styling in packages/code/src/components/Confirmation.tsx

**Checkpoint**: User Stories 1 and 2 work independently.

---

## Phase 5: User Story 3 - Gather Requirements in Plan Mode (Priority: P2)

**Goal**: Enable requirement gathering during the planning phase.

**Independent Test**: Enter Plan Mode with a vague request and verify the agent asks questions before calling `ExitPlanMode`.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T021 [P] [US3] Write integration test for AskUserQuestion within Plan Mode in packages/agent-sdk/tests/integration/askUserQuestion.integration.test.ts

### Implementation for User Story 3

- [X] T022 [US3] Update Plan Mode instructions to allow AskUserQuestion but forbid it for plan approval in packages/agent-sdk/src/agent.ts
- [X] T023 [US3] Ensure AskUserQuestion is available and functional when permissionMode is 'plan' in packages/agent-sdk/src/managers/toolManager.ts
- [X] T028 [US3] Ensure AskUserQuestion is NOT available when permissionMode is 'bypassPermissions' in packages/agent-sdk/src/managers/toolManager.ts

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T024 [P] Add header chips (max 12 chars) with color coding to UI in packages/code/src/components/Confirmation.tsx
- [X] T025 [P] Ensure all answers are correctly mapped and returned in packages/agent-sdk/src/tools/askUserQuestion.ts
- [X] T026 [P] Run quickstart.md validation steps
- [X] T027 [P] Final type-check and linting across packages/agent-sdk and packages/code

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup.
- **User Stories (Phase 3+)**: Depend on Foundational. Can proceed in parallel.
- **Polish (Phase 6)**: Depends on all user stories.

### Parallel Opportunities

- T002, T003, T004 (Setup)
- T009, T010 (US1 Tests)
- T016, T017 (US2 Tests)
- T024, T025, T026, T027 (Polish)

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1
pnpm -F agent-sdk test tests/tools/askUserQuestion.test.ts
pnpm -F agent-sdk test tests/integration/askUserQuestion.integration.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (User Story 1).
3. **VALIDATE**: Run `pnpm -F agent-sdk test tests/tools/askUserQuestion.test.ts`.

### Incremental Delivery

1. Foundation ready.
2. Add US1 (Clarification) -> MVP.
3. Add US2 (Approaches/Multi-select).
4. Add US3 (Plan Mode integration).
