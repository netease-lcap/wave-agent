# Research: GitHub Marketplace Support

## Current Implementation Analysis

- **Marketplace Registry**: `~/.wave/plugins/known_marketplaces.json` stores registered marketplaces.
- **Plugin Registry**: `~/.wave/plugins/installed_plugins.json` stores installed plugins.
- **Marketplace Manifest**: `.wave-plugin/marketplace.json` in the marketplace root.
- **Plugin Manifest**: `.wave-plugin/plugin.json` in the plugin root.
- **Installation**: Plugins are copied from their source to `~/.wave/plugins/cache/[marketplace]/[plugin]/[version]`.

## Decision: GitHub Integration Strategy

### 1. Adding a GitHub Marketplace
- **Format**: `owner/repo`
- **Mechanism**: Use `git clone --depth 1 https://github.com/[owner]/[repo].git` to clone the repository.
- **Local Storage**: Clone to `~/.wave/plugins/marketplaces/[owner]/[repo]`.
- **Registry Update**: Update `known_marketplaces.json` to use a structured `source` object:
  ```json
  {
    "name": "official",
    "source": {
      "source": "github",
      "repo": "owner/repo"
    }
  }
  ```
  For local directories:
  ```json
  {
    "name": "local",
    "source": {
      "source": "directory",
      "path": "/path/to/marketplace"
    }
  }
  ```

### 2. Updating Marketplaces
- **Command**: `wave plugin marketplace update [name]`
- **GitHub**: Run `git pull` in the marketplace directory (resolved from the `repo` in the `source` object).
- **Local**: Re-read the `marketplace.json` from the `path` in the `source` object.
- **All**: Iterate through all known marketplaces and update them.

### 3. Installing Plugins from Marketplace
- **Mechanism**: 
  1. Resolve the marketplace root directory.
  2. Read `marketplace.json`.
  3. For each plugin, the `source` is a relative path (e.g., `"source": "./plugins/commit-commands"`).
  4. Resolve the absolute path of the plugin source relative to the marketplace root.
  5. Use the existing logic to copy files to the cache and register the plugin.

## Rationale
- **Completeness**: Cloning the marketplace repository ensures we have all local files if the marketplace contains relative plugin sources.
- **Simplicity**: Leveraging `git clone` and `git pull` provides a robust way to manage remote content and updates.
- **Consistency**: Reusing the existing cache and registry structure minimizes changes to the core logic.

## Alternatives Considered
- **HTTP Fetch for Manifest**: Rejected per user requirement to have the full repository cloned locally.
- **GitHub API for Plugin Files**: Rejected because it's complex to fetch multiple files and directories via API compared to `git clone`.

## Dependencies
- `git` CLI must be available in the environment.
- `node-fetch` or similar for HTTP requests (check if already available in `agent-sdk`).
