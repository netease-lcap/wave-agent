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

### Model Persistence (settings.json)

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string?` | Persisted model selection from `/model` command |

### Model Resolution Priority (highest to lowest)

1. In-memory override (set during current session via `/model`)
2. `settings.json` `model` field (user's explicit choice; overrides admin's `env.WAVE_MODEL` default)
3. Remote managed `model` scalar field (admin enforces — overwrites local via `mergeRemoteSettings`)
4. `WAVE_MODEL` environment variable (admin default via `env.WAVE_MODEL`, or shell fallback)
5. Provider default

## Validation Rules
- Model IDs must be non-empty strings.
- The selected model must exist in the configured models list.
