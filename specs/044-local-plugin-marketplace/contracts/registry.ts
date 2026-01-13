export interface KnownMarketplace {
  name: string;
  path: string;
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
