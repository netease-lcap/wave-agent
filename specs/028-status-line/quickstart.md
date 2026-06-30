# Quickstart: Status Line Component Refactoring

## Overview
This refactoring moves the status line logic from `InputBox.tsx` to a dedicated `StatusLine.tsx` component, and adds token usage percentage display.

## Usage
The `StatusLine` component is used within `InputBox.tsx` to display the current mode, shell command status, and context usage percentage.

```tsx
import { StatusLine } from "./StatusLine.js";

// ...

<StatusLine
  permissionMode={permissionMode}
  isShellCommand={isShellCommand}
  isBtwActive={btwState.isActive}
  latestTotalTokens={latestTotalTokens}
  maxInputTokens={maxInputTokens}
/>
```

The `LoadingIndicator` also shows the percentage alongside the token count:

```tsx
<LoadingIndicator
  isLoading={isLoading}
  isCommandRunning={isCommandRunning}
  isCompacting={isCompacting}
  latestTotalTokens={latestTotalTokens}
  maxInputTokens={maxInputTokens}
/>
```

## Verification
1. Run the CLI.
2. Verify the status line is displayed correctly.
3. Toggle modes with Shift+Tab and verify the status line updates.
4. Type `!` and verify the shell command status is displayed.
5. Send a message and verify "X% context" appears right-aligned in the status line.
6. Verify the percentage color: gray (<80%), yellow (80-95%), red (>95%).
7. During AI thinking, verify the loading indicator shows "1,234 tokens (X%)".
