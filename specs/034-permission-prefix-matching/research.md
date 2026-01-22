# Research: Permission Prefix Matching

## Decision: Implement Prefix Matching in PermissionManager

The permission checking logic is centralized in `PermissionManager.isAllowedByRule` within `packages/agent-sdk/src/managers/permissionManager.ts`. We will modify this method to support the `:*` suffix for prefix matching.

### Rationale
- **Centralization**: Modifying `PermissionManager` ensures all tools (currently only `Bash` is implemented for rules) benefit from this feature.
- **Simplicity**: The requirement is strictly for prefix matching using `:*` at the end, which can be easily implemented using `String.prototype.startsWith()`.
- **Security**: By avoiding regex and general wildcards, we minimize the risk of over-permissive rules.

### Alternatives Considered
- **Regex Support**: Rejected because the user explicitly requested "not regex". Regex can be complex to write correctly and may lead to security vulnerabilities if not handled carefully.
- **Glob Support**: Rejected because the user explicitly requested "not wildcard" (except for the specific `:*` suffix).
- **Separate Rule Types**: We considered having different types for exact and prefix rules, but since they are all stored as strings in `permissions.allow`, it's simpler to detect the `:*` suffix at runtime.

## Implementation Details

### Matching Logic
For each rule in `allowedRules` or `temporaryRules`:
1. If the tool is `Bash`:
   - Split the command into individual parts (e.g., `cmd1 && cmd2`).
   - For each part:
     - Strip environment variables and redirections.
     - Check if it's a "safe" command (e.g., `ls`, `cd`, `pwd`).
     - If not safe, check if it matches any rule (exact or prefix).
   - The entire command chain is allowed only if *every* part is allowed.
2. For other tools:
   - Perform an exact match or prefix match against the rule.

### Example
Rule: `Bash(git commit:*)`
Action: `Bash(git commit -m "feat: add prefix matching")`
1. Rule ends with `:*`.
2. Prefix is `Bash(git commit`.
3. Action starts with `Bash(git commit`.
4. Result: **Allowed**.

Rule: `Bash(echo :* test)`
Action: `Bash(echo hello test)`
1. Rule does NOT end with `:*` (it ends with ` test`).
2. Perform exact match.
3. Result: **Denied**.

## Impact Analysis
- **Backward Compatibility**: Existing exact match rules will continue to work as they don't end in `:*`.
- **Performance**: The overhead of checking for the `:*` suffix and using `startsWith` is negligible.
- **Maintainability**: The logic remains simple and easy to understand.
