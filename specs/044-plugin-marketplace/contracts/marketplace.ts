export interface MarketplaceOwner {
  name: string;
  email?: string;
}

export interface MarketplacePluginEntry {
  name: string;
  source: string;
  description: string;
}

export interface MarketplaceManifest {
  name: string;
  owner: MarketplaceOwner;
  plugins: MarketplacePluginEntry[];
}

export type MarketplaceSourceType = 'directory' | 'github' | 'git';

export interface MarketplaceSource {
  source: MarketplaceSourceType;
  path?: string; // for 'directory'
  repo?: string; // for 'github'
  url?: string;  // for 'git'
}

export interface KnownMarketplace {
  name: string;
  source: MarketplaceSource;
  isBuiltin?: boolean;
  autoUpdate?: boolean;
}

export interface KnownMarketplacesRegistry {
  marketplaces: KnownMarketplace[];
}

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  cachePath: string;
  scope: 'user' | 'project' | 'local';
  isEnabled: boolean;
}

export interface InstalledPluginsRegistry {
  plugins: InstalledPlugin[];
}
