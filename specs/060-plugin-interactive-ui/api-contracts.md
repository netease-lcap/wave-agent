# API Contracts: Plugin Interactive UI

This document defines the TypeScript interfaces for the methods needed from `MarketplaceService` and `ConfigurationService` to support the Plugin Interactive UI in `packages/code`.

## 1. MarketplaceService Contracts

The `MarketplaceService` handles the discovery, installation, and management of plugins and marketplaces.

```typescript
interface IMarketplaceService {
  /**
   * Lists all registered marketplaces.
   */
  listMarketplaces(): Promise<Marketplace[]>;

  /**
   * Adds a new marketplace from a URL or local path.
   */
  addMarketplace(source: string): Promise<Marketplace>;

  /**
   * Removes a registered marketplace.
   */
  removeMarketplace(name: string): Promise<void>;

  /**
   * Updates marketplace manifests (pulls latest from git/github).
   */
  updateMarketplace(name?: string): Promise<void>;

  /**
   * Lists all plugins available across all registered marketplaces.
   * Includes information about whether they are already installed.
   */
  listAvailablePlugins(): Promise<Plugin[]>;

  /**
   * Installs a plugin from a marketplace.
   * @param pluginId Format: "name@marketplace"
   */
  installPlugin(pluginId: string): Promise<Plugin>;

  /**
   * Uninstalls a plugin.
   */
  uninstallPlugin(pluginId: string): Promise<void>;
}
```

## 2. ConfigurationService Contracts

The `ConfigurationService` handles the enabling/disabling of plugins at different scopes (user, project).

```typescript
interface IConfigurationService {
  /**
   * Gets the enabled status of all plugins for the current workspace.
   * Merges settings from user and project scopes.
   */
  getMergedEnabledPlugins(workdir: string): Record<string, boolean>;

  /**
   * Enables or disables a plugin in a specific scope.
   * @param scope 'user' | 'project' | 'local'
   */
  updateEnabledPlugin(
    workdir: string,
    scope: 'user' | 'project' | 'local',
    pluginId: string,
    enabled: boolean
  ): Promise<void>;
}
```

## 3. Unified Plugin UI Hook

In `packages/code`, a custom hook `usePluginManager` will wrap these services to provide a simplified interface for the UI components.

```typescript
interface UsePluginManager {
  plugins: Plugin[];
  marketplaces: Marketplace[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  refresh(): Promise<void>;
  install(pluginId: string): Promise<void>;
  uninstall(pluginId: string): Promise<void>;
  toggleEnabled(pluginId: string, scope: 'user' | 'project' | 'local'): Promise<void>;
  addMarketplace(source: string): Promise<void>;
  removeMarketplace(name: string): Promise<void>;
}
```
