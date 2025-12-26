# Quickstart: Remove Bypass Permissions from Shift+Tab

## Overview

This feature modifies the keyboard shortcut `Shift+Tab` to only cycle between "Default" and "Accept Edits" permission modes, removing "Bypass Permissions" from the cycle for safety.

## Verification Steps

### Automated Tests

Run the updated tests for `InputManager`:

```bash
cd packages/code
pnpm test tests/managers/InputManager.permissionMode.test.ts
```

### Manual Verification

1. Start the Wave Agent CLI.
2. Observe the current permission mode (usually displayed in the UI).
3. Press `Shift+Tab`.
   - **Expected**: Mode changes from "Default" to "Accept Edits".
4. Press `Shift+Tab` again.
   - **Expected**: Mode changes from "Accept Edits" back to "Default".
5. Verify that "Bypass Permissions" is never reached through this shortcut.
