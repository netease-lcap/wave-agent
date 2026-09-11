import { Scope } from "./configuration.js";

export interface MarketplaceOwner {
  name: string;
  email?: string;
}

export interface MarketplacePluginEntry {
  name: string;
  source: string;
  description: string;
}

export interface MarketplacePluginStatus extends MarketplacePluginEntry {
  marketplace: string;
  installed: boolean;
  /** 已安装版本（未安装时 undefined） */
  version?: string;
  /**
   * 市场内该插件当前可安装的最新版本，取自市场检出目录内插件的
   * `.wave-plugin/plugin.json`（兼容 `.claude-plugin/plugin.json`）。
   * 插件来源是独立 Git 仓库等无法就地读取清单的情况为 undefined
   * （spec plugin A-010：此时不展示最新版本）。
   */
  latestVersion?: string;
  cachePath?: string;
  projectPath?: string;
  scope?: Scope;
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
  autoUpdate?: boolean;
  lastUpdated?: string;
  /** The scope where this marketplace was declared (user, project, local, or builtin) */
  declaredScope?: "user" | "project" | "local" | "builtin";
}

export interface KnownMarketplacesRegistry {
  builtinSeeded?: boolean;
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
