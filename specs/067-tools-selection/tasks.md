---
description: "Task list for tools selection implementation"
---

# Tasks: Tools Selection

**Input**: Design documents from `/specs/067-tools-selection/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

**Tests**: Both unit and integration tests are REQUIRED for all new functionality. Ensure tests are written and failing before implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Verify `agent-sdk` and `code` packages are buildable via `pnpm build`
- [x] T002 [P] Create test directory for new integration tests in `packages/agent-sdk/tests/integration/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Update `AgentOptions` interface to include `tools?: string[]` in `packages/agent-sdk/src/agent.ts`
- [x] T004 Update `ToolManagerOptions` interface to include `tools?: string[]` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T005 Update `Agent.create` to pass `tools` from options to `ToolManager` in `packages/agent-sdk/src/agent.ts`
- [x] T006 Update `CliOptions` interface to include `tools?: string[]` in `packages/code/src/cli.tsx`

**Checkpoint**: Foundation ready - SDK and CLI interfaces are updated to support tool selection.

---

## Phase 3: User Story 1 - Select Specific Tools (Priority: P1) 🎯 MVP

**Goal**: Allow users to limit the agent to a specific set of tools via `--tools "Read,Edit"`.

**Independent Test**: Run CLI with `--tools "Read,Edit"` and verify only those tools are available.

### Tests for User Story 1 (REQUIRED) ⚠️

- [x] T007 [P] [US1] Create unit test for `ToolManager` filtering logic in `packages/agent-sdk/tests/managers/toolManager.test.ts`
- [x] T008 [P] [US1] Create integration test for `Agent.create` with `tools` in `packages/agent-sdk/tests/integration/agent-tools.test.ts`

### Implementation for User Story 1

- [x] T009 [US1] Implement filtering logic in `ToolManager.initializeBuiltInTools` using `this.options.tools` in `packages/agent-sdk/src/managers/toolManager.ts`
- [x] T010 [US1] Add `--tools` option to `yargs` configuration in `packages/code/src/index.ts`
- [x] T011 [US1] Update `startCli` to handle the `tools` argument and pass it to `App` in `packages/code/src/cli.tsx`
- [x] T012 [US1] Update `App` component to pass `tools` prop to `ChatProvider` in `packages/code/src/App.tsx`
- [x] T013 [US1] Update `ChatProvider` to pass `tools` to `Agent.create` in `packages/code/src/contexts/useChat.tsx`

**Checkpoint**: User Story 1 is functional. Specific tools can be selected via CLI.

---

## Phase 4: User Story 2 - Disable All Tools (Priority: P2)

**Goal**: Disable all tools by providing an empty string to `--tools ""`.

**Independent Test**: Run CLI with `--tools ""` and verify no tools are available.

### Tests for User Story 2 (REQUIRED) ⚠️

- [x] T014 [P] [US2] Add test case to `toolManager.test.ts` for empty `tools` array `[]`.
- [x] T015 [P] [US2] Add integration test case for `--tools ""` in `packages/agent-sdk/tests/integration/agent-tools.test.ts`.

### Implementation for User Story 2

- [x] T016 [US2] Ensure `yargs` correctly parses `--tools ""` as an empty array or handle the empty string conversion in `packages/code/src/index.ts`.
- [x] T017 [US2] Verify `ToolManager` correctly handles `[]` by registering zero tools in `packages/agent-sdk/src/managers/toolManager.ts`.

**Checkpoint**: User Story 2 is functional. All tools can be disabled.

---

## Phase 5: User Story 4 - Print Mode Tool Selection (Priority: P2)

**Goal**: Support `--tools` flag with `--print` (or `-p`) option.

**Independent Test**: Run `wave --print --tools "Read" "prompt"` and verify tool restriction.

### Tests for User Story 5 (REQUIRED) ⚠️

- [x] T018 [P] [US4] Create integration test for `--print` option with `--tools` flag.

### Implementation for User Story 5

- [x] T019 [US4] Ensure `--tools` flag is correctly handled when `--print` is used in `packages/code/src/index.ts`.
- [x] T020 [US4] Pass `tools` from CLI options to the agent initialization logic in `packages/code/src/index.ts`.

**Checkpoint**: User Story 4 is functional. Print mode supports tool selection.

---

## Phase 6: User Story 3 - Use Default Tools (Priority: P3)

**Goal**: Explicitly request default tools using `"default"` or by omitting the flag.

**Independent Test**: Run CLI with `--tools "default"` and verify all standard tools are available.

### Tests for User Story 3 (REQUIRED) ⚠️

- [x] T021 [P] [US3] Add test case for `"default"` keyword in `packages/agent-sdk/tests/integration/agent-tools.test.ts`.

### Implementation for User Story 3

- [x] T022 [US3] Add logic in `packages/code/src/index.ts` to map `"default"` to `undefined` before passing to SDK.

**Checkpoint**: User Story 3 is functional. Default behavior is preserved and explicitly accessible.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T023 [P] Update `packages/agent-sdk/README.md` (if requested) or verify `quickstart.md` instructions.
- [x] T024 [P] Run `pnpm run type-check` across the monorepo.
- [x] T025 [P] Run `pnpm run lint` across the monorepo.
- [x] T026 [P] Run `pnpm test:coverage` and ensure no regressions.
- [x] T027 Final validation of `quickstart.md` scenarios.

---

## Phase 8: Refinement & Isolation (Post-MVP)

**Purpose**: Improve robustness and simplify AI invocation flow.

- [x] T028 [P] Remove `tools` argument from `AIManager.sendAIMessage` and rely on `ToolManager` as single source of truth.
- [x] T030 [P] Update `SubagentManager` to use `PermissionManager` for denying `Agent` tool instead of manual filtering.
- [x] T032 [P] Verify all tests pass after refactoring.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories.
- **User Stories (Phase 3-6)**: Depend on Foundational phase.
  - US1 (P1) is the MVP and should be completed first.
  - US2, US4, and US3 can follow.
- **Polish (Phase 7)**: Depends on all user stories.

### Parallel Opportunities

- T001, T002 (Setup)
- T007, T008 (US1 Tests)
- T014, T015 (US2 Tests)
- T018 (US4 Tests)
- T021 (US3 Tests)
- T023-T026 (Polish)

---

## Implementation Strategy

### Task Delegation (CRITICAL)
- Use `general-purpose` for SDK and CLI implementation (T003-T006, T009-T013, T016-T017, T019-T020, T022).
- Use `general-purpose` for all test tasks (T007, T008, T014, T015, T018, T021).
- Use `Explore` for verifying tool names and existing test patterns.

### MVP First (User Story 1 Only)
1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1).
3. Validate US1 independently.
ly.
