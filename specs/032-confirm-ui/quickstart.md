# Quickstart: Confirm UI

## Overview
The confirmation UI system prompts users to approve sensitive operations before execution. This includes Bash commands, file writes/edits, plan approvals, and clarifying questions.

## How to use

### Basic Confirmation

When the agent attempts a restricted operation:

1. **Review**: The confirmation displays the tool name, action description, and relevant details.
2. **Navigate**: Use ↑↓ or Tab to select an option.
3. **Type feedback**: Start typing to enter alternative feedback (auto-selects the feedback option).
4. **Confirm**: Press Enter to proceed with your selection, or ESC to cancel.

### Available Options

| Option | Behavior |
|--------|----------|
| **Yes, proceed** | Allow the operation once |
| **Yes, and don't ask again** | Allow and create a persistent rule |
| **Type feedback** | Deny with custom message for the agent |

### Ask User Question

When the agent needs clarification:

1. **Navigate**: Use ↑↓ to select an option.
2. **Multi-select**: Press Space to toggle options (if enabled).
3. **Custom answer**: Select "Other" and type your response.
4. **Navigate questions**: Press Tab to move between questions.
5. **Submit**: Press Enter to confirm all answers.

### Plan Mode Approval

When exiting plan mode:

| Option | Behavior |
|--------|----------|
| **Clear context and auto-accept edits** | Clear conversation context, switch to acceptEdits mode |
| **Manually approve edits** | Switch to default mode for manual approval |

## Example Session

```text
Agent: [Attempts to run] npm install axios

┌──────────────────────────────────────┐
│ Tool: Bash                           │
│ Execute command: npm install axios   │
│                                      │
│ Do you want to proceed?              │
│                                      │
│ > Yes, proceed                       │
│   Yes, and don't ask again for: npm  │
│   Type here to tell Wave what to     │
│     change                           │
│                                      │
│ Use ↑↓ or Tab to navigate • ESC to   │
│ cancel                               │
└──────────────────────────────────────┘

User: [Presses Enter]

Agent: [Executes npm install axios]
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| ↑ / ↓ | Navigate options |
| Tab / Shift+Tab | Cycle options / Navigate questions |
| Space | Toggle selection (multi-select questions) |
| Enter | Confirm selection |
| ESC | Cancel / Abort |
| Any character | Type feedback (auto-selects feedback option) |
