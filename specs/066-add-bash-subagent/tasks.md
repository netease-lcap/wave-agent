# Tasks: Add Bash Builtin Subagent

**Input**: Design documents from `/specs/066-add-bash-subagent/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Unit tests are REQUIRED for the new subagent registration.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Verify current branch is `066-add-bash-subagent`
- [x] T002 [P] Ensure `pnpm install` is run and environment is ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [x] T003 [P] Add `Bash` to `SubagentType` in `packages/agent-sdk/src/types.ts`
- [x] T004 [P] Define `BASH_SUBAGENT_SYSTEM_PROMPT` in `packages/agent-sdk/src/constants/prompts.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Execute Bash Commands via Subagent (Priority: P1) 🎯 MVP

**Goal**: Enable the main agent to delegate bash operations to a specialized "Bash" subagent.

**Independent Test**: Verify that `getBuiltinSubagents()` returns the "Bash" subagent configuration and that it correctly includes the bash tool and system prompt.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T005 [P] [US1] Create unit test for Bash subagent registration in `packages/agent-sdk/tests/utils/builtinSubagents.test.ts`

### Implementation for User Story 1

- [x] T006 [US1] Implement `createBashSubagent()` in `packages/agent-sdk/src/utils/builtinSubagents.ts`
- [x] T007 [US1] Register `createBashSubagent()` in `getBuiltinSubagents()` within `packages/agent-sdk/src/utils/builtinSubagents.ts`
- [x] T008 [US1] Build the SDK using `pnpm -F wave-agent-sdk build`
- [x] T009 [US1] Run tests using `pnpm -F wave-agent-sdk test` and verify coverage

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T010 [P] Run `pnpm run type-check` and `pnpm run lint` across the workspace
- [x] T011 [P] Validate `quickstart.md` instructions manually if possible
- [x] T012 [P] Final verification of `pnpm test:coverage` in `agent-sdk`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup.
- **User Story 1 (Phase 3)**: Depends on Foundational.
- **Polish (Final Phase)**: Depends on User Story 1.

### User Story Dependencies

- **User Story 1 (P1)**: MVP - No dependencies on other stories.

### Parallel Opportunities

- T001, T002 (Setup)
- T003, T004 (Foundational)
- T005 (Tests) can be prepared while T003/T004 are in progress.
- T010, T011, T012 (Polish)

---

## Parallel Example: User Story 1

```bash
# Prepare foundational elements
Task: "Add Bash to SubagentType in packages/agent-sdk/src/types.ts"
Task: "Define BASH_SUBAGENT_SYSTEM_PROMPT in packages/agent-sdk/src/constants/prompts.ts"
```

---

## Implementation Strategy

### Task Delegation (CRITICAL)
- Use `typescript-expert` for T003, T004, T006, T007.
- Use `vitest-expert` for T005, T009.

### MVP First (User Story 1 Only)
1. Complete Setup & Foundational.
2. Implement User Story 1.
3. Validate with tests.
