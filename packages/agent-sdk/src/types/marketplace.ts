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

export type MarketplaceSource =
  | {
      source: "directory";
      path: string;
    }
  | {
      source: "github";
      repo: string;
    };

export interface KnownMarketplace {
  name: string;
  source: MarketplaceSource;
}

export interface KnownMarketplacesRegistry {
  marketplaces: KnownMarketplace[];
}

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  cachePath: string;
}

export interface InstalledPluginsRegistry {
  plugins: InstalledPlugin[];
}
