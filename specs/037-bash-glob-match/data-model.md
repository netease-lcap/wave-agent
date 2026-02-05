# Data Model: Smart Prefix Match for Trusted Bash Commands

## Entities

### TrustedCommand
Represents a command or prefix that the user has authorized for automatic execution.

**Attributes:**
- `pattern`: The string pattern to match.
  - Format for exact match: `Bash(command)`
  - Format for prefix match: `Bash(prefix:*)`
- `type`: Derived from the pattern.
  - `EXACT`: If pattern does not end with `:*)`.
  - `PREFIX`: If pattern ends with `:*)`.

**Validation Rules:**
- Must start with `Bash(`.
- Must end with `)`.
- Prefix patterns must not include blacklisted commands (e.g., `rm`, `sudo`).

## Storage Structure

Stored in `settings.local.json` under `permissions.allow`.

```json
{
  "permissions": {
    "allow": [
      "Bash(ls)",
      "Bash(npm install:*)",
      "Bash(git commit:*)"
    ]
  }
}
```

## State Transitions

1. **Pending**: User is prompted for a bash command.
2. **Heuristic Extraction**: System calculates suggested prefix.
3. **User Confirmation**: User selects "Yes, and don't ask again" and optionally edits the prefix.
4. **Persistence**: System saves the rule to `settings.local.json`.
5. **Execution**: Future commands are checked against `permissions.allow` using `PermissionManager.isAllowedByRule`.
