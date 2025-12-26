# Quickstart: Auto-Accept Permissions

## For Users

### Auto-accepting Edits
When prompted for a file edit (e.g., `Write`), you will now see a second option:
`2. Yes, and auto-accept edits`
Selecting this will allow all subsequent file edits in the current session without prompting.

### Persisting Bash Commands
When prompted for a `Bash` command, you will see:
`2. Yes, and don't ask again for this command in this workdir`
Selecting this will save the command to `.wave/settings.local.json`. Future executions of the exact same command in this project will be automatically allowed.

### Global Permissions
You can manually add trusted commands to your global `~/.wave/settings.json`:
```json
{
  "permissions": {
    "allow": ["Bash(git status)", "Bash(pnpm test)"]
  }
}
```

## For Developers

### Handling Decisions
The `Agent` now processes `newPermissionMode` and `newPermissionRule` from `PermissionDecision`:
```typescript
const decision = await this.canUseTool(context);
if (decision.newPermissionMode) {
  this.setPermissionMode(decision.newPermissionMode);
}
if (decision.newPermissionRule) {
  await this.persistPermissionRule(decision.newPermissionRule);
}
```
