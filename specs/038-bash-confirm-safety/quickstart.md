# Quickstart: Bash Confirmation Safety

This feature ensures that dangerous bash commands or commands operating outside the project directory do not offer a "Don't ask again" option, preventing accidental permanent authorization of risky operations.

## How to Test

### 1. Safe Command
Run a safe command within the project directory:
```bash
ls
```
**Expected**: The confirmation dialog SHOULD show the "Yes, and don't ask again" option.

### 2. Out-of-bounds Command
Run a command that goes outside the project directory:
```bash
cd ..
```
(Assuming `..` is outside the project root)
**Expected**: The confirmation dialog SHOULD NOT show the "Yes, and don't ask again" option.

### 3. Dangerous Command
Run a blacklisted dangerous command:
```bash
rm -rf /tmp/some-file
```
**Expected**: The confirmation dialog SHOULD NOT show the "Yes, and don't ask again" option.

## Implementation Notes

- The logic for identifying dangerous/out-of-bounds commands resides in `agent-sdk`'s `PermissionManager`.
- The UI visibility is controlled by the `hidePersistentOption` flag in the `ToolPermissionContext`.
- Even if the UI is bypassed, `PermissionManager.expandBashRule` will refuse to generate persistent rules for these commands.
