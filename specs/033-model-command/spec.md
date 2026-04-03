# /model Command Spec

The `/model` command allows users to interactively switch between configured AI models within the CLI. It opens a dedicated UI component (Model Selector) that lists available models, allowing the user to select one using keyboard navigation.

## Goals

- Provide an interactive, visual way to switch AI models.
- Support models configured in `settings.json` (user and project levels).
- Ensure the selected model is used for subsequent AI interactions in the current session.
- Provide clear feedback in the UI about the currently active model.

## User Experience

1. User types `/model` and presses Enter, or selects `model` from the slash command menu.
2. A `ModelSelector` UI component appears at the bottom of the interface.
3. The component displays a list of available models:
    - The currently active model is marked with `(current)` in green.
    - A cursor `▶` indicates the currently focused item.
4. User navigates the list using **Up/Down Arrow** keys.
5. User confirms the selection by pressing **Enter**.
6. User can cancel and close the selector by pressing **Escape**.
7. Upon selection:
    - The selector closes.
    - The active model for the session is updated.
    - The change is reflected in the `/status` command output.

## Implementation Details

### Agent SDK (`packages/agent-sdk`)

- **`AgentCallbacks`**: 
    - Added `onModelChange?: (model: string) => void` to notify the UI of model updates.
    - Added `onConfiguredModelsChange?: (models: string[]) => void` to notify the UI when configured models list changes (e.g., after config reload).
- **`ConfigurationService`**: 
    - Added `setModel(model: string)` to update the session's active model in the internal options.
    - Added `getConfiguredModels(): string[]` to aggregate models from `settings.json`, environment variables, and defaults.
- **`Agent`**:
    - Exposed `setModel(model: string)` which updates the configuration and triggers the `onModelChange` callback.
    - Exposed `getConfiguredModels()` to provide the list of selectable models to the UI.

### CLI UI (`packages/code`)

- **`inputReducer`**: Added `showModelSelector: boolean` to `InputState` to control the visibility of the selector.
- **`inputHandlers`**: Intercepts the `model` slash command to set `showModelSelector` to `true`.
- **`useInputManager`**: Exposes `showModelSelector` and `setShowModelSelector` for component consumption.
- **`useChat`**: 
    - Tracks `currentModel` and `configuredModels` state.
    - Implements the `onModelChange` callback during agent initialization to sync state.
    - Provides `setModel` and `getConfiguredModels` methods to components.
- **`ModelSelector`**: A new Ink component that renders the model list and handles keyboard navigation (`Up`, `Down`, `Enter`, `Esc`).
- **`InputBox`**: Updated to render `ModelSelector` when `showModelSelector` is active, following the pattern of other managers (MCP, Background Tasks).
- **`StatusCommand`**: Displays the active model name under the "Model:" field.
