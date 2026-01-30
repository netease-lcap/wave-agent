# Tasks: Set Language Setting

**Input**: Design documents from `/specs/055-set-language-setting/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Update `WaveConfiguration` interface to include `language?: string` in `packages/agent-sdk/src/types/configuration.ts`
- [X] T002 Update `AgentOptions` interface to include `language?: string` in `packages/agent-sdk/src/agent.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Implement `resolveLanguage(constructorLanguage?: string): string | undefined` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T004 [P] Add `getLanguage(): string | undefined` getter to `Agent` class in `packages/agent-sdk/src/agent.ts`
- [X] T005 [P] Update `AIManagerOptions` and `AIManager` constructor to accept `getLanguage: () => string | undefined` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T006 Update `Agent` constructor to pass `getLanguage` getter to `AIManager` in `packages/agent-sdk/src/agent.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Configure Preferred Language (Priority: P1) 🎯 MVP

**Goal**: Support setting language via `AgentOptions` or `settings.json` and injecting it into the system prompt.

**Independent Test**: Set `language: "Chinese"` in `Agent.create()` or `settings.json` and verify the system prompt contains the language instruction.

### Tests for User Story 1 (REQUIRED) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T007 [P] [US1] Unit test for language resolution in `packages/agent-sdk/tests/services/configurationService.test.ts`
- [X] T008 [P] [US1] Integration test for prompt injection in `packages/agent-sdk/tests/managers/aiManager.test.ts`

### Implementation for User Story 1

- [X] T009 [US1] Implement language instruction injection in `AIManager.sendAIMessage` within `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T010 [US1] Update `Agent.resolveAndValidateConfig` to handle language if needed in `packages/agent-sdk/src/agent.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Default Language Behavior (Priority: P2)

**Goal**: Ensure no language instruction is added if no language is configured.

**Independent Test**: Create an agent without any language configuration and verify the system prompt does NOT contain the language instruction.

### Tests for User Story 2 (REQUIRED) ⚠️

- [X] T011 [P] [US2] Unit test for `undefined` language resolution in `packages/agent-sdk/tests/services/configurationService.test.ts`
- [X] T012 [P] [US2] Integration test for absence of language prompt in `packages/agent-sdk/tests/managers/aiManager.test.ts`

### Implementation for User Story 2

- [X] T013 [US2] Verify `AIManager` correctly handles `undefined` language by not adding the prompt block in `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: User Story 3 - Preservation of Technical Terms (Priority: P2)

**Goal**: Ensure the injected prompt explicitly instructs the AI to preserve technical terms.

**Independent Test**: Verify the injected prompt string matches the required format exactly.

### Tests for User Story 3 (REQUIRED) ⚠️

- [X] T014 [P] [US3] Integration test to verify the exact content of the language instruction in `packages/agent-sdk/tests/managers/aiManager.test.ts`

### Implementation for User Story 3

- [X] T015 [US3] Ensure the prompt template in `AIManager.ts` matches the spec exactly in `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: All user stories should now be independently functional.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T016 [P] Run `pnpm build` in `packages/agent-sdk`
- [X] T017 [P] Run `pnpm run type-check` and `pnpm lint` across the workspace
- [X] T018 [P] Run all tests in `packages/agent-sdk` to ensure no regressions
- [ ] T019 [P] Validate `quickstart.md` scenarios manually if possible

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2)
- **User Story 2 (P2)**: Can start after Foundational (Phase 2)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2)

### Parallel Opportunities

- T003, T004, T005 can run in parallel.
- All test tasks marked [P] can run in parallel.
- Once Phase 2 is done, US1, US2, and US3 can technically be worked on in parallel as they mostly touch the same logic but different aspects of it.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for language resolution in packages/agent-sdk/tests/services/configurationService.test.ts"
Task: "Integration test for prompt injection in packages/agent-sdk/tests/managers/aiManager.test.ts"
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
3. Add User Story 2 & 3 → Test independently
