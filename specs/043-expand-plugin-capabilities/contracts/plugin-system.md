# Internal API Contracts: Plugin System Expansion

## PluginLoader (Static Service)

### `loadManifest(pluginPath: string): Promise<PluginManifest>`
Loads and validates the `plugin.json` from `.wave-plugin/`.
- **Throws**: If manifest is missing or invalid.

### `loadSkills(pluginPath: string): Promise<SkillMetadata[]>`
Scans `skills/` directory for `SKILL.md` files.
- **Returns**: Array of skill metadata.

### `loadLspConfig(pluginPath: string): Promise<LspConfig | undefined>`
Reads `.lsp.json` from plugin root.

### `loadMcpConfig(pluginPath: string): Promise<McpConfig | undefined>`
Reads `.mcp.json` from plugin root.

### `loadHooksConfig(pluginPath: string): Promise<PartialHookConfiguration | undefined>`
Reads `hooks/hooks.json` from plugin root.

### `loadCommands(pluginPath: string): CustomSlashCommand[]`
Existing method, scans `commands/` directory.

## PluginManager (Manager)

### `loadPlugins(configs: PluginConfig[]): Promise<void>`
Updated to orchestrate the loading of all component types and register them with their respective managers.

## Manager Registration Interfaces

The `PluginManager` will interact with the following existing managers:

- **SlashCommandManager**: `registerPluginCommands(pluginName, commands)`
- **SkillManager**: (Needs new method) `registerPluginSkills(skills: Skill[])`
- **LspManager**: `registerServer(language, config)`
- **McpManager**: `addServer(name, config)`
- **HookManager**: (Needs new method) `registerPluginHooks(hooks: PartialHookConfiguration)`
