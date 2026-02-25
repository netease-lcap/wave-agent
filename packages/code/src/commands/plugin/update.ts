import { PluginService } from "wave-agent-sdk";

export async function updatePluginCommand(argv: { plugin: string }) {
  const pluginService = new PluginService();

  try {
    const updated = await pluginService.updatePlugin(argv.plugin);
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
