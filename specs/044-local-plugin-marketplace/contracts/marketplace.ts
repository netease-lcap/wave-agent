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
