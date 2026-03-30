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

## Phase 8: Split Chained Commands (from 036)
- [x] T026 Implement `expandBashRule` in `PermissionManager` to split commands and filter safe ones.
- [x] T027 Update `addPermissionRule` in `Agent` to use `expandBashRule`.
- [x] T028 Add unit and integration tests for command splitting and filtering.

## Phase 9: Bash Confirmation Safety (from 038)
- [x] T029 Add `hidePersistentOption` to `ToolPermissionContext`.
- [x] T030 Extract `DANGEROUS_COMMANDS` blacklist and implement `hasWriteRedirections`.
- [x] T031 Implement detection logic in `PermissionManager.createContext` to set `hidePersistentOption` for dangerous/out-of-bounds commands.
- [x] T032 Update `Confirmation` component to hide "Don't ask again" when `hidePersistentOption` is true.

## Phase 10: Programmatic and Session-specific Permissions
- [x] T039 Add `allowedTools` and `disallowedTools` to `AgentOptions` in SDK.
- [x] T040 Implement `--allowed-tools` and `--disallowed-tools` flags in CLI.
- [x] T041 Update `PermissionManager` to handle instance-specific `allowedTools` and `disallowedTools`.
- [x] T042 Ensure `disallowedTools` (deny) takes precedence over `allowedTools` (allow).
- [x] T043 Add unit and integration tests for programmatic and session-specific permissions.

## Phase 11: Persistent Configuration (from 026)
- [x] T044 Extend `WaveConfiguration` interface with optional `permissionMode` field.
- [x] T045 Add `permissionMode` validation logic to `ConfigurationWatcher`.
- [x] T046 Update `PermissionManager` constructor to accept `configuredPermissionMode` parameter.
- [x] T047 Implement `permissionMode` resolution logic in `PermissionManager` with CLI override precedence.
- [x] T048 Implement settings hierarchy resolution (`settings.local.json` > `settings.json` > user settings).

## Phase 12: Interactive Permission Trust (from 032)
- [x] T049 Update `PermissionDecision` interface to include `newPermissionMode` and `newPermissionRule`.
- [x] T050 Implement `permissions.allow` merging in `loadMergedWaveConfig`.
- [x] T051 Update `Confirmation` component to support "Yes, and auto-accept edits" and "Yes, and don't ask again...".
- [x] T052 Implement `persistPermissionRule` method in `Agent` class.
- [x] T053 Update `Agent` to handle `newPermissionMode` and `newPermissionRule` from `PermissionDecision`.
- [x] T054 Add integration tests for `acceptEdits` mode transition and Bash rule persistence.

## Phase 13: AcceptEdits Permission Mode (from 031)
- [x] T055 Update `PermissionMode` type to include `"acceptEdits"`.
- [x] T056 Implement tool-specific authorization logic for `acceptEdits` mode.
- [x] [P] T057 Update `InputManager` to handle `Shift+Tab` for mode cycling.
- [x] [P] T058 Update CLI UI to display current permission mode.

## Phase 14: dontAsk Permission Mode (from 072)
- [x] T059 Implement `dontAsk` mode in `PermissionManager` to auto-deny unapproved restricted tools.
- [x] T060 Update `buildSystemPrompt` to inject message when `dontAsk` mode is active.
- [x] T061 Ensure `dontAsk` mode is excluded from `Shift+Tab` cycling.
- [x] T062 Verify `permissionMode: "dontAsk"` in configuration correctly sets the mode.

## Phase 15: Secure File Access (from 047)
- [x] T063 Update `WaveConfiguration` type to include `permissions.additionalDirectories: string[]`.
- [x] T064 Update `PermissionManager` to store and use `additionalDirectories` for Safe Zone checks.
- [x] T065 Implement Safe Zone check in `PermissionManager.checkPermission` for `Write`, `Edit`, `Delete`, and `mkdir`.
- [x] T066 Ensure out-of-bounds operations always require confirmation, regardless of `acceptEdits` mode.
- [x] T067 Add unit tests for Safe Zone logic and out-of-bounds operations.

## Phase 16: Bash Write Redirection to Dedicated Tools
- [x] T068 Enhance `hasWriteRedirections` to ignore file descriptor redirections (e.g., `2>&1`).
- [x] T069 Implement automatic denial of bash write redirections in `PermissionManager.checkPermission`.
- [x] T070 Provide a reminder message to use `Write` or `Edit` tools when bash write redirection is denied.
- [x] T071 Add unit tests for bash write redirection interception and reminder message.
