import { Scope } from "./configuration.js";

export interface MarketplaceOwner {
  name: string;
  email?: string;
}

export interface MarketplacePluginEntry {
  name: string;
  source: string | MarketplaceSource;
  description: string;
  /** Claude Code compatibility: plugin category */
  category?: string;
  /** Claude Code compatibility: plugin tags */
  tags?: string[];
  /** Claude Code compatibility: when false, plugin.json is optional */
  strict?: boolean;
  /** Claude Code compatibility: inline manifest fields */
  version?: string;
  author?: { name: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  commands?: string;
  skills?: string;
  agents?: string;
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
  /** Claude Code compatibility: additional metadata */
  metadata?: Record<string, unknown>;
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
    }
  | {
      source: "url";
      url: string;
      ref?: string;
    };

export interface KnownMarketplace {
  name: string;
  source: MarketplaceSource;
  isBuiltin?: boolean;
  autoUpdate?: boolean;
  lastUpdated?: string;
  /** The scope where this marketplace was declared (user, project, local, or builtin) */
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
  scope?: Scope;
  projectPath?: string;
}

export interface InstalledPluginsRegistry {
  plugins: InstalledPlugin[];
}
