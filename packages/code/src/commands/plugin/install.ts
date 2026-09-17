import { PluginCore, Scope } from "wave-agent-sdk";

export async function installPluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const pluginCore = new PluginCore(workdir);

  try {
    // When no scope is given, default to user scope (matches Claude Code).
    const scope = argv.scope ?? "user";
    const installed = await pluginCore.installPlugin(argv.plugin, scope);
    console.log(
      `Successfully installed plugin: ${installed.name} v${installed.version} from ${installed.marketplace}`,
    );
    console.log(`Cache path: ${installed.cachePath}`);
    console.log(
      `Plugin ${installed.name}@${installed.marketplace} enabled in ${scope} scope`,
    );

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to install plugin: ${message}`);
    process.exit(1);
  }
}
