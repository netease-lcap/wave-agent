# Data Model: Split Chained Bash Commands

This feature does not introduce new entities but refines the content and structure of the existing `PermissionRule` strings stored in the `permissions.allow` array.

## Permission Rule Evolution

### Existing Format
A `PermissionRule` is a string that matches a tool execution. For the `Bash` tool, it currently takes the form:
`Bash(full_command_string)`

Example: `Bash(mkdir test && cd test)`

### New Format (Split)
When a chained command is saved to the `allow` list, it is decomposed into multiple simple command rules, excluding safe commands.

Example: `Bash(mkdir test && cd test)` becomes:
- `Bash(mkdir test)`
- (Note: `cd test` is excluded as it is a safe command)

## Permissions Configuration

The `permissions.allow` array in `settings.local.json` (or `settings.json`) will now contain these split rules.

```json
{
  "permissions": {
    "allow": [
      "Bash(mkdir test)",
      "Bash(npm install)",
      "Bash(git commit -m 'feat: split commands')"
    ]
  }
}
```

## Validation Rules

1.  **Uniqueness**: The system MUST NOT add duplicate rules to the `allow` array.
2.  **Safe Command Filtering**: Commands identified as "safe" (e.g., `cd`, `ls`, `pwd` with safe paths) MUST NOT be added to the `allow` array.
3.  **Normalization**: Commands SHOULD be stripped of environment variables and redirections before being checked for safety, but the rule saved SHOULD be the one that matches what `PermissionManager.isAllowedByRule` expects (which currently also strips them during check).

Wait, if `isAllowedByRule` strips them during check, then we should save the stripped version to ensure a match.

Actually, `isAllowedByRule` does:
```typescript
const processedPart = stripRedirections(stripEnvVars(part));
const action = `${context.toolName}(${processedPart})`;
```
So it checks against the *stripped* version. Thus, we should save the *stripped* version.
