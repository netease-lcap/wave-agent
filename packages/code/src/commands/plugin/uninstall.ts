import { PluginCore } from "wave-agent-sdk";

export async function uninstallPluginCommand(argv: { plugin: string }) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    await pluginCore.uninstallPlugin(argv.plugin);
    console.log(`Successfully uninstalled plugin: ${argv.plugin}`);
    console.log(`Cleaned up plugin configuration from all scopes`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to uninstall plugin: ${message}`);
    process.exit(1);
  }
}
