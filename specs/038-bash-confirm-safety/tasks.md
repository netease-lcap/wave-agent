# Tasks

## Phase 1: Setup and Infrastructure
- [X] T001: Build `agent-sdk` to ensure types are up to date and available for `code` package. <!-- id: T001 -->

## Phase 2: Foundational Changes (SDK)
- [X] T002: Add `hidePersistentOption?: boolean` to `ToolPermissionContext` interface in `packages/agent-sdk/src/types/permissions.ts`. <!-- id: T002 -->
- [X] T003: Extract `DANGEROUS_COMMANDS` blacklist from `getSmartPrefix` to an exported constant in `packages/agent-sdk/src/utils/bashParser.ts`. <!-- id: T003 -->

## Phase 3: US1 - Dangerous/Out-of-Bounds Command Safety
- [X] T004: Add unit tests for dangerous and out-of-bounds command detection in `packages/agent-sdk/tests/managers/permissionManager.test.ts`. <!-- id: T004 -->
- [X] T005: Add unit tests for `hidePersistentOption` visibility and navigation in `packages/code/tests/components/Confirmation.test.tsx`. <!-- id: T005 -->
- [X] T006: Implement detection logic in `PermissionManager.createContext` to set `hidePersistentOption` for dangerous or out-of-bounds bash commands in `packages/agent-sdk/src/managers/permissionManager.ts`. <!-- id: T006 -->
- [X] T007: Update `PermissionManager.expandBashRule` to filter out dangerous or out-of-bounds commands from being expanded into persistent rules in `packages/agent-sdk/src/managers/permissionManager.ts`. <!-- id: T007 -->
- [X] T008: Update `Confirmation` component to hide the "auto" option and adjust numbering/navigation when `hidePersistentOption` is true in `packages/code/src/components/Confirmation.tsx`. <!-- id: T008 -->
- [X] T009: Update `useChat` context and `ChatInterface` component to pass `hidePersistentOption` from `ToolPermissionContext` to the `Confirmation` component in `packages/code/src/contexts/useChat.tsx` and `packages/code/src/components/ChatInterface.tsx`. <!-- id: T009 -->

## Phase 4: Verification
- [X] T010: Run all tests in `agent-sdk` and `code` packages to ensure no regressions and that new functionality works as expected. <!-- id: T010 -->
