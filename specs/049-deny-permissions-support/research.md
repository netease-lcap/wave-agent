# Research: Support permissions.deny in settings.json

## Decision: Implement `permissions.deny` with high precedence

### Rationale
To ensure maximum security, `permissions.deny` must be checked before any other permission logic, including `bypassPermissions` mode or `RESTRICTED_TOOLS` checks. This follows the principle of "deny takes precedence".

### Implementation Details
1. **Rule Matching**:
   - Tool-only rules: `Bash`, `Write`, `Read`, etc.
   - Command-specific rules: `Bash(rm *)`.
   - Path-based rules: `Read(**/*.env)`, `Write(/etc/**)`, `Delete(/tmp/test.txt)`.
   - The matching logic for `ToolName(path_pattern)` will use the `minimatch` library (which is already a dependency of `agent-sdk`) to match the `path_pattern` against the `file_path` or `target_file` in the tool input.
   - **Rationale for `minimatch` over `glob`**: While `glob` is used for searching the filesystem, `minimatch` is the underlying library used by `glob` for string-to-pattern matching. Since permission checks must work for non-existent files (e.g., `Write` or `Delete` operations) and should not hit the disk for performance reasons, `minimatch` is the appropriate tool for this task.
   - A new private method `matchesRule(context, rule)` will be implemented in `PermissionManager` to centralize matching logic.

2. **Precedence**:
   - `checkPermission` will first check if the request matches any rule in `deniedRules`.
   - If denied, return `{ behavior: "deny", message: "..." }`.
   - This check happens BEFORE `bypassPermissions` mode check to ensure `deny` always wins.
   - Then proceed with existing logic (bypass, allow rules, restricted tools).

3. **Tool Integration**:
   - `Read` and `LS` tools will be updated to call `checkPermission`.
   - The `isRestrictedTool` check inside tools will be reviewed; `checkPermission` should be called for all tools that might be denied, but `checkPermission` itself will handle the "is restricted" logic for the default allow case.

4. **Configuration Merging**:
   - `loadMergedWaveConfig` in `configurationService.ts` will be updated to merge `permissions.deny` arrays from all sources (user, project, local) into a unique set.

5. **Validation**:
   - `validateConfiguration` will be updated to check that `permissions.deny` is an array of strings.

## Alternatives Considered

### Alternative 1: Only support tool-level denial
- **Pros**: Simpler to implement.
- **Cons**: Doesn't meet the requirement for path-based denial (e.g., blocking access to `.env` files while allowing other reads).
- **Decision**: Rejected in favor of more granular control.

### Alternative 2: Use a separate `deny` field for paths
- **Pros**: Clearer separation.
- **Cons**: Inconsistent with `permissions.allow` which we want to keep similar.
- **Decision**: Rejected for consistency.

## Research Tasks

### Task 1: Path-based matching logic
- **Goal**: Determine how to extract the path from various tool inputs and match it against glob patterns.
- **Findings**:
  - `Read`: `file_path`
  - `Write`: `file_path`
  - `Edit`: `file_path`
  - `MultiEdit`: `file_path`
  - `Delete`: `target_file`
  - `LS`: `path`
  - We can use `isPathInside` or a glob matcher. Since the requirement mentions glob patterns like `**/*.env`, a glob matcher is more appropriate.

### Task 2: Precedence in `checkPermission`
- **Goal**: Ensure `deny` is checked first.
- **Findings**:
  - Current `checkPermission` starts with `bypassPermissions` check.
  - We should move `deny` check to the very top.

### Task 3: Merging logic
- **Goal**: Ensure `deny` rules are merged correctly.
- **Findings**:
  - `loadMergedWaveConfig` already merges `allow` rules. We can replicate this for `deny`.
