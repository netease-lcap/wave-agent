import { PluginService, Scope } from "wave-agent-sdk";

export async function installPluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const pluginService = new PluginService();

  try {
    const installed = await pluginService.install(argv.plugin, argv.scope);
    console.log(
      `Successfully installed plugin: ${installed.name} v${installed.version} from ${installed.marketplace}`,
    );
    console.log(`Cache path: ${installed.cachePath}`);

    if (argv.scope) {
      const pluginId = `${installed.name}@${installed.marketplace}`;
      console.log(`Plugin ${pluginId} enabled in ${argv.scope} scope`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install plugin: ${message}`);
    process.exit(1);
  }
}
