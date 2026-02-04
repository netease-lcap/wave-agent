import {
  ConfigurationService,
  PluginManager,
  PluginScopeManager,
  Scope,
} from "wave-agent-sdk";

export async function disablePluginCommand(argv: {
  plugin: string;
  scope: Scope;
}) {
  const workdir = process.cwd();
  const configurationService = new ConfigurationService();
  const pluginManager = new PluginManager({ workdir });
  const scopeManager = new PluginScopeManager({
    workdir,
    configurationService,
    pluginManager,
  });

  try {
    await scopeManager.disablePlugin(argv.scope, argv.plugin);
    console.log(
      `Successfully disabled plugin: ${argv.plugin} in ${argv.scope} scope`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to disable plugin: ${message}`);
    process.exit(1);
  }
}
