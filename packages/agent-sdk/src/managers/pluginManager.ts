import { logger } from "../utils/globalLogger.js";
import { Plugin, PluginConfig } from "../types/index.js";
import { PluginLoader } from "../services/pluginLoader.js";
import * as path from "path";
import { SkillManager } from "./skillManager.js";
import { HookManager } from "./hookManager.js";
import { LspManager } from "./lspManager.js";
import { McpManager } from "./mcpManager.js";
import { SlashCommandManager } from "./slashCommandManager.js";
import { MarketplaceService } from "../services/MarketplaceService.js";
import { ConfigurationService } from "../services/configurationService.js";
import { Container } from "../utils/container.js";

export interface PluginManagerOptions {
  workdir: string;
  enabledPlugins?: Record<string, boolean>;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private workdir: string;
  private enabledPlugins: Record<string, boolean>;

  constructor(
    private container: Container,
    options: PluginManagerOptions,
  ) {
    this.workdir = options.workdir;
    this.enabledPlugins = options.enabledPlugins || {};
  }

  private get skillManager(): SkillManager | undefined {
    return this.container.get<SkillManager>("SkillManager");
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get lspManager(): LspManager | undefined {
    return this.container.get<LspManager>("LspManager");
  }

  private get mcpManager(): McpManager | undefined {
    return this.container.get<McpManager>("McpManager");
  }

  private get slashCommandManager(): SlashCommandManager | undefined {
    return this.container.get<SlashCommandManager>("SlashCommandManager");
  }

  private get configurationService(): ConfigurationService | undefined {
    return this.container.get<ConfigurationService>("ConfigurationService");
  }

  /**
   * Update enabled plugins configuration
   */
  updateEnabledPlugins(enabledPlugins: Record<string, boolean>): void {
    this.enabledPlugins = enabledPlugins;
  }

  /**
   * Load plugins installed via marketplace
   */
  private async loadInstalledPlugins(): Promise<void> {
    try {
      // If configurationService is provided, use it to get the latest merged enabled plugins
      if (this.configurationService) {
        this.enabledPlugins = this.configurationService.getMergedEnabledPlugins(
          this.workdir,
        );
      }

      const marketplaceService = new MarketplaceService();

      // Trigger auto-update for marketplaces in the background
      if (!process.env.VITEST) {
        marketplaceService.autoUpdateAll().catch((error) => {
          logger?.error("Background marketplace auto-update failed:", error);
        });
      }

      let installedRegistry = await marketplaceService.getInstalledPlugins();
      const knownMarketplaces = await marketplaceService.listMarketplaces();

      // Identify missing enabled plugins and auto-install them if marketplace is known
      for (const pluginId of Object.keys(this.enabledPlugins)) {
        if (this.enabledPlugins[pluginId] !== true) continue;

        const [name, marketplaceName] = pluginId.split("@");
        if (!name || !marketplaceName) continue;

        const isInstalled = installedRegistry.plugins.some(
          (p) => p.name === name && p.marketplace === marketplaceName,
        );

        if (!isInstalled) {
          const isMarketplaceKnown = knownMarketplaces.some(
            (m) => m.name === marketplaceName,
          );

          if (isMarketplaceKnown) {
            logger?.info(`Auto-installing missing plugin: ${pluginId}`);
            try {
              await marketplaceService.installPlugin(pluginId);
            } catch (installError) {
              logger?.error(
                `Failed to auto-install plugin ${pluginId}:`,
                installError,
              );
            }
          } else {
            logger?.warn(
              `Plugin ${pluginId} is enabled but marketplace ${marketplaceName} is unknown. Skipping auto-install.`,
            );
          }
        }
      }

      // Refresh registry after potential auto-installs
      installedRegistry = await marketplaceService.getInstalledPlugins();

      for (const p of installedRegistry.plugins) {
        const pluginId = `${p.name}@${p.marketplace}`;
        if (this.enabledPlugins[pluginId] !== true) {
          logger?.info(`Plugin ${pluginId} is not enabled via configuration`);
          continue;
        }
        await this.loadSinglePlugin(p.cachePath);
      }
    } catch (error) {
      logger?.error("Failed to load installed plugins:", error);
    }
  }

  /**
   * Load a single plugin from an absolute path
   */
  private async loadSinglePlugin(absolutePath: string): Promise<void> {
    try {
      const manifest = await PluginLoader.loadManifest(absolutePath);

      if (this.plugins.has(manifest.name)) {
        // If already loaded (e.g. via explicit config), skip
        logger?.warn(`Plugin with name '${manifest.name}' is already loaded`);
        return;
      }

      const plugin: Plugin = {
        ...manifest,
        path: absolutePath,
        commands: PluginLoader.loadCommands(absolutePath),
        skills: await PluginLoader.loadSkills(absolutePath),
        lspConfig: await PluginLoader.loadLspConfig(absolutePath),
        mcpConfig: await PluginLoader.loadMcpConfig(absolutePath),
        hooksConfig: await PluginLoader.loadHooksConfig(absolutePath),
      };

      // Register components with managers
      if (this.slashCommandManager && plugin.commands.length > 0) {
        this.slashCommandManager.registerPluginCommands(
          plugin.name,
          plugin.commands,
        );
      }

      if (this.skillManager && plugin.skills.length > 0) {
        this.skillManager.registerPluginSkills(plugin.name, plugin.skills);
      }

      if (this.lspManager && plugin.lspConfig) {
        for (const [language, config] of Object.entries(plugin.lspConfig)) {
          const configWithPluginRoot = { ...config, pluginRoot: plugin.path };
          this.lspManager.registerServer(language, configWithPluginRoot);
        }
      }

      if (this.mcpManager && plugin.mcpConfig) {
        for (const [name, config] of Object.entries(
          plugin.mcpConfig.mcpServers,
        )) {
          const configWithPluginRoot = { ...config, pluginRoot: plugin.path };
          this.mcpManager.addServer(name, configWithPluginRoot);
        }
      }

      if (this.hookManager && plugin.hooksConfig) {
        this.hookManager.registerPluginHooks(plugin.path, plugin.hooksConfig);
      }

      this.plugins.set(manifest.name, plugin);
      logger?.info(`Loaded plugin: ${manifest.name} v${manifest.version}`);
    } catch (error) {
      logger?.error(`Failed to load plugin from ${absolutePath}`, error);
    }
  }

  /**
   * Load plugins from configuration
   * @param configs Array of plugin configurations
   */
  async loadPlugins(configs: PluginConfig[]): Promise<void> {
    // Load plugins from configuration (e.g. --plugin-dir) first to give them higher priority
    for (const config of configs) {
      if (config.type !== "local") {
        logger?.warn(`Unsupported plugin type: ${config.type}`);
        continue;
      }

      const absolutePath = path.isAbsolute(config.path)
        ? config.path
        : path.resolve(this.workdir, config.path);

      await this.loadSinglePlugin(absolutePath);
    }

    // Load installed plugins from marketplace
    await this.loadInstalledPlugins();
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }
}
