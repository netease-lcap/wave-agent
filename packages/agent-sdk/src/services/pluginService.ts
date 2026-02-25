import { MarketplaceService } from "./MarketplaceService.js";
import { ConfigurationService } from "./configurationService.js";
import { PluginManager } from "../managers/pluginManager.js";
import { PluginScopeManager } from "../managers/pluginScopeManager.js";
import { Container } from "../utils/container.js";
import { Scope, KnownMarketplace } from "../types/index.js";

export class PluginService {
  private marketplaceService: MarketplaceService;
  private configurationService: ConfigurationService;
  private pluginManager: PluginManager;
  private scopeManager: PluginScopeManager;
  private workdir: string;

  constructor(workdir: string = process.cwd()) {
    this.workdir = workdir;
    this.marketplaceService = new MarketplaceService();
    this.configurationService = new ConfigurationService();
    const container = new Container();
    container.register("ConfigurationService", this.configurationService);
    this.pluginManager = new PluginManager(container, {
      workdir: this.workdir,
    });
    this.scopeManager = new PluginScopeManager({
      workdir: this.workdir,
      configurationService: this.configurationService,
      pluginManager: this.pluginManager,
    });
  }

  async install(plugin: string, scope?: Scope) {
    const installed = await this.marketplaceService.installPlugin(
      plugin,
      this.workdir,
    );

    if (scope) {
      const pluginId = `${installed.name}@${installed.marketplace}`;
      await this.scopeManager.enablePlugin(scope, pluginId);
    }

    return installed;
  }

  async uninstall(plugin: string) {
    await this.marketplaceService.uninstallPlugin(plugin, this.workdir);

    try {
      await this.scopeManager.removePluginFromAllScopes(plugin);
    } catch (error) {
      console.warn(
        `Warning: Could not clean up all plugin configurations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async enable(plugin: string, scope?: Scope) {
    const targetScope =
      scope || this.scopeManager.findPluginScope(plugin) || "user";
    await this.scopeManager.enablePlugin(targetScope, plugin);
    return targetScope;
  }

  async disable(plugin: string, scope?: Scope) {
    const targetScope =
      scope || this.scopeManager.findPluginScope(plugin) || "user";
    await this.scopeManager.disablePlugin(targetScope, plugin);
    return targetScope;
  }

  async list() {
    const installedPlugins =
      await this.marketplaceService.getInstalledPlugins();
    const marketplaces = await this.marketplaceService.listMarketplaces();
    const mergedEnabled = this.configurationService.getMergedEnabledPlugins(
      this.workdir,
    );

    const allMarketplacePlugins: {
      name: string;
      marketplace: string;
      installed: boolean;
      version?: string;
      scope?: string;
    }[] = [];

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
            name: p.name,
            marketplace: m.name,
            installed: !!installed,
            version: installed?.version,
            scope: this.scopeManager.findPluginScope(pluginId) || undefined,
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

  // Methods needed by usePluginManager hook
  async listMarketplaces() {
    return this.marketplaceService.listMarketplaces();
  }

  async getInstalledPlugins() {
    return this.marketplaceService.getInstalledPlugins();
  }

  getMergedEnabledPlugins() {
    return this.scopeManager.getMergedEnabledPlugins();
  }

  findPluginScope(pluginId: string) {
    return this.scopeManager.findPluginScope(pluginId);
  }

  async loadMarketplaceManifest(path: string) {
    return this.marketplaceService.loadMarketplaceManifest(path);
  }

  getMarketplacePath(mk: KnownMarketplace) {
    return this.marketplaceService.getMarketplacePath(mk);
  }

  async addMarketplace(source: string) {
    return this.marketplaceService.addMarketplace(source);
  }

  async removeMarketplace(name: string) {
    return this.marketplaceService.removeMarketplace(name);
  }

  async updateMarketplace(name?: string) {
    return this.marketplaceService.updateMarketplace(name);
  }

  async updatePlugin(pluginId: string) {
    return this.marketplaceService.updatePlugin(pluginId);
  }

  async removeEnabledPlugin(scope: Scope, pluginId: string) {
    return this.configurationService.removeEnabledPlugin(
      this.workdir,
      scope,
      pluginId,
    );
  }
}
