# Research: Bash Confirmation Safety

## Decision: Identify "Dangerous" Commands for Permission Persistence

We will identify commands that should not be allowed to have persistent permissions ("Don't ask again"). These include:
1.  Commands in a hardcoded blacklist (e.g., `rm`, `mv`, `sudo`, etc.).
2.  Commands that access or move to directories outside the project's working directory (e.g., `cd ..`, `ls /etc`).

## Rationale

Persistent permissions for dangerous commands or out-of-bounds access pose a security risk. Users might accidentally authorize a broad rule that allows the agent to perform destructive actions or leak sensitive information from outside the project. By hiding the "Don't ask again" option for these cases, we force a case-by-case manual approval.

## Implementation Details

### 1. Identify Dangerous Commands
We will use the existing `blacklist` in `bashParser.ts` and expand it if necessary. We will also use `isPathInside` to check for out-of-bounds access in `cd` and `ls` commands.

### 2. Update `ToolPermissionContext`
Add `hidePersistentOption: boolean` to the context passed to the permission callback.

### 3. Update `PermissionManager`
- In `createContext`, evaluate if the command is dangerous or out-of-bounds and set `hidePersistentOption`.
- In `expandBashRule`, return an empty array if the command is dangerous or out-of-bounds to prevent accidental persistence even if the UI sends a rule.

### 4. Update UI (`Confirmation` component)
Modify the `Confirmation` component in the `code` package to hide the "Yes, and don't ask again" option when `hidePersistentOption` is true.

## Alternatives Considered

### Alternative: Only hide the option in the UI
- **Pros**: Simpler implementation.
- **Cons**: Less robust. If the UI is bypassed or has a bug, dangerous rules could still be saved.
- **Decision**: Rejected in favor of a multi-layered approach (UI + SDK enforcement).

### Alternative: Use a more sophisticated command analysis
- **Pros**: Could identify more subtle risks.
- **Cons**: High complexity, prone to false positives/negatives in shell script parsing.
- **Decision**: Stick to a simple blacklist and path safety check for now, as it covers the most common risks mentioned by the user.
