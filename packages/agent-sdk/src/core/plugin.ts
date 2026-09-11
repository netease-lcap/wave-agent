import { Container } from "../utils/container.js";
import path from "node:path";
import fs from "node:fs/promises";
import { PluginManager } from "../managers/pluginManager.js";
import { PluginScopeManager } from "../managers/pluginScopeManager.js";
import { MarketplaceService } from "../services/MarketplaceService.js";
import { ConfigurationService } from "../services/configurationService.js";
import {
  Scope,
  InstalledPlugin,
  KnownMarketplace,
  MarketplaceManifest,
  InstalledPluginsRegistry,
  MarketplacePluginStatus,
} from "../types/index.js";

/**
 * PluginCore
 *
 * Encapsulates plugin management logic, providing a high-level API for
 * installing, uninstalling, enabling, and disabling plugins.
 */
export class PluginCore {
  private container: Container;
  private pluginManager: PluginManager;
  private pluginScopeManager: PluginScopeManager;
  private marketplaceService: MarketplaceService;
  private configurationService: ConfigurationService;
  private workdir: string;

  constructor(workdir: string = process.cwd()) {
    this.workdir = workdir;
    this.container = new Container();
    this.configurationService = new ConfigurationService();
    this.marketplaceService = new MarketplaceService(
      this.workdir,
      this.configurationService,
    );

    // Wire up ConfigurationService in the container for PluginManager to use
    this.container.register("ConfigurationService", this.configurationService);

    this.pluginManager = new PluginManager(this.container, {
      workdir: this.workdir,
    });

    this.pluginScopeManager = new PluginScopeManager({
      workdir: this.workdir,
      configurationService: this.configurationService,
      pluginManager: this.pluginManager,
    });
  }

  /**
   * Installs a plugin from a marketplace
   */
  async installPlugin(
    pluginId: string,
    scope?: Scope,
  ): Promise<InstalledPlugin> {
    const installedPlugin =
      await this.marketplaceService.installPlugin(pluginId);
    if (scope) {
      await this.enablePlugin(pluginId, scope);
    }
    return installedPlugin;
  }

  /**
   * Uninstalls a plugin and removes it from all configuration scopes
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.marketplaceService.uninstallPlugin(pluginId);
    await this.pluginScopeManager.removePluginFromAllScopes(pluginId);
  }

  /**
   * Enables a plugin in the specified scope. If no scope is provided, it tries to find
   * the scope where the plugin is already configured, or defaults to "user".
   */
  async enablePlugin(pluginId: string, scope?: Scope): Promise<Scope> {
    const targetScope = scope || this.findPluginScope(pluginId) || "user";
    await this.pluginScopeManager.enablePlugin(targetScope, pluginId);
    return targetScope;
  }

  /**
   * Disables a plugin in the specified scope. If no scope is provided, it tries to find
   * the scope where the plugin is already configured, or defaults to "user".
   */
  async disablePlugin(pluginId: string, scope?: Scope): Promise<Scope> {
    const targetScope = scope || this.findPluginScope(pluginId) || "user";
    await this.pluginScopeManager.disablePlugin(targetScope, pluginId);
    return targetScope;
  }

  /**
   * Moves an installed plugin to another installation scope: clears its
   * enabledPlugins record from every scope, then enables it in the target one
   * (spec plugin「设置页插件市场」场景 11：更换作用域后旧作用域不再保留该插件)。
   */
  async setPluginScope(pluginId: string, scope: Scope): Promise<Scope> {
    await this.pluginScopeManager.removePluginFromAllScopes(pluginId);
    await this.pluginScopeManager.enablePlugin(scope, pluginId);
    return scope;
  }

  /**
   * Updates an installed plugin to the latest version from its marketplace
   */
  async updatePlugin(pluginId: string): Promise<InstalledPlugin> {
    return await this.marketplaceService.updatePlugin(pluginId);
  }

  /**
   * Toggles auto-update for a marketplace
   */
  async toggleAutoUpdate(name: string, enabled: boolean): Promise<void> {
    await this.marketplaceService.toggleAutoUpdate(name, enabled);
  }

