# Implementation Plan - AcceptEdits Permission Mode

This document outlines the technical strategy for implementing the `acceptEdits` permission mode, SDK support for setting permission modes, and CLI support for cycling modes via `Shift+Tab`.

## Technical Context

### Current State
- `PermissionMode` is defined in `packages/agent-sdk/src/types/permissions.ts` as `"default" | "bypassPermissions"`.
- `PermissionManager` handles permission checks and mode resolution.
- `Agent` class initializes `PermissionManager` and `ToolManager`.
- CLI uses Ink and has an `InputBox` component that handles keyboard input via `useInput` and `InputManager`.
- `settings.json` is managed by `ConfigurationService` and `LiveConfigManager`.

### Target State
- `PermissionMode` includes `acceptEdits`.
- `PermissionManager` supports `acceptEdits` logic (auto-accept `Edit`, `MultiEdit`, `Delete`, `Write`).
- `Agent` and SDK provide methods to get/set permission mode.
- CLI `InputBox` (via `InputManager`) handles `Shift+Tab` to cycle modes.
- CLI UI displays the current permission mode.
- `settings.json` supports `acceptEdits` in `defaultMode`.

### Unknowns & Research Tasks
- [x] How to capture `Shift+Tab` in Ink's `useInput`? (Use `key.shift && key.tab`).
- [x] Where is the best place to display the current permission mode in the CLI UI? (In `InputBox`).
- [x] How to ensure `LiveConfigManager` correctly propagates `defaultMode` changes to the active `PermissionManager`. (Already handled in `Agent.initialize`).

## Constitution Check

| Principle | Adherence Plan |
|-----------|----------------|
| I. Package-First Architecture | Changes will be correctly partitioned between `agent-sdk` (core logic) and `code` (CLI/UI). |
| II. TypeScript Excellence | All new types and modifications will use strict TypeScript. |
| III. Test Alignment | Tests will be added to `packages/agent-sdk/tests` and `packages/code/tests`. |
| IV. Build Dependencies | `pnpm build` will be run after `agent-sdk` changes. |
| VI. Quality Gates | `type-check` and `lint` will be run before completion. |
| IX. Type System Evolution | `PermissionMode` will be extended rather than creating a new type. |
| X. Data Model Minimalism | The `PermissionMode` enum remains simple. |

## Gates

- [ ] `PermissionMode` extended to include `acceptEdits`.
- [ ] `PermissionManager` correctly handles `acceptEdits` for specific tools.
- [ ] `Shift+Tab` successfully cycles modes in CLI.
- [ ] Current mode is visible in CLI UI.
- [ ] `settings.json` `defaultMode: "acceptEdits"` works on startup.

## Phase 0: Research

### Research Tasks
- **RT-001**: Verify `Shift+Tab` detection in Ink.
- **RT-002**: Identify existing CLI UI components for status display.
- **RT-003**: Trace `defaultMode` initialization from `settings.json` to `PermissionManager`.

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- Update `PermissionMode` type.

### API Contracts (`/contracts/`)
- SDK: `Agent.setPermissionMode(mode: PermissionMode)`, `Agent.getPermissionMode(): PermissionMode`.
- CLI: Keyboard event mapping for `Shift+Tab`.

### Quickstart (`quickstart.md`)
- How to use the new mode in SDK and CLI.

## Phase 2: Implementation Strategy

### Step 1: `agent-sdk` Core
- **Task 1.1**: Update `PermissionMode` type in `packages/agent-sdk/src/types/permissions.ts` to include `"acceptEdits"`.
- **Task 1.2**: Update `PermissionManager.checkPermission` in `packages/agent-sdk/src/managers/permissionManager.ts` to implement `acceptEdits` logic.
- **Task 1.3**: Add `getPermissionMode()` and `setPermissionMode(mode: PermissionMode)` to `Agent` class in `packages/agent-sdk/src/agent.ts`.
- **Task 1.4**: Update `ToolManager` to support dynamic permission mode updates if necessary.

### Step 2: CLI Integration
- **Task 2.1**: Update `InputManager` in `packages/code/src/managers/InputManager.ts` to handle `Shift+Tab` and cycle through modes.
- **Task 2.2**: Add `onPermissionModeChange` callback to `InputManagerCallbacks`.
- **Task 2.3**: Update `useChat` context in `packages/code/src/contexts/useChat.tsx` to expose permission mode and handle changes.
- **Task 2.4**: Update `InputBox` in `packages/code/src/components/InputBox.tsx` to display the current permission mode below the input border (e.g., `Mode: Accept Edits (Shift+Tab to cycle)`).

### Step 3: Configuration & Validation
- **Task 3.1**: Update `configValidator.ts` in `packages/agent-sdk/src/utils/configValidator.ts` to allow `acceptEdits` in `defaultMode`.
- **Task 3.2**: Verify `LiveConfigManager` correctly updates `PermissionManager` on config reload.

