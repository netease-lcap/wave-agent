# Tasks: dontAsk Permission Mode

**Branch**: `072-dont-ask-permission-mode` | **Date**: 2026-03-18
**Input**: Design documents from `/specs/072-dont-ask-permission-mode/`

## Summary
Implement the `dontAsk` permission mode which auto-denies restricted tools not in `permissions.allow` or `temporaryRules`. This mode is enabled via configuration and is excluded from the "Shift+Tab" UI cycle.

## Phase 1: Setup
- [X] T001 Initialize task list in `specs/072-dont-ask-permission-mode/tasks.md`

## Phase 2: Foundational
- [X] T002 [P] Add `"dontAsk"` to `PermissionMode` union type in `packages/agent-sdk/src/types/permissions.ts`

## Phase 3: User Story 1 - Auto-deny unapproved tools (US1)
**Goal**: Restricted tools not in `permissions.allow` or `temporaryRules` are auto-denied in `dontAsk` mode.
**Independent Test**: Set `permissionMode` to `dontAsk`, call a restricted tool not in `allow` list, verify it's denied without a prompt.

- [X] T003 [P] [US1] Add unit tests for `dontAsk` mode in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T004 [US1] Implement `dontAsk` logic in `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T005 [US1] Verify `dontAsk` mode auto-denies restricted tools not in `permissions.allow` in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

## Phase 4: User Story 2 - Configure dontAsk mode (US2)
**Goal**: `dontAsk` mode can be set via configuration and informs the agent via system prompt.
**Independent Test**: Set `permissionMode: "dontAsk"` in `settings.json`, verify the agent receives the "user-selected permission mode" message in its system prompt.

- [X] T006 [P] [US2] Update `buildSystemPrompt` signature to accept `permissionMode` in `packages/agent-sdk/src/prompts/index.ts`
- [X] T007 [US2] Update `AIManager` to pass `permissionMode` to `buildSystemPrompt` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T008 [US2] Implement system prompt injection for `dontAsk` mode in `packages/agent-sdk/src/prompts/index.ts`
- [X] T009 [US2] Verify `permissionMode: "dontAsk"` in configuration correctly sets the mode and injects the prompt message

## Phase 5: Polish & UI Interaction
- [X] T010 [P] Update `cyclePermissionMode` in `packages/code/src/managers/inputHandlers.ts` to ensure `dontAsk` is excluded
- [X] T011 [P] Add tests for `cyclePermissionMode` in `packages/code/tests/managers/inputHandlers.test.ts`
- [X] T012 Run full test suite and verify coverage with `pnpm test:coverage`

## Dependencies
- T002 (Foundational) must be completed before T004 and T006.
- US1 (T003-T005) and US2 (T006-T009) can be developed in parallel after T002.
- Polish phase (T010-T012) should be completed after US1 and US2.

## Parallel Execution Examples
- **Story 1 (US1)**: T003 and T004 can be worked on in parallel if the interface is clear.
- **Story 2 (US2)**: T006 and T007 can be worked on in parallel.
- **Cross-Package**: T002 (agent-sdk) and T010 (code) can be worked on in parallel after T002 is built.

## Implementation Strategy
1. **MVP First**: Implement the core `dontAsk` logic in `PermissionManager` (US1).
2. **Incremental Delivery**: Add configuration support and system prompt injection (US2).
3. **Final Polish**: Ensure UI consistency by excluding the mode from the "Shift+Tab" cycle.
