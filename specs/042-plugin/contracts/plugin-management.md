# Plugin Management Contract

This document defines the interfaces and behaviors for managing plugins in Wave.

## 1. Plugin Scope Manager
The `PluginScopeManager` manages plugin enable/disable state across scopes via `ConfigurationService`.

```typescript
export interface PluginScopeManager {
  enablePlugin(scope: Scope, pluginId: string): Promise<Scope>;
  disablePlugin(scope: Scope, pluginId: string): Promise<Scope>;
  findPluginScope(pluginId: string): Scope | null;
  removePluginFromAllScopes(pluginId: string): Promise<void>;
  getMergedEnabledPlugins(): Record<string, boolean>;
}
```

## 2. Configuration Service
The `ConfigurationService` manages the `enabledPlugins` and `marketplaces` configuration across all scopes.

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

# Install a plugin from a marketplace
wave plugin install <plugin-name>@<marketplace-name>

# Uninstall a plugin
wave plugin uninstall <plugin-name>@<marketplace-name>

# Update a plugin
wave plugin update <plugin-name>@<marketplace-name>

# List installed plugins
wave plugin list
```

## 4. Marketplace Commands
```bash
# Add a marketplace
wave plugin marketplace add <source> [--scope <scope>]

# List marketplaces
wave plugin marketplace list

# Update a marketplace (or all if name omitted)
wave plugin marketplace update [name]

# Remove a marketplace
wave plugin marketplace remove <name>
```

## 5. Scope Priority
The system enforces a strict priority for enabled plugins: `local` > `project` > `user`.

- **Local**: `.wave/settings.local.json`
- **Project**: `.wave/settings.json`
- **User**: `~/.wave/settings.json`

## 6. Plugin ID Format
Plugins are identified using the `name@marketplace` compound format (e.g., `review-plugin@wave-plugins-official`). This format is used for all enable, disable, install, uninstall, and update operations.
