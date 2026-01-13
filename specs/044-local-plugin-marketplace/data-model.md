# Data Model: Local Plugin Marketplace

This document defines the entities and data structures for the Local Plugin Marketplace.

## Entities

### 1. Marketplace (External)
Represents the `marketplace.json` file provided by a marketplace creator.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique name of the marketplace. |
| `owner` | `object` | Information about the marketplace owner. |
| `plugins` | `MarketplacePlugin[]` | List of plugins available in this marketplace. |

### 2. MarketplacePlugin (External)
Represents a plugin entry within a marketplace.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `source` | `string` | Relative path to the plugin directory from the marketplace root. |
| `description` | `string` | Brief description of the plugin. |

### 3. KnownMarketplace (Internal)
Stored in `~/.wave/plugins/known_marketplaces.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | The name assigned to the marketplace when added. |
| `path` | `string` | Absolute path to the local marketplace directory. |

### 4. InstalledPlugin (Internal)
Stored in `~/.wave/plugins/installed_plugins.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `marketplace` | `string` | Name of the marketplace it was installed from. |
| `version` | `string` | Version of the plugin at the time of installation. |
| `cachePath` | `string` | Absolute path to the cached plugin files in `~/.wave/plugins/cache/`. |

## Validation Rules

1. **Marketplace Name**: Must be alphanumeric and unique among added marketplaces.
2. **Plugin Name**: Must be alphanumeric.
3. **Source Path**: Must be a valid relative path within the marketplace directory.
4. **Version**: Must follow semantic versioning (e.g., `1.0.0`).
