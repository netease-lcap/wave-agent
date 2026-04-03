# Model Selection API Contracts

## ConfigurationService (Internal SDK API)

### `setModel(model: string): void`
Sets the active model ID in the current session options.

### `getConfiguredModels(): string[]`
Returns a unique list of model IDs from all configuration sources:
1. Default fallback models
2. Environment variables (`WAVE_MODEL`, `WAVE_FAST_MODEL`)
3. Merged `settings.json` (user and project level)

## Agent (Public SDK API)

### `setModel(model: string): void`
Public API to switch models. Updates internal configuration and triggers `onModelChange` callback if provided.

### `getConfiguredModels(): string[]`
Public API to get the list of selectable models for the UI.

## Slash Command

### `/model`
- **Input**: None (triggers UI selection)
- **Action**:
    1. Fetch all configured models via `getConfiguredModels()`.
    2. Display `ModelSelector` UI with the list.
    3. On selection, call `setModel(selectedModel)`.
    4. Close the selector and notify user of the change.

## InputState (CLI State)

### `showModelSelector: boolean`
Controls the visibility of the model selection UI. Set to `true` when `/model` command is invoked, `false` when selection is made or cancelled.
