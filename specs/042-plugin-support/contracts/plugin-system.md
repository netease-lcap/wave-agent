# Plugin System Contract

This document defines the core interfaces and behaviors of the plugin system.

## 1. Plugin Interface
The `Plugin` interface represents a loaded plugin in the system.

```typescript
export interface Plugin {
  name: string;
  description: string;
  version: string;
  author?: {
    name: string;
    email?: string;
  };
  path: string;
  manifest: PluginManifest;
  components: {
    commands?: SlashCommand[];
    skills?: Skill[];
    hooks?: Hook[];
    agents?: Agent[];
    lsp?: LspConfig;
    mcp?: McpConfig;
  };
}
```

## 2. Plugin Loader
The `PluginLoader` is responsible for reading and validating plugins from the filesystem.

```typescript
export interface PluginLoader {
  loadPlugin(pluginPath: string): Promise<Plugin>;
  loadPlugins(pluginPaths: string[]): Promise<Plugin[]>;
}
```

## 3. Plugin Manager
The `PluginManager` stores and manages loaded plugins.

```typescript
export interface PluginManager {
  plugins: Plugin[];
  loadPlugins(pluginPaths: string[]): Promise<void>;
  getPlugin(name: string): Plugin | undefined;
  getEnabledPlugins(): Plugin[];
}
```

## 4. Component Registration
Each component type (Commands, Skills, Hooks, Agents, LSP, MCP) MUST have a corresponding manager or service that handles its registration and execution.

- **SlashCommandManager**: Registers and executes slash commands. Plugin commands MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:command-name`).
- **SkillManager**: Registers and executes skills. Plugin skills MUST be namespaced using the plugin name and a colon (e.g., `plugin-name:skill-name`).
- **HookManager**: Registers and executes hooks.
- **AgentManager**: Registers and executes agents.
- **LspService**: Manages LSP configurations.
- **McpService**: Manages MCP configurations.
```
