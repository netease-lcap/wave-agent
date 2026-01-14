# Research: Secure File Access

## Decision: Safe Zone Implementation

We will implement the "Safe Zone" as a union of the current working directory and a user-configurable list of additional directories.

### Rationale
- **Security**: By default, the agent should only have auto-accept permissions within the project directory.
- **Flexibility**: Users can explicitly grant auto-accept permissions to other directories (e.g., shared libraries, other projects) via configuration.
- **Consistency**: The system already has a permission system; we are extending it to be path-aware for file operations.

### Implementation Details
1.  **Configuration**: Add `permissions.additionalDirectories` (array of strings) to `WaveConfiguration`.
2.  **Path Resolution**: Use `isPathInside` from `packages/agent-sdk/src/utils/pathSafety.ts` which already handles absolute paths and symlinks.
3.  **Permission Check**:
    - In `PermissionManager.checkPermission`, if the tool is a file modification tool (`Write`, `Edit`, `MultiEdit`, `Delete`):
        - Resolve the target file path.
        - Check if it's inside the "Safe Zone" (workdir or any of `additionalDirectories`).
        - If inside Safe Zone AND `acceptEdits` mode is ON, allow.
        - If outside Safe Zone, ALWAYS require confirmation (deny in `checkPermission` so it falls back to callback/CLI).
        - If inside Safe Zone AND `acceptEdits` mode is OFF, require confirmation.

### Alternatives Considered
- **Global Allow List**: Too broad, doesn't provide per-directory control.
- **Per-file Permissions**: Too granular, would be annoying for the user.

## Decision: Configuration Management

We will add `additionalDirectories` to the `permissions` object in `WaveConfiguration`.

### Rationale
- It logically belongs under `permissions`.
- Existing `LiveConfigManager` and `ConfigurationService` already handle merging and watching this structure.

## Decision: Tool Interception

We will modify `PermissionManager.checkPermission` to be path-aware for specific tools.

### Rationale
- `PermissionManager` is the central place for all permission decisions.
- It already has access to `toolName` and `toolInput`.
- It can be easily extended to handle path-based logic.

## Unresolved Questions (Resolved during research)
- **Symlinks**: `isPathInside` handles them using `fs.realpathSync`.
- **Relative Paths**: `isPathInside` uses `path.resolve` which handles relative paths if the base is correct. We should ensure we use the correct `workdir`.
