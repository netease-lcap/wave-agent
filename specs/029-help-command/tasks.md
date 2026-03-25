# Tasks: Help Command

**Input**: Design documents from `/specs/029-help-command/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Phase 1: Setup & Infrastructure

- [X] T001 Define `SlashCommand` interface in `packages/agent-sdk/src/types/index.ts`
- [X] T002 Create `AVAILABLE_COMMANDS` constant in `packages/code/src/constants/commands.ts`
- [X] T003 Add `help` command entry to `AVAILABLE_COMMANDS`

## Phase 2: UI Implementation

- [X] T004 Implement basic `HelpView` component structure in `packages/code/src/components/HelpView.tsx`
- [X] T005 Implement tab switching logic (General/Commands)
- [X] T006 Implement "General" tab with key bindings list
- [X] T007 Implement "Commands" tab with scrollable list and selection logic
- [X] T008 Add support for "Custom Commands" tab when commands are passed via props
- [X] T009 Add footer with navigation hints

## Phase 3: Integration

- [X] T010 Update main application state to track if help is open
- [X] T011 Intercept `/help` command in input handler to open help view
- [X] T012 Wire up `onCancel` prop to close the help view

## Phase 4: Testing & Polish

- [ ] T013 Add unit tests for `HelpView` component
- [X] T014 Verify visual styling and layout in various terminal sizes
- [X] T015 Ensure all key bindings mentioned in "General" tab are actually implemented and working
