import { promises as fs, existsSync, mkdirSync } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getPluginsDir } from "../utils/configPaths.js";
import {
  KnownMarketplace,
  KnownMarketplacesRegistry,
  InstalledPlugin,
  InstalledPluginsRegistry,
  MarketplaceManifest,
} from "../types/marketplace.js";
import { GitService } from "./GitService.js";

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
  private marketplacesDir: string;
  private gitService: GitService;
  private static readonly BUILTIN_MARKETPLACE: KnownMarketplace = {
    name: "wave-plugins-official",
    source: {
      source: "github",
      repo: "netease-lcap/wave-plugins-official",
    },
  };

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
    this.marketplacesDir = path.join(this.pluginsDir, "marketplaces");
    this.gitService = new GitService();

    this.ensureDirectoryStructure();
  }

  /**
   * Ensures the required directory structure exists in ~/.wave/plugins
   */
  private ensureDirectoryStructure() {
    [this.pluginsDir, this.tmpDir, this.cacheDir, this.marketplacesDir].forEach(
      (dir) => {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      },
    );
  }

  /**
   * Loads the known marketplaces registry
   */
  async getKnownMarketplaces(): Promise<KnownMarketplacesRegistry> {
    if (!existsSync(this.knownMarketplacesPath)) {
      return {
        marketplaces: [
          {
            ...MarketplaceService.BUILTIN_MARKETPLACE,
            isBuiltin: true,
          },
        ],
      };
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
   * Resolves the local path for a marketplace
   */
  public getMarketplacePath(marketplace: KnownMarketplace): string {
    if (marketplace.source.source === "directory") {
      return marketplace.source.path;
    } else if (marketplace.source.source === "github") {
      return path.join(this.marketplacesDir, marketplace.source.repo);
    } else {
      // For general git, use a hash of the URL to avoid path issues
      const hash = crypto
        .createHash("md5")
        .update(marketplace.source.url)
        .digest("hex");
      return path.join(this.marketplacesDir, hash);
    }
  }

  /**
   * Adds a new marketplace (local directory, GitHub repo, or Git URL)
   */
  async addMarketplace(input: string): Promise<KnownMarketplace> {
    let marketplace: KnownMarketplace;

    const isFullUrl =
      input.startsWith("http://") ||
      input.startsWith("https://") ||
      input.startsWith("git@") ||
      input.startsWith("ssh://");

    if (
      isFullUrl ||
      (input.includes("/") && !path.isAbsolute(input) && !input.startsWith("."))
    ) {
      // Git or GitHub repo
      let urlOrRepo = input;
      let ref: string | undefined;

      if (input.includes("#")) {
        [urlOrRepo, ref] = input.split("#");
      }

      const tempMarketplace: KnownMarketplace = isFullUrl
        ? { name: "", source: { source: "git", url: urlOrRepo, ref } }
        : { name: "", source: { source: "github", repo: urlOrRepo, ref } };

      const targetPath = this.getMarketplacePath(tempMarketplace);

      if (!existsSync(targetPath)) {
        try {
          await this.gitService.clone(urlOrRepo, targetPath, ref);
        } catch (error) {
          throw new Error(
            `Failed to add marketplace from Git: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      let manifest: MarketplaceManifest;
      try {
        manifest = await this.loadMarketplaceManifest(targetPath);
      } catch (error) {
        throw new Error(
          `Failed to load manifest from cloned repository: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      marketplace = {
        name: manifest.name,
        source: isFullUrl
          ? { source: "git", url: urlOrRepo, ref }
          : { source: "github", repo: urlOrRepo, ref },
      };
    } else {
      // Local directory format
      const absolutePath = path.resolve(input);
      let manifest: MarketplaceManifest;
      try {
        manifest = await this.loadMarketplaceManifest(absolutePath);
      } catch (error) {
        throw new Error(
          `Failed to load manifest from directory: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      marketplace = {
        name: manifest.name,
        source: { source: "directory", path: absolutePath },
      };
    }

    const registry = await this.getKnownMarketplaces();

    // Check if already exists
    const existingIndex = registry.marketplaces.findIndex(
      (m) => m.name === marketplace.name,
    );
    if (existingIndex >= 0) {
      registry.marketplaces[existingIndex] = marketplace;
    } else {
      registry.marketplaces.push(marketplace);
    }

    // Ensure builtin is included if we are creating the file for the first time
    // and it hasn't been explicitly removed yet.
    // (getKnownMarketplaces already handles the default injection)

    await this.saveKnownMarketplaces(registry);
    return marketplace;
  }

  /**
   * Lists all registered marketplaces
   */
  async listMarketplaces(): Promise<KnownMarketplace[]> {
    const registry = await this.getKnownMarketplaces();
    return registry.marketplaces.map((m) => ({
      ...m,
      isBuiltin: m.name === MarketplaceService.BUILTIN_MARKETPLACE.name,
    }));
  }

  /**
   * Removes a marketplace by name
   */
  async removeMarketplace(name: string): Promise<void> {
    const registry = await this.getKnownMarketplaces();
    const initialCount = registry.marketplaces.length;
    registry.marketplaces = registry.marketplaces.filter(
      (m) => m.name !== name,
    );

    if (registry.marketplaces.length === initialCount) {
      throw new Error(`Marketplace ${name} not found`);
    }

    await this.saveKnownMarketplaces(registry);
  }

  /**
   * Updates a specific marketplace or all marketplaces
   */
  async updateMarketplace(name?: string): Promise<void> {
    const registry = await this.getKnownMarketplaces();
    const toUpdate = name
      ? registry.marketplaces.filter((m) => m.name === name)
      : registry.marketplaces;

    if (name && toUpdate.length === 0) {
      throw new Error(`Marketplace ${name} not found`);
    }

    const isGitAvailable = await this.gitService.isGitAvailable();
    const errors: string[] = [];
    for (const marketplace of toUpdate) {
      try {
        if (
          marketplace.source.source === "github" ||
          marketplace.source.source === "git"
        ) {
          if (!isGitAvailable) {
            console.warn(
              `Skipping update for Git/GitHub marketplace "${marketplace.name}" because Git is not installed.`,
            );
            continue;
          }
          const targetPath = this.getMarketplacePath(marketplace);
          await this.gitService.pull(targetPath);
        }
        // For directory source, we just re-validate the manifest
        await this.loadMarketplaceManifest(
          this.getMarketplacePath(marketplace),
        );
      } catch (error) {
        const msg = `Failed to update marketplace "${marketplace.name}": ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Some marketplaces failed to update:\n${errors.join("\n")}`,
      );
    }
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

    const marketplacePath = this.getMarketplacePath(marketplace);
    const manifest = await this.loadMarketplaceManifest(marketplacePath);
    const pluginEntry = manifest.plugins.find((p) => p.name === pluginName);
    if (!pluginEntry) {
      throw new Error(
        `Plugin ${pluginName} not found in marketplace ${marketplaceName}`,
      );
    }

    const isGitSource =
      pluginEntry.source.startsWith("http://") ||
      pluginEntry.source.startsWith("https://") ||
      pluginEntry.source.startsWith("git@") ||
      pluginEntry.source.startsWith("ssh://");

    let pluginSrcPath: string;
    let tempCloneDir: string | undefined;

    if (isGitSource) {
      tempCloneDir = path.join(this.tmpDir, `clone-${Date.now()}`);
      let url = pluginEntry.source;
      let ref: string | undefined;
      if (url.includes("#")) {
        [url, ref] = url.split("#");
      }
      await this.gitService.clone(url, tempCloneDir, ref);
      pluginSrcPath = tempCloneDir;
    } else {
      pluginSrcPath = path.resolve(marketplacePath, pluginEntry.source);
    }

    const pluginManifestPath = path.join(
      pluginSrcPath,
      ".wave-plugin",
      "plugin.json",
    );
    if (!existsSync(pluginManifestPath)) {
      if (tempCloneDir) {
        await fs.rm(tempCloneDir, { recursive: true, force: true });
      }
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
    try {
      if (isGitSource) {
        await fs.rename(pluginSrcPath, tmpPluginDir);
        tempCloneDir = undefined; // Already moved
      } else {
        await fs.cp(pluginSrcPath, tmpPluginDir, { recursive: true });
      }

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
    } catch (error) {
      // Cleanup tmp dirs if they exist
      if (existsSync(tmpPluginDir)) {
        await fs.rm(tmpPluginDir, { recursive: true, force: true });
      }
      if (tempCloneDir && existsSync(tempCloneDir)) {
        await fs.rm(tempCloneDir, { recursive: true, force: true });
      }
      throw new Error(
        `Failed to install plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Uninstalls a plugin
   */
  async uninstallPlugin(pluginAtMarketplace: string): Promise<void> {
    const [pluginName, marketplaceName] = pluginAtMarketplace.split("@");
    if (!pluginName || !marketplaceName) {
      throw new Error("Invalid plugin format. Use name@marketplace");
    }

    const installedRegistry = await this.getInstalledPlugins();
    const pluginIndex = installedRegistry.plugins.findIndex(
      (p) => p.name === pluginName && p.marketplace === marketplaceName,
    );

    if (pluginIndex === -1) {
      throw new Error(
        `Plugin ${pluginName}@${marketplaceName} is not installed`,
      );
    }

    const plugin = installedRegistry.plugins[pluginIndex];

    // Remove cached files
    if (existsSync(plugin.cachePath)) {
      await fs.rm(plugin.cachePath, { recursive: true, force: true });
    }

    // Remove from registry
    installedRegistry.plugins.splice(pluginIndex, 1);
    await this.saveInstalledPlugins(installedRegistry);
  }
}
