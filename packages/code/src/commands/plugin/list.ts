import {
  MarketplaceService,
  ConfigurationService,
  PluginScopeManager,
  PluginManager,
} from "wave-agent-sdk";

export async function listPluginsCommand() {
  const configurationService = new ConfigurationService();
  const marketplaceService = new MarketplaceService();
  const workdir = process.cwd();
  const pluginManager = new PluginManager({
    workdir,
    configurationService,
  });
  const pluginScopeManager = new PluginScopeManager({
    workdir,
    configurationService,
    pluginManager,
  });

  try {
    const installedPlugins = await marketplaceService.getInstalledPlugins();
    const marketplaces = await marketplaceService.listMarketplaces();
    const mergedEnabled = configurationService.getMergedEnabledPlugins(workdir);

    // Collect all plugins from all marketplaces
    const allMarketplacePlugins: {
      name: string;
      marketplace: string;
      installed: boolean;
      version?: string;
      scope?: string;
    }[] = [];

    for (const m of marketplaces) {
      try {
        const manifest = await marketplaceService.loadMarketplaceManifest(
          marketplaceService.getMarketplacePath(m),
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
            scope: pluginScopeManager.findPluginScope(pluginId) || undefined,
          });
        });
      } catch {
        // Skip marketplaces that fail to load
      }
    }

    if (allMarketplacePlugins.length === 0) {
      console.log("No plugins found in registered marketplaces.");
    } else {
      console.log("Plugins:");
      allMarketplacePlugins.forEach((p) => {
        const pluginId = `${p.name}@${p.marketplace}`;
        const isEnabled = mergedEnabled[pluginId] !== false;
        const status = p.installed
          ? isEnabled
            ? "enabled"
            : "disabled"
          : "not installed";
        const versionStr = p.version ? ` v${p.version}` : "";
        const scopeStr = p.scope ? ` (${p.scope})` : "";
        console.log(`- ${pluginId}${versionStr}${scopeStr} [${status}]`);
      });
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list plugins: ${message}`);
    process.exit(1);
  }
}
