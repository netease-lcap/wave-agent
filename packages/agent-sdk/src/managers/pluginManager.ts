import { Plugin, PluginConfig, Logger } from "../types/index.js";
import { PluginLoader } from "../services/pluginLoader.js";
import * as path from "path";
import { SkillManager } from "./skillManager.js";
import { HookManager } from "./hookManager.js";
import { LspManager } from "./lspManager.js";
import { McpManager } from "./mcpManager.js";
import { SlashCommandManager } from "./slashCommandManager.js";
import { MarketplaceService } from "../services/MarketplaceService.js";

export interface PluginManagerOptions {
  workdir: string;
  logger?: Logger;
  skillManager?: SkillManager;
  hookManager?: HookManager;
  lspManager?: LspManager;
  mcpManager?: McpManager;
  slashCommandManager?: SlashCommandManager;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private workdir: string;
  private logger?: Logger;
  private skillManager?: SkillManager;
  private hookManager?: HookManager;
  private lspManager?: LspManager;
  private mcpManager?: McpManager;
  private slashCommandManager?: SlashCommandManager;

  constructor(options: PluginManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
    this.skillManager = options.skillManager;
    this.hookManager = options.hookManager;
    this.lspManager = options.lspManager;
    this.mcpManager = options.mcpManager;
    this.slashCommandManager = options.slashCommandManager;
  }

  /**
   * Load plugins installed via marketplace
   */
  private async loadInstalledPlugins(): Promise<void> {
    try {
      const marketplaceService = new MarketplaceService();
      const installedRegistry = await marketplaceService.getInstalledPlugins();

      const configs: PluginConfig[] = installedRegistry.plugins.map((p) => ({
        type: "local",
        path: p.cachePath,
      }));

      // We use a modified version of the loading logic to avoid recursion
      // and handle the fact that these are already absolute paths
      for (const config of configs) {
        await this.loadSinglePlugin(config.path);
      }
    } catch (error) {
      this.logger?.error("Failed to load installed plugins:", error);
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
        this.logger?.warn(
          `Plugin with name '${manifest.name}' is already loaded`,
        );
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
        this.skillManager.registerPluginSkills(plugin.skills);
      }

      if (this.lspManager && plugin.lspConfig) {
        for (const [language, config] of Object.entries(plugin.lspConfig)) {
          this.lspManager.registerServer(language, config);
        }
      }

      if (this.mcpManager && plugin.mcpConfig) {
        for (const [name, config] of Object.entries(
          plugin.mcpConfig.mcpServers,
        )) {
          this.mcpManager.addServer(name, config);
        }
      }

      if (this.hookManager && plugin.hooksConfig) {
        this.hookManager.registerPluginHooks(plugin.hooksConfig);
      }

      this.plugins.set(manifest.name, plugin);
      this.logger?.info(`Loaded plugin: ${manifest.name} v${manifest.version}`);
    } catch (error) {
      this.logger?.error(`Failed to load plugin from ${absolutePath}`, error);
    }
  }

  /**
   * Load plugins from configuration
   * @param configs Array of plugin configurations
   */
  async loadPlugins(configs: PluginConfig[]): Promise<void> {
    // Load installed plugins from marketplace first
    await this.loadInstalledPlugins();

    for (const config of configs) {
      if (config.type !== "local") {
        this.logger?.warn(`Unsupported plugin type: ${config.type}`);
        continue;
      }

      const absolutePath = path.isAbsolute(config.path)
        ? config.path
        : path.resolve(this.workdir, config.path);

      await this.loadSinglePlugin(absolutePath);
    }
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
