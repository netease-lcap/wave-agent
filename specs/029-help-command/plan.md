# Implementation Plan: Help Command

## Overview
The `help` command provides an interactive UI for users to discover key bindings and available slash commands. It is implemented as a built-in command in the `code` package, utilizing the `HelpView` Ink component.

## Proposed Changes

### 1. Constants & Types
- Define `AVAILABLE_COMMANDS` in `packages/code/src/constants/commands.ts`.
- Ensure `SlashCommand` type is available in `wave-agent-sdk`.

### 2. UI Component (`HelpView.tsx`)
- Create `HelpView` component in `packages/code/src/components/HelpView.tsx`.
- Implement tab logic (General, Commands, Custom Commands).
- Implement navigation logic using `useInput` from Ink.
- Implement scrollable list for commands with selection-based descriptions.

### 3. Command Registration
- Add `help` to `AVAILABLE_COMMANDS`.
- Update the main application loop (e.g., `packages/code/src/index.tsx` or `InputManager`) to handle the `/help` command by rendering the `HelpView`.

## Verification Plan

### Automated Tests
- **Unit Tests**: Test `HelpView` component rendering and input handling.
- **Integration Tests**: Verify that typing `/help` correctly triggers the help view.

### Manual Verification
1. Run the agent.
2. Type `/help` and press Enter.
3. Verify "General" tab shows key bindings.
4. Press `Tab` to switch to "Commands".
5. Use arrow keys to navigate commands and see descriptions.
6. Press `Esc` to close.
