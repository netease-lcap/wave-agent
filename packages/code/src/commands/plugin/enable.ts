import { PluginService, Scope } from "wave-agent-sdk";

export async function enablePluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const pluginService = new PluginService();

  try {
    const targetScope = await pluginService.enable(argv.plugin, argv.scope);
    console.log(
      `Successfully enabled plugin: ${argv.plugin} in ${targetScope} scope`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to enable plugin: ${message}`);
    process.exit(1);
  }
}
