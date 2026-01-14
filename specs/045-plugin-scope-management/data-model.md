# Data Model: Plugin Scope Management

## Entities

### WaveConfiguration (Updated)

The existing `WaveConfiguration` interface in `packages/agent-sdk/src/types/hooks.ts` will be updated to include `enabledPlugins`.

| Field | Type | Description |
|-------|------|-------------|
| `enabledPlugins` | `Record<string, boolean>` | A mapping of plugin IDs (`name@marketplace`) to their enabled state (`true` for enabled, `false` for disabled). |

**Rationale for `Record<string, boolean>` over `string[]`**:
The user spec explicitly requested:
```json
"enabledPlugins": {
  "review-plugin@my-plugins": true
}
```
Using a record allows for explicit disabling (`false`) which can override an enabled state from a lower-priority scope.

### Scope (Enum/Type)

| Value | Description |
|-------|-------------|
| `user` | Global configuration in `~/.wave/settings.json` |
| `project` | Project-specific configuration in `.wave/settings.json` |
| `local` | Local override configuration in `.wave/settings.local.json` |

## Validation Rules

1. **Plugin ID Format**: Plugin IDs MUST follow the `name@marketplace` format.
2. **Boolean Values**: Values in `enabledPlugins` MUST be booleans.
3. **Scope Priority**: `local` > `project` > `user`.

## State Transitions

### Enable Plugin
1. Identify target scope (default: `user`).
2. Load `settings.json` for that scope.
3. Set `enabledPlugins["plugin@marketplace"] = true`.
4. Save `settings.json`.

### Disable Plugin
1. Identify target scope (default: `user`).
2. Load `settings.json` for that scope.
3. Set `enabledPlugins["plugin@marketplace"] = false`.
4. Save `settings.json`.

### Install Plugin
1. Perform installation (copy to cache).
2. Identify target scope (default: `user`).
3. Load `settings.json` for that scope.
4. Set `enabledPlugins["plugin@marketplace"] = true`.
5. Save `settings.json`.
