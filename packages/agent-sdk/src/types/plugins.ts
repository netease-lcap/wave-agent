import { CustomSlashCommand } from "./commands.js";
import { Skill } from "./skills.js";
import { LspConfig } from "./lsp.js";
import { McpConfig } from "./mcp.js";
import { PartialHookConfiguration } from "./configuration.js";
import { SubagentConfiguration } from "../utils/subagentParser.js";

/**
 * Plugin manifest structure (.wave-plugin/plugin.json)
 */
export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: {
    name: string;
  };
}

/**
 * Plugin configuration in AgentOptions or wave.settings.json
 */
export interface PluginConfig {
  type: "local";
  path: string;
}

/** A plugin root that failed to load during the most recent load/reload. */
export interface PluginLoadFailure {
  path: string;
  error: string;
}

/** Result of `Agent.reloadPlugins()` / `PluginManager.reloadAllPlugins()`. */
export interface PluginReloadResult {
  /** Plugin names loaded after the reload. */
  plugins: string[];
  /** Plugins that could not be loaded; the reload does not roll back. */
  failures: PluginLoadFailure[];
}

/**
 * Represents a loaded plugin in the system
 */
export interface Plugin extends PluginManifest {
  path: string;
  commands: CustomSlashCommand[];
  skills: Skill[];
  agents: SubagentConfiguration[];
  lspConfig?: LspConfig;
  mcpConfig?: McpConfig;
  hooksConfig?: PartialHookConfiguration;
}