  /**
   * Lists all plugins from all registered marketplaces with their installation and enabled status
   */
  async listPlugins(): Promise<{
    plugins: MarketplacePluginStatus[];
    mergedEnabled: Record<string, boolean>;
  }> {
    const installedPlugins =
      await this.marketplaceService.getInstalledPlugins();
    const marketplaces = await this.marketplaceService.listMarketplaces();
    const mergedEnabled = this.configurationService.getMergedEnabledPlugins(
      this.workdir,
    );

    const allMarketplacePlugins: MarketplacePluginStatus[] = [];

    for (const m of marketplaces) {
      try {
        const marketplacePath = this.marketplaceService.getMarketplacePath(
          m.source,
        );
        const manifest =
          await this.marketplaceService.loadMarketplaceManifest(
            marketplacePath,
          );
        for (const p of manifest.plugins) {
          const pluginId = `${p.name}@${m.name}`;
          const installed = installedPlugins.plugins.find(
            (ip) => ip.name === p.name && ip.marketplace === m.name,
          );
          allMarketplacePlugins.push({
            ...p,
            marketplace: m.name,
            installed: !!installed,
            version: installed?.version,
            latestVersion: await this.readLatestVersion(
              marketplacePath,
              p.source,
            ),
            cachePath: installed?.cachePath,
            projectPath: installed?.projectPath,
            scope:
              this.pluginScopeManager.findPluginScope(pluginId) || undefined,
          });
        }
      } catch {
        // Skip marketplaces that fail to load
      }
    }

    return {
      plugins: allMarketplacePlugins,
      mergedEnabled,
    };
  }

  /**
   * Reads the version declared by a marketplace plugin's own manifest inside the
   * marketplace checkout — the version a fresh install would get. Git-URL plugin
   * sources are not fetched here (they have no local copy until install), so they
   * yield undefined (spec plugin A-010).
   */
  private async readLatestVersion(
    marketplacePath: string,
    source: string,
  ): Promise<string | undefined> {
    const isGitSource =
      source.startsWith("http://") ||
      source.startsWith("https://") ||
      source.startsWith("git@") ||
      source.startsWith("ssh://");
    if (isGitSource || !source) return undefined;

    const pluginPath = path.resolve(marketplacePath, source);
    for (const dir of [".wave-plugin", ".claude-plugin"]) {
      try {
        const raw = await fs.readFile(
          path.join(pluginPath, dir, "plugin.json"),
          "utf-8",
        );
        const version = (JSON.parse(raw) as { version?: string }).version;
        if (version) return version;
      } catch {
        // Try the next manifest location
      }
    }
    return undefined;
  }

  /**
   * Adds a new marketplace
   */
  async addMarketplace(
    input: string,
    scope: Scope = "user",
  ): Promise<KnownMarketplace> {
    return await this.marketplaceService.addMarketplace(input, scope);
  }

  /**
   * Removes a marketplace by name
   */
  async removeMarketplace(name: string, scope?: Scope): Promise<void> {
    await this.marketplaceService.removeMarketplace(name, scope);
  }

  /**
   * Updates a specific marketplace or all marketplaces
   *
   * Pulls the latest marketplace source and reinstalls any plugins that are
   * already installed from it, so a manual "update marketplace" also brings
   * installed plugins up to date (mirrors Claude Code's refresh-and-bump).
   *
   * @returns 实际发生版本变化的插件数量（0 = 全部已是最新），供 GUI 宿主区分提示。
   */
  async updateMarketplace(name?: string): Promise<number> {
    return await this.marketplaceService.updateMarketplace(name, {
      updatePlugins: true,
    });
  }

  /**
   * Lists all registered marketplaces
   */
  async listMarketplaces(): Promise<KnownMarketplace[]> {
    return await this.marketplaceService.listMarketplaces();
  }

  /**
   * Gets the registry of all installed plugins
   */
  async getInstalledPlugins(): Promise<InstalledPluginsRegistry> {
    return await this.marketplaceService.getInstalledPlugins();
  }

  /**
   * Gets the merged enabled state of all plugins across all scopes
   */
  getMergedEnabledPlugins(): Record<string, boolean> {
    return this.configurationService.getMergedEnabledPlugins(this.workdir);
  }

  /**
   * Loads a marketplace manifest from a local path
   */
  async loadMarketplaceManifest(
    marketplacePath: string,
  ): Promise<MarketplaceManifest> {
    return await this.marketplaceService.loadMarketplaceManifest(
      marketplacePath,
    );
  }

  /**
   * Resolves the local path for a marketplace
   */
  getMarketplacePath(marketplace: KnownMarketplace): string {
    return this.marketplaceService.getMarketplacePath(marketplace.source);
  }

  /**
   * Finds the scope where a plugin is currently enabled/disabled
   */
  findPluginScope(pluginId: string): Scope | null {
    return this.pluginScopeManager.findPluginScope(pluginId);
  }

  /**
   * Removes a plugin from the enabled plugins in the specified scope
   */
  async removeEnabledPlugin(scope: Scope, pluginId: string): Promise<void> {
    await this.configurationService.removeEnabledPlugin(
      this.workdir,
      scope,
      pluginId,
    );
  }
}
