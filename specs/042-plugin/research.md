# Research: Plugin Support and Marketplace

This document consolidates research findings and technical decisions for the plugin support system and the plugin marketplace.

## 1. Plugin Structure and Loading Mechanism
- **Decision**: A plugin will be a directory containing:
    - `.wave-plugin/plugin.json`: Manifest file with `name`, `description`, `version`, and optional `author` (with `name` only, no `email`).
    - `commands/`: Directory containing Markdown files for slash commands.
    - `skills/`: Directory containing Agent Skills with `SKILL.md` files.
    - `agents/`: Directory containing custom agent definitions.
    - `hooks/`: Directory containing event handlers in `hooks.json`.
    - `.lsp.json`: LSP server configuration.
    - `.mcp.json`: MCP server configuration.
- **Implementation**: `Plugin` extends `PluginManifest`, merging manifest fields flat. There is no nested `components` wrapper. Component fields are top-level: `commands`, `skills`, `agents`, `lspConfig?`, `mcpConfig?`, `hooksConfig?`.

## 2. Component Discovery Rules
- **Decision**: All components must be located at the plugin root level, except for `plugin.json` which must be in `.wave-plugin/`.
- **Rationale**: Prevents a common mistake where developers might assume all plugin-related files should go into the hidden `.wave-plugin/` directory.

## 3. Plugin Scope Management
- **Decision**: Add an optional `enabledPlugins` property of type `Record<string, boolean>` to the `WaveConfiguration` interface.
- **Rationale**: Using a record allows for explicit disabling (`false`) which can override an enabled state from a lower-priority scope.
- **Scope Priority**: `local` > `project` > `user`.
- **Implementation**: Enabled state is tracked via `enabledPlugins` in settings files, not on the `InstalledPlugin` record. `PluginScopeManager` handles enable/disable via `ConfigurationService`.

## 4. Dynamic Tool Definitions
- **Decision**: Tools that depend on a dynamic list of components (like `Skill` and `Task` tools) will use getters for their `config` property.
- **Rationale**: Ensures that the tool definition always reflects the current state of the system, including components added by plugins.

## 5. Terminology Alignment
- **Decision**: All user-facing and internal documentation/logs will use "Agent" instead of "Claude" to maintain brand neutrality and consistency with the project name "Wave Agent".

## 6. Path Resolution for `~/.wave`
- **Decision**: Use `os.homedir()` and `path.join()` to resolve the base directory.
- **Rationale**: Standard, cross-platform way to handle user home directories in Node.js.

## 7. Atomic Plugin Installation
- **Decision**: Use native `fs` module for file operations.
- **Mechanism**:
    1. Create a unique temporary directory in `~/.wave/plugins/tmp/`.
    2. Clone (for Git sources) or copy (for local sources) the plugin to the temporary directory.
    3. Validate the `plugin.json` in the temporary directory.
    4. Move/Rename the temporary directory to the final destination in `~/.wave/plugins/cache/[marketplace]/[plugin]/[version]` using `fs.renameSync`.
- **Rationale**: Native `fs.cpSync` is available in modern Node.js versions and reduces external dependencies. The "copy/clone-then-rename" pattern ensures that a failed installation doesn't leave a partially copied plugin in the active cache.

## 8. GitHub and Git Integration Strategy
- **Mechanism**: Use `git clone --depth 1 [url]` to clone the repository. GitHub shorthand (`owner/repo`) is automatically resolved to `https://github.com/owner/repo.git`.
- **Local Storage**: Clone to `~/.wave/plugins/marketplaces/[owner]/[repo]`.
- **Branch/Tag Support**: `MarketplaceSource` includes an optional `ref` field on `github` and `git` variants. GitService passes `-b <ref>` to `git clone`.
- **Timeout**: Default 120s, configurable via `WAVE_PLUGIN_GIT_TIMEOUT_MS`.
- **Registry Update**: Update `known_marketplaces.json` with structured `MarketplaceSource` (discriminated union):
  ```json
  {
    "name": "official",
    "source": { "source": "github", "repo": "owner/repo" },
    "autoUpdate": true
  }
  ```
- **Rationale**: Leveraging `git clone` and `git pull` provides a robust way to manage remote content and updates. Discriminated union provides better type safety than optional fields.

