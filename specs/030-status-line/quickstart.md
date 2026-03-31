# Quickstart: Status Line Component Refactoring

## Overview
This refactoring moves the status line logic from `InputBox.tsx` to a dedicated `StatusLine.tsx` component.

## Usage
The `StatusLine` component is used within `InputBox.tsx` to display the current mode and shell command status.

```tsx
import { StatusLine } from "./StatusLine.js";

// ...

<StatusLine
  permissionMode={permissionMode}
  isShellCommand={isShellCommand}
/>
```

## Verification
1. Run the CLI.
2. Verify the status line is displayed correctly.
3. Toggle modes with Shift+Tab and verify the status line updates.
4. Type `!` and verify the shell command status is displayed.
