import { Plugin, PluginConfig, Logger } from "../types/index.js";
import { PluginLoader } from "../services/pluginLoader.js";
import * as path from "path";

export interface PluginManagerOptions {
  workdir: string;
  logger?: Logger;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private workdir: string;
  private logger?: Logger;

  constructor(options: PluginManagerOptions) {
    this.workdir = options.workdir;
    this.logger = options.logger;
  }

  /**
   * Load plugins from configuration
   * @param configs Array of plugin configurations
   */
  async loadPlugins(configs: PluginConfig[]): Promise<void> {
    for (const config of configs) {
      if (config.type !== "local") {
        this.logger?.warn(`Unsupported plugin type: ${config.type}`);
        continue;
      }

      try {
        const absolutePath = path.isAbsolute(config.path)
          ? config.path
          : path.resolve(this.workdir, config.path);

        const manifest = await PluginLoader.loadManifest(absolutePath);

        if (this.plugins.has(manifest.name)) {
          this.logger?.warn(
            `Plugin with name '${manifest.name}' is already loaded. Skipping.`,
          );
          continue;
        }

        const plugin: Plugin = {
          ...manifest,
          path: absolutePath,
          commands: PluginLoader.loadCommands(absolutePath),
        };

        this.plugins.set(manifest.name, plugin);
        this.logger?.info(
          `Loaded plugin: ${manifest.name} v${manifest.version}`,
        );
      } catch (error) {
        this.logger?.error(`Failed to load plugin from ${config.path}:`, error);
      }
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
