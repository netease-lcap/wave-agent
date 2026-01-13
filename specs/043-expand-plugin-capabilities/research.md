# Research: Expand Plugin Capabilities

## Decision: Plugin Component Discovery and Loading

### Summary
The plugin system will be expanded to support multiple component types (Skills, LSP, MCP, Hooks, Agents, Commands) by implementing a standardized discovery and loading mechanism in `PluginLoader` and `PluginManager`.

### Component Discovery Rules
All components must be located at the plugin root level, except for `plugin.json` which must be in `.wave-plugin/`.

| Component | Location | Discovery Method |
|-----------|----------|------------------|
| Manifest | `.wave-plugin/plugin.json` | Direct file read |
| Skills | `skills/*/SKILL.md` | Directory scan |
| LSP | `.lsp.json` | Direct file read |
| MCP | `.mcp.json` | Direct file read |
| Hooks | `hooks/hooks.json` | Direct file read |
| Agents | `agents/` | Directory scan (future implementation) |
| Commands | `commands/**/*.md` | Recursive directory scan |

### Implementation Details

#### 1. PluginManifest Evolution
The `PluginManifest` interface in `packages/agent-sdk/src/types/plugins.ts` will be updated to include optional fields for these components, although discovery will primarily be file-system based.

#### 2. PluginLoader Enhancements
`PluginLoader` will be updated with new static methods:
- `loadSkills(pluginPath: string)`: Scans `skills/` directory and parses `SKILL.md` files using `parseSkillFile`.
- `loadLspConfig(pluginPath: string)`: Reads and parses `.lsp.json`.
- `loadMcpConfig(pluginPath: string)`: Reads and parses `.mcp.json`.
- `loadHooksConfig(pluginPath: string)`: Reads and parses `hooks/hooks.json`.

#### 3. PluginManager Integration
`PluginManager.loadPlugins` will be updated to:
1. Load the manifest.
2. Load all components using the new `PluginLoader` methods.
3. Register these components with their respective managers (`SkillManager`, `LspManager`, `McpManager`, `HookManager`, `SlashCommandManager`).

### Rationale
- **Consistency**: Follows the existing pattern of `PluginLoader` for discovery and `PluginManager` for lifecycle management.
- **Separation of Concerns**: Managers remain responsible for the runtime behavior of components, while the plugin system handles their discovery and registration.
- **Validation**: Centralized validation in `PluginLoader` ensures that plugins follow the required directory structure.

### Alternatives Considered
- **Manifest-based registration**: Requiring all components to be explicitly listed in `plugin.json`. Rejected because file-system discovery is more developer-friendly and consistent with how `commands/` and `skills/` already work in the core system.
- **Dynamic loading on demand**: Loading components only when needed. Rejected because most components (LSP, MCP, Hooks) need to be registered at startup to function correctly.

## Decision: Terminology Alignment

### Summary
All user-facing and internal documentation/logs will use "Agent" instead of "Claude" to maintain brand neutrality and consistency with the project name "Wave Agent".

### Rationale
The project is named "Wave Agent", and using "Agent" as the generic term is more appropriate for a customizable agent framework.

## Decision: Directory Structure Enforcement

### Summary
The system will explicitly validate that no component directories (like `skills/`, `commands/`, etc.) are placed inside the `.wave-plugin/` directory.

### Rationale
Prevents a common mistake where developers might assume all plugin-related files should go into the hidden `.wave-plugin/` directory.
