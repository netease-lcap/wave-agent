# Data Model: /model Command

## Entities

### ModelConfig
Represents a model configuration.

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | The primary model identifier. |
| `fastModel` | `string` | The fast/lightweight model identifier. |
| `maxTokens` | `number` (optional) | Maximum tokens for responses. |
| `permissionMode` | `PermissionMode` (optional) | Permission mode for the model. |

### ModelEntry
A model entry for display in the selector UI.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The model identifier. |
| `isCurrent` | `boolean` | Whether this is the currently active model. |

## Relationships
- `ModelEntry` is derived from `ModelConfig` and the current session state.
- Multiple `ModelEntry` objects are aggregated from various configuration sources.

## Validation Rules
- Model IDs must be non-empty strings.
- The selected model must exist in the configured models list.
