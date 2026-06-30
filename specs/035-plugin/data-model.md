# Data Model: Plugin Support and Marketplace

This document defines the entities and data structures for the plugin support system and the plugin marketplace.

## Entities

### 1. Plugin
Represents a loaded plugin in the system. Extends `PluginManifest` (fields are flat, no nested `components` wrapper).

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Inherited from `PluginManifest`. Unique identifier, used for namespacing. |
| `description` | `string` | Inherited from `PluginManifest`. |
| `version` | `string` | Inherited from `PluginManifest`. Semantic version. |
| `author` | `{ name: string }` (Optional) | Inherited from `PluginManifest`. Information about the plugin author. |
| `path` | `string` | Absolute path to the plugin directory. |
| `commands` | `CustomSlashCommand[]` | Slash commands provided by the plugin. |
| `skills` | `Skill[]` | Skills provided by the plugin. |
| `agents` | `SubagentConfiguration[]` | Subagent definitions provided by the plugin. |
| `lspConfig` | `LspConfig` (Optional) | LSP server configuration. |
| `mcpConfig` | `McpConfig` (Optional) | MCP server configuration. |
| `hooksConfig` | `PartialHookConfiguration` (Optional) | Hook event handlers. |

### 2. PluginManifest
The structure of the `.wave-plugin/plugin.json` file.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Required. Lowercase, alphanumeric + hyphens. |
| `description` | `string` | Required. |
| `version` | `string` | Required. |
| `author` | `{ name: string }` (Optional) | Information about the plugin author. |

### 3. PluginConfig
Configuration for loading a plugin, passed via `AgentOptions.plugins`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `type` | `"local"` | Currently only local plugins are supported. |
| `path` | `string` | Filesystem path to the plugin directory. |

### 4. WaveConfiguration (Updated)
The existing `WaveConfiguration` interface includes plugin-related fields.

| Field | Type | Description |
| :--- | :--- | :--- |
| `enabledPlugins` | `Record<string, boolean>` | A mapping of plugin IDs (`name@marketplace`) to their enabled state. |
| `marketplaces` | `Record<string, MarketplaceConfig>` | Registered marketplaces with their source and settings. |

### 5. MarketplaceConfig
Configuration for a marketplace entry in `WaveConfiguration`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `source` | `MarketplaceSource` | The marketplace source (directory, GitHub, or Git). |
| `autoUpdate` | `boolean` (Optional) | Whether auto-update is enabled. |

### 6. Scope
| Value | Description |
| :--- | :--- |
| `user` | Global configuration in `~/.wave/settings.json`. |
| `project` | Project-specific configuration in `.wave/settings.json`. |
| `local` | Local override configuration in `.wave/settings.local.json`. |

### 7. MarketplaceSource (Discriminated Union)
The location of a marketplace. Uses discriminated union for type safety.

| Variant | Fields | Description |
| :--- | :--- | :--- |
| `directory` | `{ source: "directory"; path: string }` | Local filesystem path. |
| `github` | `{ source: "github"; repo: string; ref?: string }` | GitHub `owner/repo` shorthand. Optional `ref` for branch/tag. |
| `git` | `{ source: "git"; url: string; ref?: string }` | Full Git repository URL. Optional `ref` for branch/tag. |

### 8. MarketplacePluginEntry (External)
Represents a plugin entry within a `marketplace.json` manifest.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `source` | `string` | Relative path to plugin source (e.g., `"./plugins/commit-commands"`) **or** a Git URL (`http://`, `https://`, `git@`, `ssh://`). |
| `description` | `string` | Brief description of the plugin. |

### 9. MarketplacePluginStatus
Aggregates a `MarketplacePluginEntry` with installation status for UI display.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Inherited from `MarketplacePluginEntry`. |
| `source` | `string` | Inherited from `MarketplacePluginEntry`. |
| `description` | `string` | Inherited from `MarketplacePluginEntry`. |
| `marketplace` | `string` | Name of the marketplace. |
| `installed` | `boolean` | Whether the plugin is currently installed. |
| `version` | `string` (Optional) | Installed version. |
| `cachePath` | `string` (Optional) | Path to cached plugin files. |
| `projectPath` | `string` (Optional) | Project path for project-scoped installs. |
| `scope` | `Scope` (Optional) | Installation scope. |

### 10. KnownMarketplace (Internal)
Stored in `~/.wave/plugins/known_marketplaces.json`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique name of the marketplace. |
| `source` | `MarketplaceSource` | Discriminated union defining the location. |
| `isBuiltin` | `boolean` (Optional) | Flag to indicate if this marketplace is provided by the system. |
| `autoUpdate` | `boolean` (Optional) | Whether auto-update is enabled. |
| `lastUpdated` | `string` (Optional) | ISO date string of the last successful update. |
| `declaredScope` | `"user" \| "project" \| "local" \| "builtin"` (Optional) | Which scope declared this marketplace. |

### 11. InstalledPlugin (Internal)
Stored in `~/.wave/plugins/installed_plugins.json`. Enabled state is tracked separately via `enabledPlugins` in settings, not on this record.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Name of the plugin. |
| `marketplace` | `string` | Name of the marketplace it was installed from. |
| `version` | `string` | Version of the plugin at the time of installation. |
| `cachePath` | `string` | Absolute path to the cached plugin files in `~/.wave/plugins/cache/`. |
| `scope` | `Scope` (Optional) | Installation scope. |
| `projectPath` | `string` (Optional) | Project path for project-scoped installs. |

### 12. Lock File (Internal)
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

## Disk Layout
```
~/.wave/plugins/
├── installed_plugins.json       # InstalledPlugin registry
├── known_marketplaces.json      # KnownMarketplace registry
├── .lock                        # File-based lock
├── cache/                       # Cached plugin files
│   └── <marketplace>/<plugin>/<version>/
├── marketplaces/                # Cloned marketplace repos
│   └── <owner>/<repo>/
└── tmp/                         # Temporary clone directories
```

## Validation Rules
1. **Manifest Location**: MUST be at `.wave-plugin/plugin.json`.
2. **Component Location**: All component directories (`commands/`, `skills/`, `hooks/`, `agents/`) and config files (`.lsp.json`, `.mcp.json`) MUST be at the plugin root level.
3. **Misplacement Check**: Component directories MUST NOT be inside `.wave-plugin/`.
4. **Plugin ID Format**: Plugin IDs MUST follow the `name@marketplace` format for scope management.
5. **Namespacing**: Both slash commands and agent skills provided by plugins MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:component-name`).
6. **Scope Priority**: `local` > `project` > `user`.
7. **Marketplace Name**: Must be alphanumeric and unique among added marketplaces.
8. **Plugin Name**: Must be lowercase, alphanumeric + hyphens, unique within a marketplace.
9. **Source Path**: Relative paths must be valid within the marketplace directory. Git URL sources must start with `http://`, `https://`, `git@`, or `ssh://`.
10. **Version**: Must follow semantic versioning (e.g., `1.0.0`).
11. **Marketplace Source**: Must be a valid GitHub shorthand (`owner/repo`), a valid Git URL, or an existing local directory path.
12. **Installation Scope**: Must be one of the three supported scopes.
13. **Remote Fetching**: All remote fetching uses `git clone --depth 1`; no direct HTTP file download.
