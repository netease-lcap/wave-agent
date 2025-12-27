# Research: Bash Command Splitting and Safe Command Filtering

## Decision: Implement `expandBashRule` in `PermissionManager`

We will implement a new method in `PermissionManager` that takes a bash command and returns a list of permission rules to be persisted.

### Rationale
- **Granularity**: Splitting chained commands allows individual components to be auto-allowed in future executions, even if they appear in different chains.
- **Cleanliness**: Filtering out safe commands (like `cd`, `ls`, `pwd`) prevents the `permissions.allow` list from being cluttered with unnecessary entries.
- **Consistency**: Reusing existing utilities (`splitBashCommand`, `stripEnvVars`, `stripRedirections`) and the `SAFE_COMMANDS` list ensures that the "save" logic matches the "check" logic.

## Technical Details

### Splitting Logic
The `splitBashCommand` utility correctly handles:
- Operators: `&&`, `||`, `;`, `|`, `&`
- Quotes: Single and double quotes
- Subshells: Recursive splitting of commands inside `()`

### Filtering Logic
A command part is considered "safe" if:
1.  The base command is in `SAFE_COMMANDS` (`cd`, `ls`, `pwd`).
2.  For `cd` and `ls`, all path arguments are within the current working directory (using `isPathInside`).
3.  For `pwd`, it is always safe.

### Rule Generation
For each non-safe command part:
1.  Strip environment variables and redirections.
2.  Wrap in `Bash(...)`.
3.  Return as part of the rules list.

## Alternatives Considered

### 1. Save the full chained command as a single rule
- **Rejected because**: It doesn't allow for granular permissions. If the user allows `mkdir a && cd a`, they would still be prompted for `mkdir a` later. Also, the current `isAllowedByRule` implementation actually fails to match full chained commands because it splits them during the check.

### 2. Split logic in the `Agent` class
- **Rejected because**: The `PermissionManager` already has access to `SAFE_COMMANDS` and the necessary utilities. Keeping the logic in `PermissionManager` makes it more testable and keeps the `Agent` class focused on orchestration.

## Edge Cases Handled
- `VAR=val cmd`: `VAR=val` is stripped before safety check.
- `cmd > file`: `> file` is stripped before safety check.
- `(cmd1 && cmd2)`: Subshells are split and processed.
- `cd /outside && rm -rf *`: `cd /outside` is identified as unsafe (if outside workdir) and saved; `rm` is identified as unsafe and saved.
