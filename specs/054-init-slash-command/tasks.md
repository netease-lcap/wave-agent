# Tasks: Init Slash Command

**Input**: Design documents from `/specs/054-init-slash-command/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Single project**: `packages/agent-sdk/src/`, `packages/agent-sdk/tests/`
- Paths shown below assume `packages/agent-sdk/` as the base directory.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Define `INIT_PROMPT` constant in `packages/agent-sdk/src/constants/prompts.ts`
- [X] T002 [P] Add `init` to `SlashCommand` type or enum if applicable in `packages/agent-sdk/src/types/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Implement basic registration for `init` command in `packages/agent-sdk/src/managers/slashCommandManager.ts` (no-op handler)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Initialize Repository for Agents (Priority: P1) 🎯 MVP

**Goal**: Automatically analyze the codebase and generate an `AGENTS.md` file.

**Independent Test**: Run `/init` in a repo and verify `AGENTS.md` is created with correct content.

### Tests for User Story 1 (REQUIRED) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] [US1] Unit test for `INIT_PROMPT` content in `packages/agent-sdk/tests/constants/prompts.test.ts`
- [X] T005 [US1] Integration test for `/init` command execution in `packages/agent-sdk/tests/managers/slashCommandManager.test.ts`

### Implementation for User Story 1

- [X] T006 [US1] Implement `init` command handler in `packages/agent-sdk/src/managers/slashCommandManager.ts` to trigger AI with `INIT_PROMPT`
- [X] T007 [US1] Ensure `AGENTS.md` prefix is correctly handled in the prompt or post-processing in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T008 [US1] Implement logic to suggest improvements if `AGENTS.md` already exists in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T009 [US1] Add logic to incorporate rules from `.cursorrules`, etc., into the analysis prompt in `packages/agent-sdk/src/managers/slashCommandManager.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Discoverability of the Init Command (Priority: P2)

**Goal**: Ensure `/init` is visible in command completion and help.

**Independent Test**: Type `/` in the CLI and verify `/init` is listed.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T010 [US2] Unit test to verify `init` is returned in `getCommands()` in `packages/agent-sdk/tests/managers/slashCommandManager.test.ts`

### Implementation for User Story 2

- [X] T011 [US2] Add description and metadata for `init` command in `packages/agent-sdk/src/managers/slashCommandManager.ts`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T012 [P] Update `packages/agent-sdk/README.md` (if exists) with `/init` command info
- [X] T013 Code cleanup and refactoring in `packages/agent-sdk/src/managers/slashCommandManager.ts`
- [X] T014 Run `pnpm run type-check` and `pnpm lint` in `packages/agent-sdk/`
- [X] T015 [P] Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent of US1 implementation but shares the same file.

### Parallel Opportunities

- T001 and T002 can run in parallel.
- T004 and T005 can run in parallel (once T001/T003 are done).
- Once US1 is done, US2 is trivial.

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1 together:
Task: "Unit test for INIT_PROMPT content in packages/agent-sdk/tests/constants/prompts.test.ts"
Task: "Integration test for /init command execution in packages/agent-sdk/tests/managers/slashCommandManager.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → MVP!
3. Add User Story 2 → Test independently
