import { PluginCore } from "wave-agent-sdk";

export async function listPluginsCommand() {
  const pluginCore = new PluginCore(process.cwd());

  try {
    const { plugins, mergedEnabled } = await pluginCore.listPlugins();

    if (plugins.length === 0) {
      console.log("No plugins found in registered marketplaces.");
    } else {
      console.log("Plugins:");
      plugins.forEach((p) => {
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
