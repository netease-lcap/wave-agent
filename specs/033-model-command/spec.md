# Feature Specification: /model Command

**Feature Branch**: `033-model-command`
**Created**: 2026-04-16
**Input**: "Allow users to interactively switch AI models via /model command with a visual selector UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch model interactively (Priority: P1)

As a CLI user, I want to type `/model` and select a different AI model from a list so I can change the model for subsequent interactions without restarting.

**Acceptance Scenarios**:

1. **Given** the user types `/model` and presses Enter, **Then** a `ModelSelector` UI component appears listing all configured models.
2. **Given** the model list is displayed, **When** the user navigates with Up/Down arrows and presses Enter, **Then** the selected model becomes the active model and the selector closes.
3. **Given** the model list is displayed, **When** the user presses Escape, **Then** the selector closes without changing the model.
4. **Given** the model list is displayed, **Then** the currently active model is marked with `(current)` in green and a cursor `▶` indicates the focused item.

---

### User Story 2 - Model selection persists in session (Priority: P1)

As a CLI user, I want the selected model to remain active for the rest of the session so all subsequent AI interactions use my chosen model.

**Acceptance Scenarios**:

1. **Given** the user has selected a new model via `/model`, **Then** the `ConfigurationService` updates the active model and subsequent AI calls use the new model.
2. **Given** the user has selected a new model, **Then** the `onModelChange` callback fires so the UI and status line reflect the updated model.

---

### User Story 3 - Discover available models (Priority: P2)

As a CLI user, I want to see which models are available from my configuration so I know what options I can switch to.

**Acceptance Scenarios**:

1. **Given** models are configured in `settings.json` (user and project levels) and environment variables, **Then** `getConfiguredModels()` aggregates all sources and the `ModelSelector` displays them.
2. **Given** the configured models list changes (e.g., after config reload), **Then** the `onConfiguredModelsChange` callback fires and the model list is refreshed.

---

### Edge Cases

- **What happens if only one model is configured?** The selector still opens but shows a single item.
- **What happens if no models are configured?** The selector shows an empty list or a message indicating no models are available.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST provide a `/model` slash command that opens a `ModelSelector` UI component.
- **FR-002**: The `ModelSelector` MUST display all models returned by `ConfigurationService.getConfiguredModels()`.
- **FR-003**: The `ModelSelector` MUST highlight the currently active model with `(current)` in green and show a cursor `▶` on the focused item.
- **FR-004**: The user MUST be able to navigate the model list with Up/Down arrow keys and confirm with Enter.
- **FR-005**: Pressing Escape MUST close the `ModelSelector` without changing the model.
- **FR-006**: Upon model selection, `ConfigurationService.setModel()` MUST update the active model for the session.
- **FR-007**: The `AgentCallbacks` MUST include `onModelChange?: (model: string) => void` to notify the UI of model updates.
- **FR-008**: The `AgentCallbacks` MUST include `onConfiguredModelsChange?: (models: string[]) => void` to notify the UI when the model list changes.
- **FR-009**: The `Agent` MUST expose `setModel(model: string)` which updates the configuration and triggers the `onModelChange` callback.
- **FR-010**: The `Agent` MUST expose `getConfiguredModels()` to provide the list of selectable models.
- **FR-011**: The `StatusCommand` MUST display the active model name under the "Model:" field.
- **FR-012**: System MUST persist the selected model to `~/.wave/settings.json` when the user selects a model via `/model`.
- **FR-013**: Model resolution priority MUST be: in-memory override > `settings.json` persisted model > `WAVE_MODEL` env var. Remote managed `model` scalar field overrides local in merge; remote `env.WAVE_MODEL` serves as admin default that user's `settings.json` `model` field can override.
