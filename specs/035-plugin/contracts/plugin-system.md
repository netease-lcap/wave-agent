# Plugin System Contract

This document defines the core interfaces and behaviors of the plugin system.

## 1. Plugin Interface
The `Plugin` interface represents a loaded plugin. It extends `PluginManifest`, merging manifest fields flat (no nested `components` wrapper).

```typescript
export interface Plugin extends PluginManifest {
  path: string;
  commands: CustomSlashCommand[];
  skills: Skill[];
  agents: SubagentConfiguration[];
  lspConfig?: LspConfig;
  mcpConfig?: McpConfig;
  hooksConfig?: PartialHookConfiguration;
}
```

## 2. PluginManifest
```typescript
export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: { name: string };
}
```

## 3. PluginConfig
Configuration for loading a plugin via `AgentOptions.plugins`.

```typescript
export interface PluginConfig {
  type: "local";
  path: string;
}
```

## 4. Plugin Loader
`PluginLoader` is a static utility class for reading and validating plugins from the filesystem.

```typescript
export class PluginLoader {
  static loadManifest(pluginPath: string): PluginManifest;
  static loadCommands(pluginPath: string): CustomSlashCommand[];
  static loadSkills(pluginPath: string): Skill[];
  static loadAgents(pluginPath: string): SubagentConfiguration[];
  static loadLspConfig(pluginPath: string): LspConfig | undefined;
  static loadMcpConfig(pluginPath: string): McpConfig | undefined;
  static loadHooksConfig(pluginPath: string): PartialHookConfiguration | undefined;
}
```

## 5. Plugin Manager
`PluginManager` stores and manages loaded plugins. Uses DI via `Container`.

```typescript
export interface PluginManagerOptions {
  workdir: string;
  enabledPlugins?: Record<string, boolean>;
}

export class PluginManager {
  constructor(container: Container, options: PluginManagerOptions);

  // Load explicitly configured plugins, then marketplace-installed plugins
  loadPlugins(configs: PluginConfig[]): Promise<void>;

  // Push updated enabledPlugins from ConfigurationService
  updateEnabledPlugins(enabledPlugins: Record<string, boolean>): void;

  // Returns all loaded plugins (enabled + disabled)
  getPlugins(): Plugin[];

  // Find a plugin by name
  getPlugin(name: string): Plugin | undefined;
}
```

### loadPlugins Flow
1. Iterates `configs[]`, loads each `PluginConfig` via `loadSinglePlugin(absolutePath)`.
2. Calls `loadInstalledPlugins()` which:
   - Refreshes `enabledPlugins` from `ConfigurationService.getMergedEnabledPlugins()`
   - Triggers background `autoUpdateAll()` on marketplace repos with `autoUpdate: true`
   - Auto-installs any enabled but missing plugins from known marketplaces
   - Loads each installed+enabled plugin via `loadSinglePlugin(cachePath)`

### loadSinglePlugin Registration
Each plugin's components are registered with their respective managers:
- `slashCommandManager.registerPluginCommands(name, commands)`
- `skillManager.registerPluginSkills(name, skills)`
- `lspManager.registerServer(language, configWithPluginRoot)`
- `mcpManager.addServer(name, configWithPluginRoot)`
- `hookManager.registerPluginHooks(path, hooksConfig)`
- `subagentManager.registerPluginAgents(name, agents)`

## 6. Component Registration
Each component type has a corresponding manager or service:

- **SlashCommandManager**: Registers and executes slash commands. Plugin commands MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:command-name`).
- **SkillManager**: Registers and executes skills. Plugin skills MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:skill-name`).
- **HookManager**: Registers and executes hooks.
- **SubagentManager**: Registers and executes agents.
- **LspManager**: Manages LSP configurations.
- **McpManager**: Manages MCP configurations.
