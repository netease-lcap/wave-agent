import { PluginService } from "wave-agent-sdk";

export async function uninstallPluginCommand(argv: { plugin: string }) {
  const pluginService = new PluginService();

  try {
    await pluginService.uninstall(argv.plugin);
    console.log(`Successfully uninstalled plugin: ${argv.plugin}`);
    console.log(`Cleaned up plugin configuration from all scopes`);

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to uninstall plugin: ${message}`);
    process.exit(1);
  }
}
