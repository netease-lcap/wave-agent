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
  MarketplaceSource,
} from "../types/marketplace.js";
import { GitService } from "./GitService.js";
import { ConfigurationService } from "./configurationService.js";
import type { MarketplaceConfig, Scope } from "../types/configuration.js";

/**
 * Marketplace Service
 *
 * Handles local plugin marketplace registration, plugin installation,
 * and state management for installed plugins.
 *
 * Marketplace declarations are now scoped (user/project/local) via settings files.
 * known_marketplaces.json is kept as a cache for installLocation/lastUpdated metadata.
 */
export class MarketplaceService {
  private static isLockedInProcess = false;
  private pluginsDir: string;
  private knownMarketplacesPath: string;
  private installedPluginsPath: string;
  private lockPath: string;
  private tmpDir: string;
  private cacheDir: string;
  private marketplacesDir: string;
  private gitService: GitService;
  private configurationService: ConfigurationService;
  private workdir: string;
  private static readonly BUILTIN_MARKETPLACE: KnownMarketplace = {
    name: "wave-plugins-official",
    source: {
      source: "github",
      repo: "netease-lcap/wave-plugins-official",
    },
    autoUpdate: true,
  };

  constructor(
    workdir: string = process.cwd(),
    configurationService: ConfigurationService = new ConfigurationService(),
  ) {
    this.workdir = workdir;
    this.configurationService = configurationService;
    this.pluginsDir = getPluginsDir();
    this.knownMarketplacesPath = path.join(
      this.pluginsDir,
      "known_marketplaces.json",
    );
    this.installedPluginsPath = path.join(
      this.pluginsDir,
      "installed_plugins.json",
    );
    this.lockPath = path.join(this.pluginsDir, ".lock");
    this.tmpDir = path.join(this.pluginsDir, "tmp");
    this.cacheDir = path.join(this.pluginsDir, "cache");
    this.marketplacesDir = path.join(this.pluginsDir, "marketplaces");
    this.gitService = new GitService();

    this.ensureDirectoryStructure();
    this.runMigration();
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
   * Backwards compatibility migration: migrate entries from known_marketplaces.json
   * to user-level settings if they aren't already declared there.
   */
  private async runMigration(): Promise<void> {
    try {
      const cacheRegistry = await this.getCacheRegistry();
      const scopedMarketplaces =
        this.configurationService.getMergedMarketplaces(this.workdir);
      const userMarketplaces = this.configurationService.getScopedMarketplaces(
        this.workdir,
        "user",
      );

      const entriesToMigrate = (cacheRegistry?.marketplaces ?? []).filter(
        (m) => !scopedMarketplaces[m.name] && !userMarketplaces[m.name],
      );

      if (entriesToMigrate.length > 0) {
        for (const m of entriesToMigrate) {
          if (m.name === MarketplaceService.BUILTIN_MARKETPLACE.name) continue;
          const config: MarketplaceConfig = {
            source: m.source,
            autoUpdate: m.autoUpdate,
          };
          await this.configurationService.addMarketplaceToScope(
            this.workdir,
            "user",
            m.name,
            config,
          );
        }
      }
    } catch {
      // Migration failure should not block startup
    }
  }

  /**
   * Check if a lock file is stale by reading its PID and checking if the process is alive.
   * Returns true if the lock is stale and safe to remove.
   */
  private async isStaleLock(): Promise<boolean> {
    try {
      const content = await fs.readFile(this.lockPath, "utf-8");
      const pid = parseInt(content.trim(), 10);
      if (isNaN(pid)) return true;
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    } catch {
      return true;
    }
  }

  /**
   * Acquires a file-based lock (with PID tracking for stale lock detection) and executes the provided function.
   * Supports re-entrancy within the same process.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (MarketplaceService.isLockedInProcess) {
      return await fn();
    }

    let lockFd: Awaited<ReturnType<typeof fs.open>> | undefined;
    const maxRetries = 600;
    const retryDelay = 100;

    for (let i = 0; i < maxRetries; i++) {
      try {
        lockFd = await fs.open(this.lockPath, "wx");
        break;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          if (i > 0 && i % 60 === 0) {
            const stale = await this.isStaleLock();
            if (stale) {
              await fs.unlink(this.lockPath).catch(() => {});
              continue;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }
        throw error;
      }
    }

    if (!lockFd) {
      throw new Error(
        `Failed to acquire marketplace lock after ${maxRetries} retries. If no other wave-agent process is running, please delete ${this.lockPath}`,
      );
    }

    await fs.writeFile(this.lockPath, String(process.pid), "utf-8");

    MarketplaceService.isLockedInProcess = true;
    try {
      return await fn();
    } finally {
      MarketplaceService.isLockedInProcess = false;
      await lockFd.close();
      await fs.unlink(this.lockPath).catch(() => {});
    }
  }

  /**
   * Loads the cache registry from known_marketplaces.json
   * Returns null if the file doesn't exist or has no parseable content (for first-run detection).
   */
  async getCacheRegistry(): Promise<KnownMarketplacesRegistry | null> {
    if (!existsSync(this.knownMarketplacesPath)) {
      return null;
    }
    try {
      const content = await fs.readFile(this.knownMarketplacesPath, "utf-8");
      if (!content.trim()) {
        return null;
      }
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Legacy method: loads known marketplaces with builtin injection.
   * @deprecated Use listMarketplaces() instead, which combines scoped settings.
   */
  async getKnownMarketplaces(): Promise<KnownMarketplacesRegistry> {
    const cache = await this.getCacheRegistry();
    // If cache is null (file doesn't exist or has no parseable content), inject builtin
    if (cache === null) {
      return {
        marketplaces: [
          {
            ...MarketplaceService.BUILTIN_MARKETPLACE,
            isBuiltin: true,
            declaredScope: "builtin",
          },
        ],
      };
    }
    // File has valid JSON - respect user's explicit choice even if empty
    const hasBuiltin = cache.marketplaces.some(
      (m) => m.name === MarketplaceService.BUILTIN_MARKETPLACE.name,
    );
    return {
      marketplaces: cache.marketplaces.map((m) => ({
        ...m,
        isBuiltin:
          m.isBuiltin || m.name === MarketplaceService.BUILTIN_MARKETPLACE.name,
        declaredScope: m.declaredScope ?? (hasBuiltin ? "builtin" : "user"),
      })),
    };
  }

  /**
   * Updates the cache registry with metadata for a marketplace
   */
  private async updateCacheMarketplace(
    name: string,
    metadata: Partial<KnownMarketplace>,
  ): Promise<void> {
    const registry = await this.getCacheRegistry();
    const marketplaces = registry?.marketplaces ?? [];
    const existingIndex = marketplaces.findIndex((m) => m.name === name);
    if (existingIndex >= 0) {
      marketplaces[existingIndex] = {
        ...marketplaces[existingIndex],
        ...metadata,
      };
    } else {
      marketplaces.push({
        name,
        source: metadata.source || { source: "directory", path: "" },
        ...metadata,
      });
    }
    const tmpPath = `${this.knownMarketplacesPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify({ marketplaces }, null, 2));
    await fs.rename(tmpPath, this.knownMarketplacesPath);
  }

  /**
   * Removes a marketplace from the cache registry
   */
  private async removeFromCache(name: string): Promise<void> {
    const registry = await this.getCacheRegistry();
    const marketplaces = registry?.marketplaces ?? [];
    const filtered = marketplaces.filter((m) => m.name !== name);
    const tmpPath = `${this.knownMarketplacesPath}.tmp`;
    await fs.writeFile(
      tmpPath,
      JSON.stringify({ marketplaces: filtered }, null, 2),
    );
    await fs.rename(tmpPath, this.knownMarketplacesPath);
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
      if (!content.trim()) {
        return { plugins: [] };
      }
      return JSON.parse(content);
    } catch (error) {
      console.error("Failed to load installed plugins:", error);
      return { plugins: [] };
    }
  }

  /**
   * Saves the installed plugins registry
   */
  async saveInstalledPlugins(
    registry: InstalledPluginsRegistry,
  ): Promise<void> {
    const tmpPath = `${this.installedPluginsPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2));
    await fs.rename(tmpPath, this.installedPluginsPath);
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
  public getMarketplacePath(source: MarketplaceSource): string {
    if (source.source === "directory") {
      return source.path;
    } else if (source.source === "github") {
      return path.join(this.marketplacesDir, source.repo);
    } else {
      const hash = crypto.createHash("md5").update(source.url).digest("hex");
      return path.join(this.marketplacesDir, hash);
    }
  }

  /**
   * Builds a KnownMarketplace from a scoped config, enriched with cache metadata
   */
  private async buildMarketplaceEntry(
    name: string,
    config: MarketplaceConfig,
    cache: KnownMarketplace | undefined,
    declaredScope: "user" | "project" | "local" | "builtin",
  ): Promise<KnownMarketplace> {
    return {
      name,
      source: config.source,
      autoUpdate: config.autoUpdate ?? cache?.autoUpdate,
      lastUpdated: cache?.lastUpdated,
      isBuiltin: name === MarketplaceService.BUILTIN_MARKETPLACE.name,
      declaredScope,
    };
  }

  /**
   * Finds which scope declared a marketplace (user, project, local, or builtin)
   */
  getMarketplaceDeclaringSource(name: string): Scope | "builtin" | null {
    if (name === MarketplaceService.BUILTIN_MARKETPLACE.name) return "builtin";

    const scopes: Scope[] = ["local", "project", "user"];
    for (const scope of scopes) {
      const scoped = this.configurationService.getScopedMarketplaces(
        this.workdir,
        scope,
      );
      if (scoped[name]) return scope;
    }
    return null;
  }

  /**
   * Adds a new marketplace (local directory, GitHub repo, or Git URL)
   */
  async addMarketplace(
    input: string,
    scope: Scope = "user",
  ): Promise<KnownMarketplace> {
    return this.withLock(async () => {
      let marketplace: KnownMarketplace;

      const isFullUrl =
        input.startsWith("http://") ||
        input.startsWith("https://") ||
        input.startsWith("git@") ||
        input.startsWith("ssh://");

      if (
        isFullUrl ||
        (input.includes("/") &&
          !path.isAbsolute(input) &&
          !input.startsWith("."))
      ) {
        let urlOrRepo = input;
        let ref: string | undefined;

        if (input.includes("#")) {
          [urlOrRepo, ref] = input.split("#");
        }

        const tempSource: MarketplaceSource = isFullUrl
          ? { source: "git", url: urlOrRepo, ref }
          : { source: "github", repo: urlOrRepo, ref };

        const targetPath = this.getMarketplacePath(tempSource);

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
          autoUpdate: false,
          lastUpdated: new Date().toISOString(),
        };
      } else {
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
          autoUpdate: false,
          lastUpdated: new Date().toISOString(),
        };
      }

      const config: MarketplaceConfig = {
        source: marketplace.source,
        autoUpdate: marketplace.autoUpdate,
      };

      await this.configurationService.addMarketplaceToScope(
        this.workdir,
        scope,
        marketplace.name,
        config,
      );

      // Update cache with metadata
      await this.updateCacheMarketplace(marketplace.name, {
        source: marketplace.source,
        autoUpdate: marketplace.autoUpdate,
        lastUpdated: marketplace.lastUpdated,
      });

      return marketplace;
    });
  }

  /**
   * Lists all registered marketplaces by combining scoped settings + built-in
   */
  async listMarketplaces(): Promise<KnownMarketplace[]> {
    const scopedMarketplaces = this.configurationService.getMergedMarketplaces(
      this.workdir,
    );
    const cacheRegistry = await this.getCacheRegistry();
    const cacheMap = new Map(
      (cacheRegistry?.marketplaces ?? []).map((m) => [m.name, m]),
    );

    const result: KnownMarketplace[] = [];

    // Add built-in marketplace
    result.push({
      ...MarketplaceService.BUILTIN_MARKETPLACE,
      isBuiltin: true,
      declaredScope: "builtin",
    });

    // Add all scoped marketplaces (local overrides project overrides user)
    for (const [name, config] of Object.entries(scopedMarketplaces)) {
      if (name === MarketplaceService.BUILTIN_MARKETPLACE.name) continue;
      const cache = cacheMap.get(name);
      const declaredScope = this.getMarketplaceDeclaringSource(name) as
        | "user"
        | "project"
        | "local";
      result.push(
        await this.buildMarketplaceEntry(name, config, cache, declaredScope),
      );
    }

    // Add cache entries not yet in scoped settings (backwards compatibility)
    for (const [name, cache] of cacheMap.entries()) {
      if (name === MarketplaceService.BUILTIN_MARKETPLACE.name) continue;
      if (scopedMarketplaces[name]) continue;
      result.push({
        ...cache,
        isBuiltin: false,
        declaredScope: cache.declaredScope ?? "user",
      });
    }

    return result;
  }

  /**
   * Removes a marketplace by name from the specified scope
   */
  async removeMarketplace(name: string, scope?: Scope): Promise<void> {
    return this.withLock(async () => {
      const targetScope =
        scope || this.getMarketplaceDeclaringSource(name) || "user";

      if (targetScope === "builtin") {
        throw new Error("Cannot remove built-in marketplace");
      }

      await this.configurationService.removeMarketplaceFromScope(
        this.workdir,
        targetScope,
        name,
      );

      // Also remove from cache
      await this.removeFromCache(name);
    });
  }

  /**
   * Updates a specific marketplace or all marketplaces
   */
  async updateMarketplace(
    name?: string,
    options?: { updatePlugins?: boolean },
  ): Promise<void> {
    return this.withLock(async () => {
      const marketplaces = await this.listMarketplaces();
      const toUpdate = name
        ? marketplaces.filter((m) => m.name === name)
        : marketplaces;

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
            const targetPath = this.getMarketplacePath(marketplace.source);
            if (existsSync(targetPath)) {
              await this.gitService.pull(targetPath);
            } else {
              let url: string;
              if (marketplace.source.source === "github") {
                url = marketplace.source.repo;
              } else {
                url = marketplace.source.url;
              }
              await this.gitService.clone(
                url,
                targetPath,
                marketplace.source.ref,
              );
            }
          }
          const manifest = await this.loadMarketplaceManifest(
            this.getMarketplacePath(marketplace.source),
          );

          marketplace.lastUpdated = new Date().toISOString();

          // Update cache metadata
          await this.updateCacheMarketplace(marketplace.name, {
            lastUpdated: marketplace.lastUpdated,
          });

          if (options?.updatePlugins) {
            const installedRegistry = await this.getInstalledPlugins();
            const pluginsToUpdate = installedRegistry.plugins.filter(
              (p) => p.marketplace === marketplace.name,
            );
            for (const plugin of pluginsToUpdate) {
              const pluginEntry = manifest.plugins.find(
                (p) => p.name === plugin.name,
              );
              if (!pluginEntry) {
                console.warn(
                  `Plugin "${plugin.name}" no longer found in marketplace "${marketplace.name}". Uninstalling...`,
                );
                try {
                  await this.uninstallPlugin(
                    `${plugin.name}@${plugin.marketplace}`,
                    plugin.projectPath,
                  );
                } catch (error) {
                  console.error(
                    `Failed to uninstall orphaned plugin "${plugin.name}" from marketplace "${marketplace.name}":`,
                    error,
                  );
                }
                continue;
              }
              try {
                await this.installPlugin(
                  `${plugin.name}@${plugin.marketplace}`,
                  plugin.projectPath,
                );
              } catch (error) {
                console.error(
                  `Failed to update plugin "${plugin.name}" from marketplace "${marketplace.name}":`,
                  error,
                );
              }
            }
          }
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
    });
  }

