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
      ref?: string;
    }
  | {
      source: "git";
      url: string;
      ref?: string;
    };

export interface KnownMarketplace {
  name: string;
  source: MarketplaceSource;
  isBuiltin?: boolean;
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

export enum PluginStatus {
  AVAILABLE = "available",
  INSTALLED = "installed",
  ENABLED = "enabled",
  UPDATE_AVAILABLE = "update_available",
}

export interface PluginDetail extends MarketplacePluginEntry {
  id: string;
  status: PluginStatus;
  installedVersion?: string;
  latestVersion?: string;
  marketplaceName: string;
}
