import { ConfigurationService } from "../services/configurationService.js";
import { PluginManager } from "./pluginManager.js";
import { Logger } from "../types/index.js";
import { Scope } from "../types/configuration.js";

export interface PluginScopeManagerOptions {
  workdir: string;
  configurationService: ConfigurationService;
  pluginManager: PluginManager;
  logger?: Logger;
}

export class PluginScopeManager {
  private workdir: string;
  private configurationService: ConfigurationService;
  private pluginManager: PluginManager;
  private logger?: Logger;

  constructor(options: PluginScopeManagerOptions) {
    this.workdir = options.workdir;
    this.configurationService = options.configurationService;
    this.pluginManager = options.pluginManager;
    this.logger = options.logger;
  }

  /**
   * Enable a plugin in the specified scope
   */
  async enablePlugin(scope: Scope, pluginId: string): Promise<void> {
    await this.configurationService.updateEnabledPlugin(
      this.workdir,
      scope,
      pluginId,
      true,
    );
    this.logger?.info(`Enabled plugin ${pluginId} in ${scope} scope`);
    this.refreshPluginManager();
  }

  /**
   * Disable a plugin in the specified scope
   */
  async disablePlugin(scope: Scope, pluginId: string): Promise<void> {
    await this.configurationService.updateEnabledPlugin(
      this.workdir,
      scope,
      pluginId,
      false,
    );
    this.logger?.info(`Disabled plugin ${pluginId} in ${scope} scope`);
    this.refreshPluginManager();
  }

  /**
   * Get the merged enabled state of all plugins
   */
  getMergedEnabledPlugins(): Record<string, boolean> {
    return this.configurationService.getMergedEnabledPlugins(this.workdir);
  }

  /**
   * Refresh the plugin manager with the latest configuration
   * Note: This only updates the configuration, it doesn't reload plugins.
   * Reloading plugins might require a more complex logic (unloading/loading).
   */
  private refreshPluginManager(): void {
    const enabledPlugins = this.getMergedEnabledPlugins();
    this.pluginManager.updateEnabledPlugins(enabledPlugins);
  }
}