  /**
   * Automatically updates all marketplaces that have auto-update enabled
   */
  async autoUpdateAll(): Promise<void> {
    return this.withLock(async () => {
      const scopedMarketplaces =
        this.configurationService.getMergedMarketplaces(this.workdir);
      const toAutoUpdate = Object.entries(scopedMarketplaces)
        .filter(([, config]) => config.autoUpdate)
        .map(([name]) => name);

      for (const marketplaceName of toAutoUpdate) {
        try {
          await this.updateMarketplace(marketplaceName, {
            updatePlugins: true,
          });
        } catch (error) {
          console.error(
            `Auto-update failed for marketplace "${marketplaceName}":`,
            error,
          );
        }
      }
    });
  }

  /**
   * Toggles auto-update for a marketplace
   */
  async toggleAutoUpdate(name: string, enabled: boolean): Promise<void> {
    return this.withLock(async () => {
      const declaringSource = this.getMarketplaceDeclaringSource(name);
      if (!declaringSource || declaringSource === "builtin") {
        throw new Error(`Marketplace ${name} not found`);
      }

      const scoped = this.configurationService.getScopedMarketplaces(
        this.workdir,
        declaringSource,
      );
      const config = scoped[name];
      if (!config) {
        throw new Error(`Marketplace ${name} not found`);
      }

      config.autoUpdate = enabled;
      await this.configurationService.addMarketplaceToScope(
        this.workdir,
        declaringSource,
        name,
        config,
      );

      // Also update cache
      await this.updateCacheMarketplace(name, { autoUpdate: enabled });
    });
  }

