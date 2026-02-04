import {
  ConfigurationService,
  PluginManager,
  PluginScopeManager,
  Scope,
} from "wave-agent-sdk";

export async function enablePluginCommand(argv: {
  plugin: string;
  scope?: Scope;
}) {
  const workdir = process.cwd();
  const configurationService = new ConfigurationService();
  const pluginManager = new PluginManager({ workdir });
  const scopeManager = new PluginScopeManager({
    workdir,
    configurationService,
    pluginManager,
  });

  const scope =
    argv.scope || scopeManager.findPluginScope(argv.plugin) || "user";

  try {
    await scopeManager.enablePlugin(scope, argv.plugin);
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