## 9. Remote Plugin Fetching (No Direct HTTP Download)
- **Decision**: All remote plugin and marketplace fetching uses `git clone --depth 1`. There is no direct HTTP file download mechanism.
- **Implementation**:
    1. **Marketplace registration**: `git clone` the marketplace repo into `~/.wave/plugins/marketplaces/<repo>/`.
    2. **Plugin install from relative path**: Copy from the marketplace checkout directory.
    3. **Plugin install from Git URL**: If a `MarketplacePluginEntry.source` starts with `http://`, `https://`, `git@`, or `ssh://`, clone the individual plugin repo into `~/.wave/plugins/tmp/clone-<timestamp>`, then move to cache.
- **Rationale**: Git provides version tracking, branch support, and authentication out of the box.

## 10. Inject Builtin Marketplace in MarketplaceService
- **Decision**: The builtin marketplace `wave-plugins-official` (netease-lcap/wave-plugins-official) will be injected at the service level in `packages/agent-sdk/src/services/MarketplaceService.ts`.
- **Rationale**: Centralized logic ensures all CLI commands and internal services see the builtin marketplace.

## 11. Marketplace State Management
- **Decision**: Maintain two JSON files in `~/.wave/plugins/`:
    - `known_marketplaces.json`: List of added marketplaces with `MarketplaceSource`, `lastUpdated`, and `declaredScope`.
    - `installed_plugins.json`: Registry of installed plugins with their versions, cache paths, and optional scope/projectPath.
- **Rationale**: Simple, human-readable, and easy to manage without a full database.
- **Note**: Enabled state is NOT stored in `installed_plugins.json`. It is tracked via `enabledPlugins` in the scoped `settings.json` files.

## 12. Ink-based UI Navigation
- **Decision**: Implement a standalone Ink-based CLI interface triggered by `wave plugin`.
- **Navigation**: Use `Tab` and `Shift+Tab` for main navigation areas (Discover, Installed, Marketplaces).
- **Rationale**: Provides a modern, interactive experience for managing plugins.

## 13. Plugin Loading Logic
- **Decision**: `PluginManager.loadPlugins()` loads in two phases:
    1. Explicitly configured plugins from `AgentOptions.plugins` (higher priority).
    2. Marketplace-installed plugins from `installed_plugins.json`, filtered by `enabledPlugins` across all scopes.
- **Auto-install**: If a plugin is enabled in settings but not found in cache, `loadInstalledPlugins()` will attempt to auto-install it from a known marketplace.
- **Background auto-update**: During `loadInstalledPlugins()`, `MarketplaceService.autoUpdateAll()` runs in the background for marketplaces with `autoUpdate: true`.
- **Rationale**: This allows installed plugins to be available across all sessions without explicit `--plugin-dir` flags, and keeps marketplaces up-to-date automatically.

## 14. PluginCore High-Level API
- **Decision**: `PluginCore` (in `packages/agent-sdk/src/core/plugin.ts`) provides a unified API for all plugin and marketplace operations.
- **Methods**: `installPlugin`, `uninstallPlugin`, `enablePlugin`, `disablePlugin`, `updatePlugin`, `listPlugins`, `addMarketplace`, `removeMarketplace`, `updateMarketplace`, `listMarketplaces`, `toggleAutoUpdate`, `getInstalledPlugins`, `getMergedEnabledPlugins`, `findPluginScope`, `removeEnabledPlugin`.
- **Rationale**: Single entry point simplifies both CLI commands and UI hooks. Orchestrates `PluginManager`, `PluginScopeManager`, `MarketplaceService`, and `ConfigurationService`.

## 15. Initialization Flow
- **Decision**: Plugin loading is triggered during `Agent.create()` via `InitializationService.initialize()`.
- **Flow**:
    1. `pluginManager.loadPlugins(agentOptions.plugins)` — loads explicit + installed plugins
    2. After configuration is resolved: `pluginManager.updateEnabledPlugins(config.enabledPlugins)` — pushes scoped enabled state
- **Rationale**: Ensures plugins are loaded before the agent session starts, and configuration-driven enable/disable is applied after settings are resolved.
