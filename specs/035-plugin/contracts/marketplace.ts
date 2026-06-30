export interface MarketplaceOwner {
  name: string;
  email?: string;
}

export interface MarketplacePluginEntry {
  name: string;
  source: string; // Relative path (e.g., "./plugins/review-plugin") or Git URL (http://, https://, git@, ssh://)
  description: string;
}

export interface MarketplacePluginStatus extends MarketplacePluginEntry {
  marketplace: string;
  installed: boolean;
  version?: string;
  cachePath?: string;
  projectPath?: string;
  scope?: Scope;
}

export interface MarketplaceManifest {
  name: string;
  owner: MarketplaceOwner;
  plugins: MarketplacePluginEntry[];
}

// Discriminated union for type safety
export type MarketplaceSource =
  | { source: "directory"; path: string }
  | { source: "github"; repo: string; ref?: string }
  | { source: "git"; url: string; ref?: string };

export interface KnownMarketplace {
  name: string;
  source: MarketplaceSource;
  isBuiltin?: boolean;
  autoUpdate?: boolean;
  lastUpdated?: string;
  declaredScope?: "user" | "project" | "local" | "builtin";
}

export interface KnownMarketplacesRegistry {
  marketplaces: KnownMarketplace[];
}

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  cachePath: string;
  scope?: Scope; // Optional — scope is tracked via enabledPlugins in settings
  projectPath?: string;
}

export interface InstalledPluginsRegistry {
  plugins: InstalledPlugin[];
}

export type Scope = "user" | "project" | "local";
