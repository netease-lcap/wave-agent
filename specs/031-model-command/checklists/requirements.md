# Requirements Checklist: /model Command

This document provides a checklist for implementing and verifying the `/model` slash command and UI Model Selector.

## 1. SDK Support

- [x] Add `onModelChange` callback to `AgentCallbacks` interface.
- [x] Implement `setModel(model: string)` in `ConfigurationService` to update session options.
- [x] Implement `getConfiguredModels(): string[]` in `ConfigurationService`.
    - [x] Includes default fallback models.
    - [x] Includes current model from options/environment.
    - [x] Includes model names from merged `settings.json`.
- [x] Expose `setModel` and `getConfiguredModels` in the `Agent` class.
- [x] Ensure `onModelChange` is triggered on model switch.

## 2. CLI State Management

- [x] Add `showModelSelector` to `InputState`.
- [x] Add `SET_SHOW_MODEL_SELECTOR` to `InputAction` and handle in `inputReducer`.
- [x] Update `useInputManager` to expose state and setters.
- [x] Update `handleCommandSelect` in `inputHandlers.ts` to open the selector on `/model`.

## 3. UI Implementation

- [x] Register `/model` in `AVAILABLE_COMMANDS`.
- [x] Create `ModelSelector.tsx` component.
    - [x] Displays list of models.
    - [x] Keyboard navigation (Up/Down Arrow).
    - [x] Selection (Enter) and cancellation (Escape).
    - [x] Highlights current model.
- [x] Integrate `ModelSelector` into `InputBox.tsx`.
- [x] Update `useChat` context to track and expose model state.

## 4. Verification

- [x] Manual: `/model` command opens the UI.
- [x] Manual: Arrow keys navigate the list.
- [x] Manual: Enter selects a model and closes UI.
- [x] Manual: Escape closes UI without change.
- [x] Manual: Selection persists for the session.
- [x] Manual: Selection is reflected in `/status` command.
- [x] Automated: Unit tests for SDK configuration methods.
- [x] Automated: Unit tests for `inputReducer`.