  /**
   * Installs a plugin from a marketplace
   */
  async installPlugin(
    pluginAtMarketplace: string,
    projectPath?: string,
  ): Promise<InstalledPlugin> {
    return this.withLock(async () => {
      const [pluginName, marketplaceName] = pluginAtMarketplace.split("@");
      if (!pluginName || !marketplaceName) {
        throw new Error("Invalid plugin format. Use name@marketplace");
      }

      const marketplaces = await this.listMarketplaces();
      const marketplace = marketplaces.find((m) => m.name === marketplaceName);
      if (!marketplace) {
        throw new Error(`Marketplace ${marketplaceName} not found`);
      }

      const marketplacePath = this.getMarketplacePath(marketplace.source);
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

      try {
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
          throw new Error(`Plugin manifest not found at ${pluginManifestPath}`);
        }

        const pluginManifestContent = await fs.readFile(
          pluginManifestPath,
          "utf-8",
        );
        const pluginManifest = JSON.parse(pluginManifestContent);
        const version = pluginManifest.version || "1.0.0";

        const tmpPluginDir = path.join(
          this.tmpDir,
          `${pluginName}-${Date.now()}`,
        );
        try {
          if (isGitSource) {
            await fs.rename(pluginSrcPath, tmpPluginDir);
            tempCloneDir = undefined;
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
            (p) =>
              p.name === pluginName &&
              p.marketplace === marketplaceName &&
              p.projectPath === projectPath,
          );

          const installedPlugin: InstalledPlugin = {
            name: pluginName,
            marketplace: marketplaceName,
            version,
            cachePath,
            projectPath,
          };

          if (existingIndex >= 0) {
            installedRegistry.plugins[existingIndex] = installedPlugin;
          } else {
            installedRegistry.plugins.push(installedPlugin);
          }

          await this.saveInstalledPlugins(installedRegistry);
          return installedPlugin;
        } catch (error) {
          if (existsSync(tmpPluginDir)) {
            await fs.rm(tmpPluginDir, { recursive: true, force: true });
          }
          throw error;
        }
      } catch (error) {
        if (tempCloneDir && existsSync(tempCloneDir)) {
          await fs.rm(tempCloneDir, { recursive: true, force: true });
        }
        throw new Error(
          `Failed to install plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  /**
   * Uninstalls a plugin
   */
  async uninstallPlugin(
    pluginAtMarketplace: string,
    projectPath?: string,
  ): Promise<void> {
    return this.withLock(async () => {
      const [pluginName, marketplaceName] = pluginAtMarketplace.split("@");
      if (!pluginName || !marketplaceName) {
        throw new Error("Invalid plugin format. Use name@marketplace");
      }

      const installedRegistry = await this.getInstalledPlugins();
      const pluginIndex = installedRegistry.plugins.findIndex(
        (p) =>
          p.name === pluginName &&
          p.marketplace === marketplaceName &&
          p.projectPath === projectPath,
      );

      if (pluginIndex === -1) {
        throw new Error(
          `Plugin ${pluginName}@${marketplaceName} is not installed${projectPath ? ` for project ${projectPath}` : ""}`,
        );
      }

      const pluginToRemove = installedRegistry.plugins[pluginIndex];

      installedRegistry.plugins.splice(pluginIndex, 1);
      await this.saveInstalledPlugins(installedRegistry);

      const isStillReferenced = installedRegistry.plugins.some(
        (p) => p.cachePath === pluginToRemove.cachePath,
      );

      if (!isStillReferenced && existsSync(pluginToRemove.cachePath)) {
        await fs.rm(pluginToRemove.cachePath, { recursive: true, force: true });
      }
    });
  }

  /**
   * Updates a plugin (uninstall followed by install)
   */
  async updatePlugin(pluginAtMarketplace: string): Promise<InstalledPlugin> {
    return this.withLock(async () => {
      await this.uninstallPlugin(pluginAtMarketplace);
      return this.installPlugin(pluginAtMarketplace);
    });
  }
}
