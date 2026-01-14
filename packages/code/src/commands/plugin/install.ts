import {
  MarketplaceService,
  ConfigurationService,
  PluginManager,
  PluginScopeManager,
} from "wave-agent-sdk";

export async function installPluginCommand(argv: {
  plugin: string;
  scope?: "user" | "project" | "local";
}) {
  const marketplaceService = new MarketplaceService();
  const workdir = process.cwd();

  try {
    const installed = await marketplaceService.installPlugin(argv.plugin);
    console.log(
      `Successfully installed plugin: ${installed.name} v${installed.version} from ${installed.marketplace}`,
    );
    console.log(`Cache path: ${installed.cachePath}`);

    if (argv.scope) {
      const configurationService = new ConfigurationService();
      const pluginManager = new PluginManager({ workdir });
      const scopeManager = new PluginScopeManager({
        workdir,
        configurationService,
        pluginManager,
      });

      const pluginId = `${installed.name}@${installed.marketplace}`;
      await scopeManager.enablePlugin(argv.scope, pluginId);
      console.log(`Plugin ${pluginId} enabled in ${argv.scope} scope`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install plugin: ${message}`);
    process.exit(1);
  }
}
