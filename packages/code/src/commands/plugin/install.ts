import { PluginCore, Scope } from "wave-agent-sdk";

export async function installPluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    const installed = await pluginCore.installPlugin(argv.plugin);
    console.log(
      `Successfully installed plugin: ${installed.name} v${installed.version} from ${installed.marketplace}`,
    );
    console.log(`Cache path: ${installed.cachePath}`);

    if (argv.scope) {
      const pluginId = `${installed.name}@${installed.marketplace}`;
      await pluginCore.enablePlugin(pluginId, argv.scope);
      console.log(`Plugin ${pluginId} enabled in ${argv.scope} scope`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install plugin: ${message}`);
    process.exit(1);
  }
}
