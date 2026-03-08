import { Container } from "../utils/container.js";
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
    this.marketplaceService = new MarketplaceService();

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
        const manifest = await this.marketplaceService.loadMarketplaceManifest(
          this.marketplaceService.getMarketplacePath(m),
        );
        manifest.plugins.forEach((p) => {
          const pluginId = `${p.name}@${m.name}`;
          const installed = installedPlugins.plugins.find(
            (ip) => ip.name === p.name && ip.marketplace === m.name,
          );
          allMarketplacePlugins.push({
            ...p,
            marketplace: m.name,
            installed: !!installed,
            version: installed?.version,
            cachePath: installed?.cachePath,
            projectPath: installed?.projectPath,
            scope:
              this.pluginScopeManager.findPluginScope(pluginId) || undefined,
          });
        });
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
   * Adds a new marketplace
   */
  async addMarketplace(input: string): Promise<KnownMarketplace> {
    return await this.marketplaceService.addMarketplace(input);
  }

  /**
   * Removes a marketplace by name
   */
  async removeMarketplace(name: string): Promise<void> {
    await this.marketplaceService.removeMarketplace(name);
  }

  /**
   * Updates a specific marketplace or all marketplaces
   */
  async updateMarketplace(name?: string): Promise<void> {
    await this.marketplaceService.updateMarketplace(name);
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
    return this.marketplaceService.getMarketplacePath(marketplace);
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
