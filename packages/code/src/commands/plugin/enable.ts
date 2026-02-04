import {
  ConfigurationService,
  PluginManager,
  PluginScopeManager,
} from "wave-agent-sdk";

export async function enablePluginCommand(argv: { plugin: string }) {
  const workdir = process.cwd();
  const configurationService = new ConfigurationService();
  const pluginManager = new PluginManager({ workdir });
  const scopeManager = new PluginScopeManager({
    workdir,
    configurationService,
    pluginManager,
  });

  try {
    await scopeManager.enablePlugin(argv.plugin);
    console.log(`Successfully enabled plugin: ${argv.plugin}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to enable plugin: ${message}`);
    process.exit(1);
  }
}
