# Research: Auto-Accept Permissions

## Decision: Configuration Merging Strategy
- **Choice**: `permissions.allow` will be merged by combining arrays from all levels (user and project).
- **Rationale**: Permissions are additive. If a user trusts a command globally, it should be trusted in all projects. If they trust it in a specific project, it should be trusted there.
- **Alternatives considered**: Project overriding user. Rejected because it would force users to re-declare global trusted commands in every project.

## Decision: Rule Format and Matching
- **Choice**: `Bash(command)` for bash commands. Exact string match.
- **Rationale**: Simple to implement and understand. Exact match is safer than regex or partial matches for security-sensitive operations.
- **Alternatives considered**: Regex matching. Rejected for now to keep it simple and avoid accidental over-permissioning.

## Decision: Persistence Implementation
- **Choice**: `Agent` will handle the persistence logic when it receives a `PermissionDecision` with a `newPermissionRule`.
- **Rationale**: The `Agent` already has access to the `workdir` and `ConfigurationService`. It's the central orchestrator.
- **Alternatives considered**: `PermissionManager` handling persistence. Rejected because `PermissionManager` should ideally be a pure logic component without direct file system access for better testability.

## Decision: Communication of State Changes
- **Choice**: Extend `PermissionDecision` with `newPermissionMode?: PermissionMode` and `newPermissionRule?: string`.
- **Rationale**: Allows the UI to signal back to the `Agent` what side effects should occur as a result of the user's choice.
- **Alternatives considered**: Separate callback for state changes. Rejected as it would complicate the `canUseTool` interface.
