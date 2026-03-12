# Tasks: Tool Permission System

**Status**: All Core Features Implemented

## Phase 1: Foundational Permission System
- [x] T001 Implement `PermissionManager` with basic allow rules.
- [x] T002 Add `permissionMode` to `Agent` ("default", "bypassPermissions").
- [x] T003 Implement `canUseTool` callback in Agent SDK.
- [x] T004 Create CLI `Confirmation` component with allow/deny and alternative instructions.
- [x] T005 Implement sequential confirmation queue for multiple tool calls.
- [x] T006 Add `Shift+Tab` shortcut to cycle permission modes.

## Phase 2: Wildcard Matching & Smart Heuristics
- [x] T007 Support `*` wildcard in `permissions.allow` at any position.
- [x] T008 Implement `getSmartWildcard` heuristic for bash commands.
- [x] T009 Update UI to suggest and allow editing of smart wildcard patterns.
- [x] T010 Implement blacklist for dangerous commands (e.g., `rm`, `sudo`) to prevent wildcard matching.

## Phase 3: Secure Pipeline Validation
- [x] T011 Implement bash command decomposition into "simple commands".
- [x] T012 Validate every simple command in a pipeline against permission rules.
- [x] T013 Handle shell operators (`&&`, `|`, `;`, etc.) and subshells.
- [x] T014 Strip inline environment variables before matching.

## Phase 4: Deny Rules & Path-based Permissions
- [x] T015 Support `permissions.deny` in settings.
- [x] T016 Ensure `deny` rules take precedence over `allow` rules.
- [x] T017 Implement path-based rules: `ToolName(glob_pattern)` (e.g., `Read(**/*.env)`).
- [x] T018 Apply path-based rules to `Read`, `Write`, `Edit`, `Delete`, `LS`.

## Phase 5: Built-in Safe Commands
- [x] T019 Implement built-in safe list: `cd`, `ls`, `pwd`.
- [x] T020 Restrict safe commands to CWD and its subdirectories.
- [x] T021 Automatically permit safe commands meeting criteria in `default` mode.

## Phase 6: Verification & Polish
- [x] T022 Comprehensive unit tests for all matching logic.
- [x] T023 Integration tests for Agent permission flows.
- [x] T024 Documentation and Quickstart updates.

## Phase 7: Additional Built-in Rules
- [x] T025 Add `wc -l *` to the built-in allow permission rules.
