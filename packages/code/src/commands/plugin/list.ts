import { MarketplaceService, ConfigurationService } from "wave-agent-sdk";

export async function listPluginsCommand() {
  const marketplaceService = new MarketplaceService();
  const configurationService = new ConfigurationService();
  const workdir = process.cwd();

  try {
    const plugins = await marketplaceService.getInstalledPlugins();
    const mergedEnabled = configurationService.getMergedEnabledPlugins(workdir);

    if (plugins.plugins.length === 0) {
      console.log("No plugins installed.");
    } else {
      console.log("Installed Plugins:");
      plugins.plugins.forEach((p) => {
        const pluginId = `${p.name}@${p.marketplace}`;
        const isEnabled = mergedEnabled[pluginId] !== false;
        const status = isEnabled ? "enabled" : "disabled";
        console.log(
          `- ${p.name} v${p.version} (@${p.marketplace}) [${status}]`,
        );
      });
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to list plugins: ${message}`);
    process.exit(1);
  }
}
