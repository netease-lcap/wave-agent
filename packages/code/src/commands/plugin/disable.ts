import { PluginCore, Scope } from "wave-agent-sdk";

export async function disablePluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    const scope = await pluginCore.disablePlugin(argv.plugin, argv.scope);
    console.log(
      `Successfully disabled plugin: ${argv.plugin} in ${scope} scope`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to disable plugin: ${message}`);
    process.exit(1);
  }
}
