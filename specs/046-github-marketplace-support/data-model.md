# Data Model: GitHub Marketplace Support

## Entities

### KnownMarketplace
Represents a registered marketplace in the system.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique name of the marketplace. |
| `source` | `MarketplaceSource` | The source configuration of the marketplace. |

### MarketplaceSource
| Field | Type | Description |
|-------|------|-------------|
| `source` | `'directory' \| 'github'` | The type of source. |
| `path` | `string` (for `directory`) | Absolute path to the marketplace root. |
| `repo` | `string` (for `github`) | The `owner/repo` string for GitHub marketplaces. |

### MarketplacePluginEntry
Represents a plugin entry within a `marketplace.json` manifest.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Name of the plugin. |
| `source` | `string` | Relative path to plugin source (e.g., `"./plugins/commit-commands"`). |
| `description` | `string` | Brief description of the plugin. |

## Validation Rules
- `name` must be unique across all registered marketplaces.
- `repo` must follow the `owner/repo` format.
- For `local` source, `path` must exist and contain `.wave-plugin/marketplace.json`.
- For `github` source, `repo` must be a valid GitHub repository.

## State Transitions
1. **Add Marketplace**:
   - Input: `path` or `owner/repo`.
   - If `owner/repo`: Set `source` to `{ source: 'github', repo: 'owner/repo' }`, clone repository to `~/.wave/plugins/marketplaces/[owner]/[repo]`.
   - If `path`: Set `source` to `{ source: 'directory', path: absolutePath }`, validate manifest.
2. **Update Marketplace**:
   - If `github`: Run `git pull` in the marketplace directory (resolved from `repo`).
   - If `directory`: Re-read manifest from `path`.
3. **Install Plugin**:
   - Resolve marketplace root directory.
   - Resolve plugin source path relative to marketplace root.
   - Copy from that local directory to the versioned cache.
