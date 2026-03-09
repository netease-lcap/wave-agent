# Research: Plugin Support

This document consolidates research findings and technical decisions for the plugin support system.

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
