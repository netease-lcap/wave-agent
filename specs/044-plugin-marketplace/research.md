# Research: Plugin Marketplace and Management UI

This document consolidates research findings and technical decisions for the plugin marketplace and management UI.

## 1. Path Resolution for `~/.wave`
- **Decision**: Use `os.homedir()` and `path.join()` to resolve the base directory.
- **Rationale**: Standard, cross-platform way to handle user home directories in Node.js.

## 2. Atomic Plugin Installation
- **Decision**: Use native `fs` module for file operations.
- **Mechanism**:
    1. Create a unique temporary directory in `~/.wave/plugins/tmp/`.
    2. Copy the plugin source to the temporary directory using `fs.cpSync(src, dest, { recursive: true })`.
    3. Validate the `plugin.json` in the temporary directory.
    4. Move/Rename the temporary directory to the final destination in `~/.wave/plugins/cache/[marketplace]/[plugin]/[version]` using `fs.renameSync`.
- **Rationale**: Native `fs.cpSync` is available in modern Node.js versions and reduces external dependencies. The "copy-then-rename" pattern ensures that a failed installation doesn't leave a partially copied plugin in the active cache.

## 3. GitHub and Git Integration Strategy
- **Mechanism**: Use `git clone --depth 1 [url]` to clone the repository.
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
- **Rationale**: Leveraging `git clone` and `git pull` provides a robust way to manage remote content and updates.

## 4. Inject Builtin Marketplace in MarketplaceService
- **Decision**: The builtin marketplace `wave-plugins-official` will be injected at the service level in `packages/agent-sdk/src/services/MarketplaceService.ts`.
- **Rationale**: Centralized logic ensures all CLI commands and internal services see the builtin marketplace.

## 5. Marketplace State Management
- **Decision**: Maintain two JSON files in `~/.wave/plugins/`:
    - `known_marketplaces.json`: List of added marketplace paths and names.
    - `installed_plugins.json`: Registry of installed plugins, their versions, and their local cache paths.
- **Rationale**: Simple, human-readable, and easy to manage without a full database.

## 6. Ink-based UI Navigation
- **Decision**: Implement a standalone Ink-based CLI interface triggered by `wave plugin`.
- **Navigation**: Use `Tab` and `Shift+Tab` for main navigation areas (Discover, Installed, Marketplaces).
- **Rationale**: Provides a modern, interactive experience for managing plugins.

## 7. Plugin Loading Logic
- **Decision**: `PluginManager` will be updated to automatically scan `~/.wave/plugins/installed_plugins.json` and load plugins from their cached paths.
- **Rationale**: This allows installed plugins to be available across all sessions without explicit `--plugin-dir` flags.
