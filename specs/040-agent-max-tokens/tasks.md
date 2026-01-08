# Tasks: Configurable Max Output Tokens for Agent

**Input**: Design documents from `/specs/040-agent-max-tokens/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Update `AgentOptions` interface in `packages/agent-sdk/src/agent.ts` to include `maxTokens?: number`
- [X] T002 [P] Update `CallAgentOptions` interface in `packages/agent-sdk/src/types.ts` to include `maxTokens?: number`
- [X] T003 [P] Update `ModelConfig` interface in `packages/agent-sdk/src/types.ts` to include `maxTokens?: number`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T004 Update `ConfigurationService` in `packages/agent-sdk/src/services/configurationService.ts` to read `WAVE_MAX_OUTPUT_TOKENS` environment variable
- [X] T005 Update `Agent` class in `packages/agent-sdk/src/agent.ts` to handle `maxTokens` in constructor and provide a getter
- [X] T006 Update `AIManager` in `packages/agent-sdk/src/managers/aiManager.ts` to resolve `maxTokens` with correct precedence and pass it to `aiService`
- [X] T007 Update `callAgent` in `packages/agent-sdk/src/services/aiService.ts` to use `maxTokens` from options when calling OpenAI

---

## Phase 3: User Story 1 - Default Token Limit (Priority: P1) 🎯 MVP

**Goal**: Ensure the agent uses a default limit of 4096 tokens when no configuration is provided.

**Independent Test**: Create an agent without any token configuration and verify that the AI service call uses 4096.

### Tests for User Story 1
- [X] T008 [P] [US1] Create unit test in `packages/agent-sdk/tests/services/aiService.test.ts` to verify default `maxTokens` is 4096

### Implementation for User Story 1
- [X] T009 [US1] Implement default value logic in `packages/agent-sdk/src/services/configurationService.ts` or `packages/agent-sdk/src/aiManager.ts`

---

## Phase 4: User Story 2 - Environment Variable Configuration (Priority: P2)

**Goal**: Allow setting the global token limit via `WAVE_MAX_OUTPUT_TOKENS`.

**Independent Test**: Set `WAVE_MAX_OUTPUT_TOKENS=2048` and verify the agent uses this value.

### Tests for User Story 2
- [X] T010 [P] [US2] Create unit test in `packages/agent-sdk/tests/services/aiService.test.ts` to verify `WAVE_MAX_OUTPUT_TOKENS` is respected

### Implementation for User Story 2
- [X] T011 [US2] Ensure `ConfigurationService` correctly parses and returns `WAVE_MAX_OUTPUT_TOKENS` in `packages/agent-sdk/src/services/configurationService.ts`

---

## Phase 5: User Story 3 - Agent Creation Options (Priority: P2)

**Goal**: Allow specifying `maxTokens` during agent creation.

**Independent Test**: Create an agent with `maxTokens: 1024` and verify it overrides the environment variable and default.

### Tests for User Story 3
- [X] T012 [P] [US3] Create unit test in `packages/agent-sdk/tests/services/aiService.test.ts` to verify `Agent.create` options override environment variables

### Implementation for User Story 3
- [X] T013 [US3] Update `Agent` and `AIManager` to correctly prioritize `AgentOptions.maxTokens`

---

## Phase 6: User Story 4 - Direct Call Override (Priority: P3)

**Goal**: Allow overriding `maxTokens` for a specific `callAgent` invocation.

**Independent Test**: Call `agent.callAgent` with `maxTokens: 512` and verify it takes precedence over all other settings.

### Tests for User Story 4
- [X] T014 [P] [US4] Create unit test in `packages/agent-sdk/tests/services/aiService.test.ts` to verify `callAgent` options have highest precedence

### Implementation for User Story 4
- [X] T015 [US4] Update `AIManager.callAgent` to merge call-specific `maxTokens` into the final request

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T016 [P] Add validation for `maxTokens` (must be positive integer) in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T017 [P] Run `pnpm build` in `packages/agent-sdk` to ensure changes are propagated
- [X] T018 [P] Run `pnpm run type-check` and `pnpm lint` in `packages/agent-sdk`
- [X] T019 [P] Verify all tests pass with `pnpm test` in `packages/agent-sdk`

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup (T001-T003).
- **User Stories (Phases 3-6)**: Depend on Foundational (T004-T007).
- **Polish (Phase 7)**: Depends on all user stories.

### Parallel Opportunities
- T001, T002, T003 can run in parallel.
- T008, T010, T012, T014 (tests) can be developed in parallel once interfaces are ready.
- T016, T017, T018, T019 can run in parallel at the end.

---

## Parallel Example: User Story 1
```bash
# Run tests for User Story 1
pnpm -F agent-sdk test tests/services/aiService.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Setup (Phase 1).
2. Complete Foundational (Phase 2).
3. Complete User Story 1 (Phase 3).
4. Validate with tests.
