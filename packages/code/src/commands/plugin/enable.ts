import { PluginCore, Scope } from "wave-agent-sdk";

export async function enablePluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    const scope = await pluginCore.enablePlugin(argv.plugin, argv.scope);
    console.log(
      `Successfully enabled plugin: ${argv.plugin} in ${scope} scope`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to enable plugin: ${message}`);
    process.exit(1);
  }
}
