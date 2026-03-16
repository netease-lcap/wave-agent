# Plugin Management Contract

This document defines the interfaces and behaviors for managing plugins in Wave.

## 1. Plugin Scope Manager
The `PluginScopeManager` manages plugin installation scopes (`user`, `project`, `local`).

```typescript
export interface PluginScopeManager {
  getPluginPath(scope: Scope): string;
  getPluginPaths(): string[];
  installPlugin(pluginUrl: string, scope: Scope): Promise<void>;
  uninstallPlugin(pluginName: string, scope: Scope): Promise<void>;
}
```

## 2. Configuration Service
The `ConfigurationService` manages the `enabledPlugins` configuration across all scopes.

```typescript
export interface ConfigurationService {
  getMergedEnabledPlugins(): Record<string, boolean>;
  updateEnabledPlugin(pluginId: string, enabled: boolean, scope: Scope): Promise<void>;
}
```

## 3. Plugin Commands
The `plugin` command provides a CLI interface for managing plugins.

```bash
# Enable a plugin
wave plugin enable <plugin-id> [--scope <scope>]

# Disable a plugin
wave plugin disable <plugin-id> [--scope <scope>]

# Install a plugin
wave plugin install <plugin-url> [--scope <scope>]

# List installed plugins
wave plugin list
```

## 4. Scope Priority
The system enforces a strict priority for enabled plugins: `local` > `project` > `user`.

- **Local**: `.wave/settings.local.json`
- **Project**: `.wave/settings.json`
- **User**: `~/.wave/settings.json`
```
