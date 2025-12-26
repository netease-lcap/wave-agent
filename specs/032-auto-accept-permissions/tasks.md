# Tasks: Auto-Accept Permissions

**Feature**: Auto-Accept Permissions
**Branch**: `032-auto-accept-permissions`
**Implementation Strategy**: MVP first (User Story 1 & 2), then incremental delivery of User Story 3.

## Phase 1: Setup

- [X] T001 Update `PermissionDecision` interface in `packages/agent-sdk/src/types/permissions.ts`
- [X] T002 Update `WaveConfiguration` interface in `packages/agent-sdk/src/types/hooks.ts`
- [X] T003 Build `agent-sdk` to propagate type changes `cd packages/agent-sdk && pnpm build`

## Phase 2: Foundational

- [X] T004 Implement `permissions.allow` merging in `loadMergedWaveConfig` in `packages/agent-sdk/src/services/configurationService.ts`
- [X] T005 Update `PermissionManager` to check `permissions.allow` rules in `packages/agent-sdk/src/managers/permissionManager.ts`
- [X] T006 Add unit tests for `permissions.allow` matching in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T007 Build `agent-sdk` `cd packages/agent-sdk && pnpm build`

## Phase 3: User Story 1 - Auto-accept File Edits from Prompt (Priority: P1)

**Goal**: Allow users to switch to `acceptEdits` mode directly from the confirmation prompt for file tools.
**Independent Test**: Trigger a `Write` tool, select "Yes, and auto-accept edits", then verify subsequent `Edit` tools are auto-accepted.

- [X] T008 [P] [US1] Update `Confirmation` component to support three options for file tools in `packages/code/src/components/Confirmation.tsx`
- [X] T009 [US1] Update `Agent.sendMessage` (or tool execution loop) to handle `newPermissionMode` from `PermissionDecision` in `packages/agent-sdk/src/agent.ts`
- [X] T010 [US1] Add integration test for `acceptEdits` mode transition in `packages/agent-sdk/tests/agent/agent.autoAccept.test.ts`

## Phase 4: User Story 2 - Persistent Bash Command Permission (Priority: P1)

**Goal**: Allow users to persist specific Bash commands to `.wave/settings.local.json`.
**Independent Test**: Trigger a `Bash` tool, select "Yes, and don't ask again for this command in this workdir", verify `.wave/settings.local.json` is created/updated, then run the same command again.

- [X] T011 [P] [US2] Update `Confirmation` component to support the persistent option for Bash commands in `packages/code/src/components/Confirmation.tsx`
- [X] T012 [US2] Implement `persistPermissionRule` method in `Agent` class in `packages/agent-sdk/src/agent.ts`
- [X] T013 [US2] Update `Agent` to call `persistPermissionRule` when `newPermissionRule` is present in `PermissionDecision` in `packages/agent-sdk/src/agent.ts`
- [X] T014 [US2] Add integration test for Bash rule persistence in `packages/agent-sdk/tests/agent/agent.autoAccept.test.ts`

## Phase 5: User Story 3 - Global and Local Permission Rules (Priority: P2)

**Goal**: Ensure rules from both user-level and project-level settings are correctly loaded and applied.
**Independent Test**: Manually add a rule to `~/.wave/settings.json` and verify it works in a project without local rules.

- [X] T015 [US3] Update `Agent.initialize` and `LiveConfigManager` to load and watch `permissions.allow`
- [X] T016 [US3] Verify `ConfigurationService` correctly merges rules from multiple files in `packages/agent-sdk/tests/services/configurationService.test.ts`
- [X] T017 [US3] Add integration test for global vs local rule precedence and merging in `packages/agent-sdk/tests/agent/agent.autoAccept.test.ts`

## Phase 6: Polish & Cross-cutting concerns

- [X] T018 Run full test suite `pnpm test` @completed(2025-12-26)
- [X] T019 Run type checks `pnpm run type-check` @completed(2025-12-26)
- [X] T020 Run linting `pnpm lint` @completed(2025-12-26)

## Dependencies

- US1 and US2 depend on Phase 1 and Phase 2.
- US3 depends on Phase 2.
- Phase 6 depends on all previous phases.

## Parallel Execution Examples

- T008 and T011 can be implemented together in `Confirmation.tsx`.
- T009, T012, and T013 can be implemented together in `agent.ts`.
- T006 and T015 can be run in parallel as they are unit tests for different services.
