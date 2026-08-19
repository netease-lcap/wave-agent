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
   * Find the scope where a plugin is currently enabled/disabled.
   * Priority: local > project > user
   */
  findPluginScope(pluginId: string): Scope | null {
    const { projectPaths, userPaths } =
      this.configurationService.getConfigurationPaths(this.workdir);
    const userPathSet = new Set(userPaths);

    // When the workdir is the user's home directory, projectPaths overlaps
    // userPaths (both point at ~/.wave/settings.json). Treat such a file as the
    // user config, otherwise user-scope plugins would be mislabeled "project".
    const checkPaths: { path: string; scope: Scope }[] = [
      { path: projectPaths[0], scope: "local" },
      ...(userPathSet.has(projectPaths[1])
        ? []
        : [{ path: projectPaths[1], scope: "project" as Scope }]),
      ...userPaths.map((path) => ({ path, scope: "user" as Scope })),
    ];

    const seen = new Set<string>();
    for (const { path, scope } of checkPaths) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const config = this.configurationService.loadWaveConfigFromFile(path);
      if (config?.enabledPlugins && pluginId in config.enabledPlugins) {
        return scope;
      }
    }

    return null;
  }

  /**
   * Remove a plugin from all scopes (user, project, local)
   * This is useful when uninstalling a plugin to clean up all configuration
   */
  async removePluginFromAllScopes(pluginId: string): Promise<void> {
    const scopes: Scope[] = ["user", "project", "local"];

    for (const scope of scopes) {
      try {
        await this.configurationService.removeEnabledPlugin(
          this.workdir,
          scope,
          pluginId,
        );
      } catch (error) {
        // Continue removing from other scopes even if one fails
        this.logger?.warn(
          `Failed to remove plugin ${pluginId} from ${scope} scope: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.refreshPluginManager();
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
