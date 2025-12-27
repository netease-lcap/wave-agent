# Tasks - Secure Pipeline Command Permission Matching

This document outlines the tasks for implementing secure pipeline command decomposition and validation.

## Phase 1: Setup

- [x] T001 Create implementation branch `035-secure-cd-permission` (if not already on it)
- [x] T002 Initialize task tracking in `specs/035-secure-cd-permission/tasks.md`

## Phase 2: Foundational

- [x] T003 [P] Implement `splitBashCommand` in `packages/agent-sdk/src/utils/bashParser.ts` to split by `&&`, `||`, `;`, `|`, `&`
- [x] T004 [P] Implement `stripEnvVars` in `packages/agent-sdk/src/utils/bashParser.ts` to remove `VAR=val` prefixes
- [x] T005 [P] Implement `stripRedirections` in `packages/agent-sdk/src/utils/bashParser.ts` to remove `> file`, `2>&1`, etc.
- [x] T006 [P] Implement `isPathInside` in `packages/agent-sdk/src/utils/pathSafety.ts` using `fs.realpathSync`
- [x] T007 [P] Add unit tests for `bashParser` in `packages/agent-sdk/tests/utils/bashParser.test.ts`
- [x] T008 [P] Add unit tests for `pathSafety` in `packages/agent-sdk/tests/utils/pathSafety.test.ts`

## Phase 3: User Story 1 - Decompose and Validate Chained Commands (Priority: P1)

**Goal**: Automatically permit complex commands if all individual parts are permitted.
**Independent Test**: Configure `permissions.allow` with `cd /tmp/*` and `ls`, then run `cd /tmp/test && ls`.

- [x] T009 [US1] Update `PermissionManager.isAllowedByRule` in `packages/agent-sdk/src/managers/permissionManager.ts` to handle decomposed commands
- [x] T010 [US1] Update `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts` to iterate through all simple commands
- [x] T011 [US1] Add unit tests for complex command validation in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

## Phase 4: User Story 2 - Handle Complex Shell Syntax (Priority: P2)

**Goal**: Correctly identify commands in subshells and handle redirections.
**Independent Test**: Run `(cd /tmp/test && ls)` and `echo "data" > output.txt`.

- [x] T012 [US2] Enhance `bashParser.ts` to handle subshells `(...)` recursively
- [x] T013 [US2] Ensure `stripRedirections` correctly handles all redirection types in `bashParser.ts`
- [x] T014 [US2] Add unit tests for subshells and redirections in `packages/agent-sdk/tests/utils/bashParser.test.ts`

## Phase 5: User Story 3 - Built-in Safe Commands with Path Restrictions (Priority: P3)

**Goal**: Permit `cd`, `ls`, `pwd` within workspace by default.
**Independent Test**: Run `cd src` (allowed) and `cd ..` (denied) with empty `permissions.allow`.

- [x] T015 [US3] Implement built-in safe list (`cd`, `ls`, `pwd`) in `PermissionManager.ts`
- [x] T016 [US3] Implement path restriction logic for safe commands in `PermissionManager.ts` using `pathSafety.ts`
- [x] T017 [US3] Update `bashTool.ts` in `packages/agent-sdk/src/tools/bashTool.ts` to pass `workdir` to `PermissionManager`
- [x] T018 [US3] Add unit tests for safe list and path restrictions in `packages/agent-sdk/tests/managers/permissionManager.test.ts`

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T019 [P] Run `pnpm run type-check` in `packages/agent-sdk`
- [x] T020 [P] Run `pnpm run lint` in `packages/agent-sdk`
- [x] T021 [P] Run all tests in `packages/agent-sdk` using `pnpm test`
- [x] T022 Final review of implementation against `spec.md` requirements

## Dependencies

- T003-T006 are foundational and must be completed before Phase 3.
- Phase 3 (US1) is the MVP and should be completed first.
- Phase 4 (US2) and Phase 5 (US3) can be implemented in parallel after Phase 3.

## Parallel Execution Examples

### User Story 1
- T009 and T010 can be worked on together as they are in the same file but different methods.

### User Story 3
- T015 and T016 can be implemented in parallel.
