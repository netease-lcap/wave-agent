# Tasks: Slash Command Allowed Tools

**Input**: Design documents from `/home/liuyiqi/personal-projects/wave-agent/specs/048-slash-command-allowed-tools/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Tests are explicitly requested in the implementation plan (Phase 3: Testing & Validation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Update `CustomSlashCommandConfig` interface to include `allowedTools?: string[]` in `packages/agent-sdk/src/types/commands.ts`
- [X] T002 [P] Update `parseFrontmatter` to support array parsing for `allowed-tools` in `packages/agent-sdk/src/utils/markdownParser.ts`
- [X] T003 [P] Update `parseMarkdownFile` to map `allowed-tools` from frontmatter to `config.allowedTools` in `packages/agent-sdk/src/utils/markdownParser.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Add `temporaryRules` private property and `addTemporaryRules`/`clearTemporaryRules` public methods to `PermissionManager` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T005 Update `isAllowedByRule` in `PermissionManager` to check both `allowedRules` and `temporaryRules` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T006 Update `AIManagerOptions` to include `permissionManager: PermissionManager` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T007 Update `Agent` constructor to pass `permissionManager` to `AIManager` in `packages/agent-sdk/src/agent.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Auto-approved Tool Execution (Priority: P1) 🎯 MVP

**Goal**: Enable automatic tool execution for tools listed in a slash command's `allowed-tools` metadata.

**Independent Test**: Trigger a slash command with `allowed-tools` and verify that the AI executes those tools without prompting for confirmation.

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T008 [P] [US1] Unit test for `PermissionManager.addTemporaryRules` and `isAllowedByRule` in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T009 [P] [US1] Integration test for `AIManager` with temporary permissions in `packages/agent-sdk/tests/managers/aiManager.test.ts`

### Implementation for User Story 1

- [X] T010 [US1] Update `sendAIMessage` in `AIManager` to accept `allowedTools?: string[]` in options in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T011 [US1] Implement logic in `sendAIMessage` to call `permissionManager.addTemporaryRules` when `recursionDepth === 0` in `packages/agent-sdk/src/managers/aiManager.ts`
- [X] T012 [US1] Update `executeCustomCommandInMainAgent` in `SlashCommandManager` to pass `config.allowedTools` to `aiManager.sendAIMessage` in `packages/agent-sdk/src/managers/slashCommandManager.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Session Termination (Priority: P2)

**Goal**: Ensure that temporary permissions are revoked once the AI response cycle (recursion) completes.

**Independent Test**: Verify that after a slash command finishes, subsequent tool calls (even for the same tools) require manual confirmation.

### Tests for User Story 2

- [X] T013 [P] [US2] Unit test for `PermissionManager.clearTemporaryRules` in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T014 [P] [US2] Integration test verifying permission revocation after `sendAIMessage` returns in `packages/agent-sdk/tests/managers/aiManager.test.ts`

### Implementation for User Story 2

- [X] T015 [US2] Implement `finally` block logic in `sendAIMessage` to call `permissionManager.clearTemporaryRules` when `recursionDepth === 0` in `packages/agent-sdk/src/managers/aiManager.ts`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T016 [P] Run `pnpm run type-check` and `pnpm lint` across `agent-sdk`
- [X] T017 [P] Verify `quickstart.md` scenarios manually with a sample slash command
- [X] T018 [P] Ensure no `allowed-tools` are persisted to `settings.json` during execution

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2).
- **User Story 2 (P2)**: Can start after Foundational (Phase 2), but logically follows US1 as it handles the cleanup of US1's state.

### Parallel Opportunities

- T002 and T003 can run in parallel.
- T004 and T005 can run in parallel.
- T008 and T009 (tests) can run in parallel.
- T013 and T014 (tests) can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1 together:
Task: "Unit test for PermissionManager.addTemporaryRules and isAllowedByRule in packages/agent-sdk/tests/managers/permissionManager.test.ts"
Task: "Integration test for AIManager with temporary permissions in packages/agent-sdk/tests/managers/aiManager.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready.
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!).
3. Add User Story 2 → Test independently → Deploy/Demo.
