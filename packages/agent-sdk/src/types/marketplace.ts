import { Scope } from "./configuration.js";

export interface MarketplaceOwner {
  name: string;
  email?: string;
}

/**
 * Object form of a plugin entry's `source` (spec plugin A-021): `url` is a whole
 * repository, `git-subdir` is a subdirectory of one. Both are outside the
 * marketplace checkout, so they carry no readable local copy for「最新版本」(A-010).
 */
export interface MarketplacePluginObjectSource {
  source: "url" | "git-subdir";
  url: string;
  /** Only for `git-subdir`: path of the plugin inside the repository. */
  path?: string;
  /** Branch or tag. */
  ref?: string;
  /** Pinned commit; checked out after cloning. */
  sha?: string;
}

export interface MarketplacePluginEntry {
  name: string;
  source: string | MarketplacePluginObjectSource;
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
  lastUpdated?: string;
  /** The scope where this marketplace was declared (user, project, local, or builtin) */
  declaredScope?: "user" | "project" | "local" | "builtin";
}

export interface KnownMarketplacesRegistry {
  builtinSeeded?: boolean;
  marketplaces: KnownMarketplace[];
}

/**
 * 安装产物的记账位置（spec plugin A-015）：用户作用域是本机全局的，不带
 * projectPath；项目作用域与本地作用域归属某个仓库，以该仓库路径为 projectPath。
 */
export interface PluginInstallLocation {
  scope: Scope;
  projectPath?: string;
}

export interface InstalledPlugin {
  name: string;
  marketplace: string;
  version: string;
  cachePath: string;
  /** 该条安装记录所属的作用域；引入作用域维度之前写入的历史记录不带此字段（spec plugin A-015）。 */
  scope?: Scope;
  /** 项目作用域与本地作用域所属仓库的路径；用户作用域不带。 */
  projectPath?: string;
}

export interface InstalledPluginsRegistry {
  plugins: InstalledPlugin[];
}
