# Research: Plugin Support and Marketplace

This document consolidates research findings and technical decisions for the plugin support system and the plugin marketplace.

## 1. Plugin Structure and Loading Mechanism
- **Decision**: A plugin will be a directory containing:
    - `.wave-plugin/plugin.json`: Manifest file with `name`, `description`, `version`, and optional `author`.
    - `commands/`: Directory containing Markdown files for slash commands.
    - `skills/`: Directory containing Agent Skills with `SKILL.md` files.
    - `agents/`: Directory containing custom agent definitions.
    - `hooks/`: Directory containing event handlers in `hooks.json`.
    - `.lsp.json`: LSP server configuration.
    - `.mcp.json`: MCP server configuration.
- **Rationale**: Standardized directory structure for all plugin-provided functionality.

## 2. Component Discovery Rules
- **Decision**: All components must be located at the plugin root level, except for `plugin.json` which must be in `.wave-plugin/`.
- **Rationale**: Prevents a common mistake where developers might assume all plugin-related files should go into the hidden `.wave-plugin/` directory.

## 3. Plugin Scope Management
- **Decision**: Add an optional `enabledPlugins` property of type `Record<string, boolean>` to the `WaveConfiguration` interface.
- **Rationale**: Using a record allows for explicit disabling (`false`) which can override an enabled state from a lower-priority scope.
- **Scope Priority**: `local` > `project` > `user`.

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
    2. Copy the plugin source to the temporary directory using `fs.cpSync(src, dest, { recursive: true })`.
    3. Validate the `plugin.json` in the temporary directory.
    4. Move/Rename the temporary directory to the final destination in `~/.wave/plugins/cache/[marketplace]/[plugin]/[version]` using `fs.renameSync`.
- **Rationale**: Native `fs.cpSync` is available in modern Node.js versions and reduces external dependencies. The "copy-then-rename" pattern ensures that a failed installation doesn't leave a partially copied plugin in the active cache.

## 8. GitHub and Git Integration Strategy
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

## 9. Inject Builtin Marketplace in MarketplaceService
- **Decision**: The builtin marketplace `wave-plugins-official` will be injected at the service level in `packages/agent-sdk/src/services/MarketplaceService.ts`.
- **Rationale**: Centralized logic ensures all CLI commands and internal services see the builtin marketplace.

## 10. Marketplace State Management
- **Decision**: Maintain two JSON files in `~/.wave/plugins/`:
    - `known_marketplaces.json`: List of added marketplace paths and names.
    - `installed_plugins.json`: Registry of installed plugins, their versions, and their local cache paths.
- **Rationale**: Simple, human-readable, and easy to manage without a full database.

## 11. Ink-based UI Navigation
- **Decision**: Implement a standalone Ink-based CLI interface triggered by `wave plugin`.
- **Navigation**: Use `Tab` and `Shift+Tab` for main navigation areas (Discover, Installed, Marketplaces).
- **Rationale**: Provides a modern, interactive experience for managing plugins.

## 12. Plugin Loading Logic
- **Decision**: `PluginManager` will be updated to automatically scan `~/.wave/plugins/installed_plugins.json` and load plugins from their cached paths.
- **Rationale**: This allows installed plugins to be available across all sessions without explicit `--plugin-dir` flags.
