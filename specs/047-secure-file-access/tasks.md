# Tasks: Secure File Access

**Feature Name**: Secure File Access
**Status**: Pending
**Implementation Strategy**: MVP first, focusing on core permission logic in `PermissionManager`.

## Phase 1: Setup

- [X] T001 Initialize feature branch `047-secure-file-access` and verify environment with `pnpm install`

## Phase 2: Foundational

- [X] T002 Update `WaveConfiguration` type in `packages/agent-sdk/src/types/hooks.ts` to include `permissions.additionalDirectories: string[]`
- [X] T003 Update `PermissionManagerOptions` and `PermissionManager` class in `packages/agent-sdk/src/managers/permissionManager.ts` to store `additionalDirectories`
- [X] T004 Update `LiveConfigManager.reloadConfiguration` in `packages/agent-sdk/src/managers/liveConfigManager.ts` to pass `additionalDirectories` from config to `PermissionManager`

## Phase 3: User Story 1 - Safe Zone File Operations

**Story Goal**: Allow auto-accept for file operations within the Safe Zone when `acceptEdits` is ON.

**Independent Test Criteria**:
1. Enable `acceptEdits` mode.
2. Perform `Write` operation in `workdir` -> Success without prompt.
3. Perform `Write` operation in `additionalDirectories` -> Success without prompt.
4. Disable `acceptEdits` mode.
5. Perform `Write` operation in `workdir` -> Confirmation prompt displayed.

- [X] T005 [P] [US1] Create unit tests for Safe Zone logic in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T006 [US1] Implement Safe Zone check in `PermissionManager.checkPermission` using `isPathInside` for `Write`, `Edit`, `MultiEdit`, and `Delete` tools
- [X] T007 [US1] Update `PermissionManager.checkPermission` to return `behavior: "allow"` if target is in Safe Zone and mode is `acceptEdits`

## Phase 4: User Story 2 - Out-of-Bounds Security Confirmation

**Story Goal**: Always require confirmation for file operations outside the Safe Zone.

**Independent Test Criteria**:
1. Enable `acceptEdits` mode.
2. Perform `Write` operation outside Safe Zone (e.g., `/tmp/test.txt`) -> Confirmation prompt displayed.
3. Verify that `acceptEdits` does NOT bypass this check for out-of-bounds paths.

- [X] T008 [P] [US2] Add unit tests for out-of-bounds operations in `packages/agent-sdk/tests/managers/permissionManager.test.ts`
- [X] T009 [US2] Update `PermissionManager.checkPermission` to return `behavior: "deny"` (triggering confirmation) for restricted tools if target is outside Safe Zone, regardless of `acceptEdits`

## Phase 5: Polish & Cross-cutting Concerns

- [X] T010 Run `pnpm build` in `packages/agent-sdk` to propagate type changes
- [X] T011 Run `pnpm run type-check` and `pnpm run lint` to ensure code quality
- [X] T012 Verify all tests pass with `pnpm -F agent-sdk test`

## Dependencies

- US1 depends on Phase 2 (Foundational)
- US2 depends on US1 (Logic is shared in `PermissionManager`)

## Parallel Execution Examples

- T005 and T008 (Tests) can be developed in parallel with implementation if using TDD.
- T002, T003, T004 (Foundational) must be sequential.
