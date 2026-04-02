# Data Model: Plugin Support and Marketplace

This document defines the entities and data structures for the plugin support system and the plugin marketplace.

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

### 5. KnownMarketplace (Internal)
Stored in `~/.wave/plugins/known_marketplaces.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique name of the marketplace. |
| `source` | `MarketplaceSource` | Union type defining the location (GitHub, Git, or local directory). |
| `isBuiltin` | `boolean` (Optional) | Flag to indicate if this marketplace is provided by the system. |
| `autoUpdate` | `boolean` | Whether auto-update is enabled for this marketplace. |
| `lastUpdated` | `string` | ISO date string of the last successful update. |

### 6. MarketplaceSource
| Field | Type | Description |
| :--- | :--- | :--- |
| `source` | `'directory' \| 'github' \| 'git'` | The type of source. |
| `path` | `string` (for `directory`) | Absolute path to the marketplace root. |
| `repo` | `string` (for `github`) | The `owner/repo` string for GitHub marketplaces. |
| `url` | `string` (for `git`) | Full Git repository URL. |

### 7. MarketplacePluginEntry (External)
Represents a plugin entry within a `marketplace.json` manifest.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `source` | `string` | Relative path to plugin source (e.g., `"./plugins/commit-commands"`). |
| `description` | `string` | Brief description of the plugin. |

### 8. InstalledPlugin (Internal)
Stored in `~/.wave/plugins/installed_plugins.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `marketplace` | `string` | Name of the marketplace it was installed from. |
| `version` | `string` | Version of the plugin at the time of installation. |
| `cachePath` | `string` | Absolute path to the cached plugin files in `~/.wave/plugins/cache/`. |
| `scope` | `'user' \| 'project' \| 'local'` | Installation scope. |
| `isEnabled` | `boolean` | Whether the plugin is enabled in the current scope. |

### 9. Lock File (Internal)
Located at `~/.wave/plugins/.lock`.

Used to synchronize access to `known_marketplaces.json` and `installed_plugins.json` across multiple `wave-agent` processes. It is a re-entrant file-based lock.

## UI State
```typescript
interface PluginManagerState {
  currentView: 'DISCOVER' | 'INSTALLED' | 'MARKETPLACES';
  selectedId: string | null; // Plugin ID or Marketplace ID
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
}
```

## Validation Rules
1. **Manifest Location**: MUST be at `.wave-plugin/plugin.json`.
2. **Component Location**: All component directories (`commands/`, `skills/`, `hooks/`, `agents/`) and config files (`.lsp.json`, `.mcp.json`) MUST be at the plugin root level.
3. **Misplacement Check**: Component directories MUST NOT be inside `.wave-plugin/`.
4. **Plugin ID Format**: Plugin IDs MUST follow the `name@marketplace` format for scope management.
5. **Namespacing**: Both slash commands and agent skills provided by plugins MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:component-name`).
6. **Scope Priority**: `local` > `project` > `user`.
7. **Marketplace Name**: Must be alphanumeric and unique among added marketplaces.
8. **Plugin Name**: Must be alphanumeric and unique within a marketplace.
9. **Source Path**: Must be a valid relative path within the marketplace directory.
10. **Version**: Must follow semantic versioning (e.g., `1.0.0`).
11. **Marketplace Source**: Must be a valid GitHub shorthand (`owner/repo`), a valid Git URL, or an existing local directory path.
12. **Installation Scope**: Must be one of the three supported scopes.
