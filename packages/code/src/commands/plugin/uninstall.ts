import {
  MarketplaceService,
  ConfigurationService,
  PluginManager,
  PluginScopeManager,
} from "wave-agent-sdk";

export async function uninstallPluginCommand(argv: { plugin: string }) {
  const marketplaceService = new MarketplaceService();
  const workdir = process.cwd();

  try {
    await marketplaceService.uninstallPlugin(argv.plugin, workdir);
    console.log(`Successfully uninstalled plugin: ${argv.plugin}`);

    const configurationService = new ConfigurationService();
    const pluginManager = new PluginManager({ workdir });
    const scopeManager = new PluginScopeManager({
      workdir,
      configurationService,
      pluginManager,
    });

    try {
      await scopeManager.removePluginFromAllScopes(argv.plugin);
      console.log(`Cleaned up plugin configuration from all scopes`);
    } catch (error) {
      console.warn(
        `Warning: Could not clean up all plugin configurations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to uninstall plugin: ${message}`);
    process.exit(1);
  }
}
