# Data Model: Plugin Marketplace and Management UI

This document defines the entities and data structures for the plugin marketplace and management UI.

## Entities

### 1. KnownMarketplace (Internal)
Stored in `~/.wave/plugins/known_marketplaces.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique name of the marketplace. |
| `source` | `MarketplaceSource` | Union type defining the location (GitHub, Git, or local directory). |
| `isBuiltin` | `boolean` (Optional) | Flag to indicate if this marketplace is provided by the system. |
| `autoUpdate` | `boolean` | Whether auto-update is enabled for this marketplace. |

### 2. MarketplaceSource
| Field | Type | Description |
| :--- | :--- | :--- |
| `source` | `'directory' \| 'github' \| 'git'` | The type of source. |
| `path` | `string` (for `directory`) | Absolute path to the marketplace root. |
| `repo` | `string` (for `github`) | The `owner/repo` string for GitHub marketplaces. |
| `url` | `string` (for `git`) | Full Git repository URL. |

### 3. MarketplacePluginEntry (External)
Represents a plugin entry within a `marketplace.json` manifest.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `source` | `string` | Relative path to plugin source (e.g., `"./plugins/commit-commands"`). |
| `description` | `string` | Brief description of the plugin. |

### 4. InstalledPlugin (Internal)
Stored in `~/.wave/plugins/installed_plugins.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `marketplace` | `string` | Name of the marketplace it was installed from. |
| `version` | `string` | Version of the plugin at the time of installation. |
| `cachePath` | `string` | Absolute path to the cached plugin files in `~/.wave/plugins/cache/`. |
| `scope` | `'user' \| 'project' \| 'local'` | Installation scope. |
| `isEnabled` | `boolean` | Whether the plugin is enabled in the current scope. |

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
1. **Marketplace Name**: Must be alphanumeric and unique among added marketplaces.
2. **Plugin Name**: Must be alphanumeric and unique within a marketplace.
3. **Source Path**: Must be a valid relative path within the marketplace directory.
4. **Version**: Must follow semantic versioning (e.g., `1.0.0`).
5. **Marketplace Source**: Must be a valid GitHub shorthand (`owner/repo`), a valid Git URL, or an existing local directory path.
6. **Installation Scope**: Must be one of the three supported scopes.
