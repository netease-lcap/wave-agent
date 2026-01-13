import { promises as fs, existsSync, mkdirSync } from "fs";
import * as path from "path";
import { getPluginsDir } from "../utils/configPaths.js";
import {
  KnownMarketplace,
  KnownMarketplacesRegistry,
  InstalledPlugin,
  InstalledPluginsRegistry,
  MarketplaceManifest,
} from "../types/marketplace.js";

/**
 * Marketplace Service
 *
 * Handles local plugin marketplace registration, plugin installation,
 * and state management for installed plugins.
 */
export class MarketplaceService {
  private pluginsDir: string;
  private knownMarketplacesPath: string;
  private installedPluginsPath: string;
  private tmpDir: string;
  private cacheDir: string;

  constructor() {
    this.pluginsDir = getPluginsDir();
    this.knownMarketplacesPath = path.join(
      this.pluginsDir,
      "known_marketplaces.json",
    );
    this.installedPluginsPath = path.join(
      this.pluginsDir,
      "installed_plugins.json",
    );
    this.tmpDir = path.join(this.pluginsDir, "tmp");
    this.cacheDir = path.join(this.pluginsDir, "cache");

    this.ensureDirectoryStructure();
  }

  /**
   * Ensures the required directory structure exists in ~/.wave/plugins
   */
  private ensureDirectoryStructure() {
    [this.pluginsDir, this.tmpDir, this.cacheDir].forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Loads the known marketplaces registry
   */
  async getKnownMarketplaces(): Promise<KnownMarketplacesRegistry> {
    if (!existsSync(this.knownMarketplacesPath)) {
      return { marketplaces: [] };
    }
    try {
      const content = await fs.readFile(this.knownMarketplacesPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error("Failed to load known marketplaces:", error);
      return { marketplaces: [] };
    }
  }

  /**
   * Loads the installed plugins registry
   */
  async getInstalledPlugins(): Promise<InstalledPluginsRegistry> {
    if (!existsSync(this.installedPluginsPath)) {
      return { plugins: [] };
    }
    try {
      const content = await fs.readFile(this.installedPluginsPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error("Failed to load installed plugins:", error);
      return { plugins: [] };
    }
  }

  /**
   * Saves the known marketplaces registry
   */
  async saveKnownMarketplaces(
    registry: KnownMarketplacesRegistry,
  ): Promise<void> {
    await fs.writeFile(
      this.knownMarketplacesPath,
      JSON.stringify(registry, null, 2),
    );
  }

  /**
   * Saves the installed plugins registry
   */
  async saveInstalledPlugins(
    registry: InstalledPluginsRegistry,
  ): Promise<void> {
    await fs.writeFile(
      this.installedPluginsPath,
      JSON.stringify(registry, null, 2),
    );
  }

  /**
   * Loads a marketplace manifest from a local path
   */
  async loadMarketplaceManifest(
    marketplacePath: string,
  ): Promise<MarketplaceManifest> {
    const manifestPath = path.join(
      marketplacePath,
      ".wave-plugin",
      "marketplace.json",
    );
    if (!existsSync(manifestPath)) {
      throw new Error(`Marketplace manifest not found at ${manifestPath}`);
    }
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content);

    // Basic validation
    if (
      !manifest.name ||
      !manifest.plugins ||
      !Array.isArray(manifest.plugins)
    ) {
      throw new Error(`Invalid marketplace manifest at ${manifestPath}`);
    }

    return manifest;
  }

  /**
   * Adds a new local marketplace
   */
  async addMarketplace(marketplacePath: string): Promise<KnownMarketplace> {
    const absolutePath = path.resolve(marketplacePath);
    const manifest = await this.loadMarketplaceManifest(absolutePath);

    const registry = await this.getKnownMarketplaces();

    // Check if already exists
    const existing = registry.marketplaces.find(
      (m) => m.name === manifest.name,
    );
    if (existing) {
      existing.path = absolutePath;
    } else {
      registry.marketplaces.push({
        name: manifest.name,
        path: absolutePath,
      });
    }

    await this.saveKnownMarketplaces(registry);
    return { name: manifest.name, path: absolutePath };
  }

  /**
   * Lists all registered marketplaces
   */
  async listMarketplaces(): Promise<KnownMarketplace[]> {
    const registry = await this.getKnownMarketplaces();
    return registry.marketplaces;
  }

  /**
   * Installs a plugin from a marketplace
   */
  async installPlugin(pluginAtMarketplace: string): Promise<InstalledPlugin> {
    const [pluginName, marketplaceName] = pluginAtMarketplace.split("@");
    if (!pluginName || !marketplaceName) {
      throw new Error("Invalid plugin format. Use name@marketplace");
    }

    const marketplaces = await this.listMarketplaces();
    const marketplace = marketplaces.find((m) => m.name === marketplaceName);
    if (!marketplace) {
      throw new Error(`Marketplace ${marketplaceName} not found`);
    }

    const manifest = await this.loadMarketplaceManifest(marketplace.path);
    const pluginEntry = manifest.plugins.find((p) => p.name === pluginName);
    if (!pluginEntry) {
      throw new Error(
        `Plugin ${pluginName} not found in marketplace ${marketplaceName}`,
      );
    }

    const pluginSrcPath = path.resolve(marketplace.path, pluginEntry.source);
    const pluginManifestPath = path.join(
      pluginSrcPath,
      ".wave-plugin",
      "plugin.json",
    );
    if (!existsSync(pluginManifestPath)) {
      throw new Error(`Plugin manifest not found at ${pluginManifestPath}`);
    }

    const pluginManifestContent = await fs.readFile(
      pluginManifestPath,
      "utf-8",
    );
    const pluginManifest = JSON.parse(pluginManifestContent);
    const version = pluginManifest.version || "1.0.0";

    // Atomic installation
    const tmpPluginDir = path.join(this.tmpDir, `${pluginName}-${Date.now()}`);
    await fs.cp(pluginSrcPath, tmpPluginDir, { recursive: true });

    const cachePath = path.join(
      this.cacheDir,
      marketplaceName,
      pluginName,
      version,
    );
    if (existsSync(cachePath)) {
      await fs.rm(cachePath, { recursive: true, force: true });
    }
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.rename(tmpPluginDir, cachePath);

    const installedRegistry = await this.getInstalledPlugins();
    const existingIndex = installedRegistry.plugins.findIndex(
      (p) => p.name === pluginName && p.marketplace === marketplaceName,
    );

    const installedPlugin: InstalledPlugin = {
      name: pluginName,
      marketplace: marketplaceName,
      version,
      cachePath,
    };

    if (existingIndex >= 0) {
      installedRegistry.plugins[existingIndex] = installedPlugin;
    } else {
      installedRegistry.plugins.push(installedPlugin);
    }

    await this.saveInstalledPlugins(installedRegistry);
    return installedPlugin;
  }
}
