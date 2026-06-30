# Research: /model Command

## Decision: Interactive UI Selector vs. Simple Prompt
- **Rationale**: An interactive UI selector provides a better user experience by showing all available models at a glance, highlighting the current model, and allowing keyboard navigation without typing the full model name.
- **Alternatives considered**: 
    - Simple text prompt: Rejected because users would need to know exact model identifiers.
    - Dropdown menu: Rejected as Ink doesn't have native dropdown support and it would add unnecessary complexity.

## Decision: Configuration Priority (settings.json > environment > defaults)
- **Rationale**: This follows the existing configuration precedence in the agent. Users should be able to override defaults at both the project level (settings.json in project) and user level (settings.json in home directory).
- **Alternatives considered**: 
    - Flat list with no priority: Rejected because it would be confusing for users who expect their custom configurations to take precedence.

## Decision: Session-Level Model Switching
- **Rationale**: Switching the model only for the current session (not persisted to settings.json) allows users to experiment without affecting their default configuration.
- **Alternatives considered**: 
    - Persistent switch: Rejected because users might accidentally change their default model and forget to revert.

## Decision: Single Model Selection (No Fast/Strong Model Pairing)
- **Rationale**: The existing architecture already handles model selection based on task complexity. Adding another layer of selection would overcomplicate the UI without significant benefit.
- **Alternatives considered**: 
    - Fast/Strong model toggle: Rejected as it duplicates existing behavior in the agent's auto-selection logic.

## Integration Points
- `ConfigurationService`: Core logic for managing model configuration and retrieving available models.
- `Agent`: Exposes `setModel` and `getConfiguredModels` to the UI layer.
- `InputManager`: Handles the `/model` command and controls the `showModelSelector` state.
- `useChat`: Syncs model state between agent and UI via `onModelChange` callback.
- `ModelSelector`: Ink component for rendering the interactive model selection UI.
