import { MarketplaceService } from "wave-agent-sdk";

export async function updatePluginCommand(argv: { plugin: string }) {
  const marketplaceService = new MarketplaceService();

  try {
    const updated = await marketplaceService.updatePlugin(argv.plugin);
    console.log(
      `Successfully updated plugin: ${updated.name} v${updated.version} from ${updated.marketplace}`,
    );
    console.log(`Cache path: ${updated.cachePath}`);

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to update plugin: ${message}`);
    process.exit(1);
  }
}
