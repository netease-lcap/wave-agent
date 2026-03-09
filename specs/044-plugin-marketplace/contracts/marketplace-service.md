# API Contracts: Marketplace Management

The following "contracts" describe the internal service methods in `MarketplaceService` that will be affected or added.

## MarketplaceService

### `getKnownMarketplaces(): Promise<KnownMarketplacesRegistry>`
Returns the list of all registered marketplaces, including the builtin one if applicable.

### `addMarketplace(input: string): Promise<void>`
Adds a new marketplace. Parses input to create a new `KnownMarketplace` (local, GitHub, or Git).

### `removeMarketplace(name: string): Promise<void>`
Removes a marketplace by name.

### `updateMarketplace(name: string): Promise<void>`
Updates the local cache of a specific marketplace.

### `updateAllMarketplaces(): Promise<void>`
Updates all registered marketplaces.

### `installPlugin(plugin: Plugin, scope: 'user' | 'project' | 'local'): Promise<void>`
Installs a plugin from a marketplace into the specified scope.

### `uninstallPlugin(name: string, marketplace: string): Promise<void>`
Uninstalls a plugin.
