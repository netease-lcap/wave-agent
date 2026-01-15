---
description: "Task list for implementing permissions.deny support"
---

# Tasks: Support permissions.deny in settings.json

**Input**: Design documents from `/specs/049-deny-permissions-support/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Tests are included as they are essential for verifying security-critical permission logic.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 [P] Update `WaveConfiguration` interface to include `permissions.deny` in `packages/agent-sdk/src/types/configuration.ts`
- [X] T002 [P] Update `PermissionManagerOptions` interface to include `deniedRules` in `packages/agent-sdk/src/types/permissions.ts`
- [X] T003 [P] Verify `minimatch` is correctly imported and used in `packages/agent-sdk/src/managers/permissionManager.ts` (it is already a dependency)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Update `ConfigurationService.validateConfiguration` to validate `permissions.deny` as an array of strings in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T005 Update `loadMergedWaveConfig` to merge `permissions.deny` rules from all sources in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T006 Implement private `matchesRule(context, rule)` helper in `PermissionManager` using `minimatch` for path patterns in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T007 Update `PermissionManager.checkPermission` to check `deniedRules` at the very beginning (before bypass check) in `packages/agent-sdk/src/managers/permissionManager.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Deny specific tool access (Priority: P1) 🎯 MVP

**Goal**: Allow users to explicitly forbid the agent from using certain tools (e.g., Bash, Write).

**Independent Test**: Add "Bash" to `permissions.deny` and verify that any bash command is blocked with a clear error message.

### Tests for User Story 1

- [X] T008 [P] [US1] Add unit tests for tool-level denial in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T009 [P] [US1] Add integration test for tool denial in `packages/agent-sdk/tests/services/configurationService.test.ts`

### Implementation for User Story 1

- [X] T010 [US1] Ensure `matchesRule` correctly handles simple tool name matches (e.g., "Bash") in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T011 [US1] Verify `checkPermission` returns informative error message for denied tools in `packages/agent-sdk/src/managers/permissionManager.ts`

**Checkpoint**: User Story 1 is fully functional. Tools can be explicitly denied.

---

## Phase 4: User Story 2 - Deny access to specific file paths (Priority: P1)

**Goal**: Prevent the agent from accessing specific directories or files using `ToolName(path_pattern)` rules.

**Independent Test**: Add `Read(**/.env)` to `permissions.deny` and verify that `Read` tool is blocked when accessing any `.env` file.

### Tests for User Story 2

- [X] T012 [P] [US2] Add unit tests for path-based denial (e.g., `Read(**/*.env)`) in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T013 [P] [US2] Add unit tests for bash command prefix denial (e.g., `Bash(rm:*)`) in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

### Implementation for User Story 2

- [X] T014 [US2] Update `matchesRule` to handle `ToolName(pattern)` format and extract paths from `toolInput` in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T015 [US2] Update `Read` tool to call `checkPermission` in `packages/agent-sdk/src/tools/readTool.ts`
- [X] T016 [US2] Update `LS` tool to call `checkPermission` in `packages/agent-sdk/src/tools/lsTool.ts`
- [X] T017 [US2] Ensure `matchesRule` correctly handles `Bash(prefix:*)` rules in `packages/agent-sdk/src/managers/permissionManager.ts`

**Checkpoint**: User Story 2 is functional. Granular path and command denial is supported.

---

## Phase 5: User Story 3 - Precedence of Deny over Allow (Priority: P2)

**Goal**: Ensure `deny` rules always win over `allow` rules and auto-accept modes.

**Independent Test**: Add `Bash` to both `allow` and `deny` and verify it is denied.

### Tests for User Story 3

- [X] T018 [P] [US3] Add unit tests for deny-over-allow precedence in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T019 [P] [US3] Add unit tests for deny-over-acceptEdits precedence in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

### Implementation for User Story 3

- [X] T020 [US3] Verify `checkPermission` logic correctly prioritizes `deniedRules` check in `packages/agent-sdk/src/managers/permissionManager.ts`

**Checkpoint**: Security model is robust. Deny rules cannot be bypassed.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup

- [X] T021 [P] Run `pnpm build` in `packages/agent-sdk`
- [X] T022 [P] Run `pnpm run type-check` and `pnpm run lint` in workspace root
- [X] T023 [P] Verify `quickstart.md` examples work as expected
- [X] T024 [P] Ensure all restricted tools (`Write`, `Delete`, `Edit`, `MultiEdit`) correctly handle the new deny logic

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Phase 1.
- **User Stories (Phase 3-5)**: Depend on Phase 2. Can proceed in parallel.
- **Polish (Phase 6)**: Depends on all user stories.

### User Story Dependencies

- **US1 (P1)**: MVP.
- **US2 (P1)**: High priority for data safety.
- **US3 (P2)**: Ensures consistency.

### Parallel Opportunities

- T001, T002, T003 can run in parallel.
- Once Phase 2 is done, US1, US2, and US3 tests and implementations can proceed in parallel.
- T021-T024 can run in parallel.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & 2.
2. Complete Phase 3 (US1).
3. Validate that tool-level denial works.

### Incremental Delivery

1. Foundation ready.
2. Add tool denial (US1).
3. Add path/command denial (US2).
4. Verify precedence (US3).
5. Final polish.

---

## Notes

- `minimatch` is used for glob matching in rules.
- `checkPermission` is the central point for all permission logic.
- `Read` and `LS` tools are updated to participate in the permission system.
