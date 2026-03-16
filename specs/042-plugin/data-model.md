# Data Model: Plugin Support

This document defines the entities and data structures for the plugin support system.

## Entities

### 1. Plugin
Represents a loaded plugin in the system.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique identifier, used for namespacing. |
| `description` | `string` | Brief description of the plugin. |
| `version` | `string` | Semantic version. |
| `author` | `object` (Optional) | Information about the plugin author. |
| `path` | `string` | Absolute path to the plugin directory. |
| `manifest` | `PluginManifest` | The static definition of the plugin. |
| `components` | `object` | List of components provided by the plugin. |
| `skills` | `Skill[]` | List of skills provided by the plugin. |

### 2. PluginManifest
The structure of the `.wave-plugin/plugin.json` file.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Required. |
| `description` | `string` | Required. |
| `version` | `string` | Required. |
| `author` | `object` (Optional) | Information about the plugin author. |

### 3. WaveConfiguration (Updated)
The existing `WaveConfiguration` interface will be updated to include `enabledPlugins`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `enabledPlugins` | `Record<string, boolean>` | A mapping of plugin IDs (`name@marketplace`) to their enabled state. |

### 4. Scope
| Value | Description |
| :--- | :--- |
| `user` | Global configuration in `~/.wave/settings.json`. |
| `project` | Project-specific configuration in `.wave/settings.json`. |
| `local` | Local override configuration in `.wave/settings.local.json`. |

## Validation Rules
1. **Manifest Location**: MUST be at `.wave-plugin/plugin.json`.
2. **Component Location**: All component directories (`commands/`, `skills/`, `hooks/`, `agents/`) and config files (`.lsp.json`, `.mcp.json`) MUST be at the plugin root level.
3. **Misplacement Check**: Component directories MUST NOT be inside `.wave-plugin/`.
4. **Plugin ID Format**: Plugin IDs MUST follow the `name@marketplace` format for scope management.
5. **Namespacing**: Both slash commands and agent skills provided by plugins MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:component-name`).
6. **Scope Priority**: `local` > `project` > `user`.
