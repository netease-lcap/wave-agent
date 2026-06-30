# API Contracts: Marketplace Management

The following contracts describe the internal service methods in `MarketplaceService` and the high-level `PluginCore` API.

## MarketplaceService

### `listMarketplaces(): Promise<KnownMarketplace[]>`
Returns the list of all registered marketplaces, including the builtin one.

### `getKnownMarketplaces(): Promise<KnownMarketplacesRegistry>`
**@deprecated** — Use `listMarketplaces()` instead. Returns the full registry object.

### `addMarketplace(input: string, scope?: Scope): Promise<KnownMarketplace>`
Adds a new marketplace. Parses input to create a new `KnownMarketplace` (local, GitHub, or Git). The `scope` parameter determines which settings file to persist the marketplace config to. Returns the created marketplace.

### `removeMarketplace(name: string, scope?: Scope): Promise<void>`
Removes a marketplace by name from the specified scope's settings.

### `updateMarketplace(name?: string, options?: { updatePlugins?: boolean }): Promise<void>`
Updates the local cache of a specific marketplace (or all if name is omitted). The `updatePlugins` option triggers re-installation of outdated plugins. Sets the `lastUpdated` timestamp on success.

### `autoUpdateAll(): Promise<void>`
Updates all registered marketplaces that have `autoUpdate: true`. Called in the background during startup.

### `installPlugin(pluginAtMarketplace: string, projectPath?: string): Promise<InstalledPlugin>`
Installs a plugin from a marketplace. Takes a `name@marketplace` compound identifier (not a Plugin object). The `projectPath` parameter is used for project-scoped installs. Returns the installed plugin record.

**Git URL source handling**: If the plugin entry's `source` in `marketplace.json` starts with `http://`, `https://`, `git@`, or `ssh://`, the individual plugin repo is cloned into a temp directory, then moved to the cache. Otherwise, the source is treated as a relative path within the marketplace checkout.

### `uninstallPlugin(pluginAtMarketplace: string, projectPath?: string): Promise<void>`
Uninstalls a plugin. Takes a `name@marketplace` compound identifier.

### `updatePlugin(pluginAtMarketplace: string): Promise<InstalledPlugin>`
Updates a plugin by uninstalling and re-installing it. Takes a `name@marketplace` compound identifier.

### `toggleAutoUpdate(name: string, enabled: boolean): Promise<void>`
Enables or disables auto-update for a marketplace.

### `loadMarketplaceManifest(marketplacePath: string): Promise<MarketplaceManifest>`
Reads and validates a `marketplace.json` from the given path.

### `getMarketplacePath(source: MarketplaceSource): string`
Resolves the local filesystem path for a marketplace source.

### `getInstalledPlugins(): Promise<InstalledPluginsRegistry>`
Returns the installed plugins registry.

### `getCacheRegistry(): Promise<KnownMarketplacesRegistry | null>`
Returns the known marketplaces registry, or null if not yet initialized.

## GitService

### `isGitAvailable(): Promise<boolean>`
Checks if `git` is installed and available by running `git --version`.

### `clone(urlOrRepo: string, targetPath: string, ref?: string): Promise<void>`
Clones a repository using `git clone --depth 1`. If `urlOrRepo` is in `owner/repo` format, resolves to `https://github.com/owner/repo.git`. If `ref` is provided, adds `-b <ref>` flag. Timeout: configurable via `WAVE_PLUGIN_GIT_TIMEOUT_MS` (default 120s).

### `pull(targetPath: string): Promise<void>`
Runs `git pull` in the specified directory. Same timeout as `clone`.

### Error Handling
Returns descriptive errors for: timeout, not-found, auth failure, rate limit, and not-a-repo.

## PluginCore

High-level API that orchestrates `PluginManager`, `PluginScopeManager`, `MarketplaceService`, and `ConfigurationService`.

### `installPlugin(pluginId: string, scope?: Scope): Promise<InstalledPlugin>`
Install a plugin by `name@marketplace` ID and optionally enable it in the given scope.

### `uninstallPlugin(pluginId: string): Promise<void>`
Uninstall a plugin and remove it from all enabled scopes.

### `enablePlugin(pluginId: string, scope?: Scope): Promise<Scope>`
Enable a plugin in the specified scope. Returns the scope where it was enabled.

### `disablePlugin(pluginId: string, scope?: Scope): Promise<Scope>`
Disable a plugin in the specified scope.

### `updatePlugin(pluginId: string): Promise<InstalledPlugin>`
Update a plugin by uninstalling and re-installing.

### `listPlugins(): Promise<{ plugins: MarketplacePluginStatus[]; mergedEnabled: Record<string, boolean> }>`
List all plugins from all marketplaces with their installation and enabled status.

### `addMarketplace(input: string, scope?: Scope): Promise<KnownMarketplace>`
Add a marketplace (GitHub shorthand, Git URL, or local path).

### `removeMarketplace(name: string, scope?: Scope): Promise<void>`
Remove a marketplace from the specified scope.

### `updateMarketplace(name?: string): Promise<void>`
Update a specific marketplace or all marketplaces.

### `listMarketplaces(): Promise<KnownMarketplace[]>`
List all registered marketplaces.

### `toggleAutoUpdate(name: string, enabled: boolean): Promise<void>`
Toggle auto-update for a marketplace.

### `getInstalledPlugins(): Promise<InstalledPluginsRegistry>`
Get the installed plugins registry.

### `getMergedEnabledPlugins(): Record<string, boolean>`
Get the merged enabled plugins map across all scopes.

### `findPluginScope(pluginId: string): Scope | null`
Find which scope a plugin is enabled in.

### `removeEnabledPlugin(scope: Scope, pluginId: string): Promise<void>`
Remove a plugin from the enabled list in a specific scope.
