import { PluginCore, Scope } from "wave-agent-sdk";

export async function uninstallPluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    // Only the given scope is uninstalled (spec plugin A-015). Without --scope
    // the core picks the scope the plugin is enabled in for this directory.
    const scope = await pluginCore.uninstallPlugin(argv.plugin, argv.scope);
    console.log(
      `Successfully uninstalled plugin: ${argv.plugin} (scope: ${scope})`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to uninstall plugin: ${message}`);
    process.exit(1);
  }
}
