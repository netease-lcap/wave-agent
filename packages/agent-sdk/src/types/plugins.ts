import { CustomSlashCommand } from "./commands.js";
import { Skill } from "./skills.js";
import { LspConfig } from "./lsp.js";
import { McpConfig } from "./mcp.js";
import { PartialHookConfiguration } from "./hooks.js";

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

/**
 * Represents a loaded plugin in the system
 */
export interface Plugin extends PluginManifest {
  path: string;
  commands: CustomSlashCommand[];
  skills: Skill[];
  lspConfig?: LspConfig;
  mcpConfig?: McpConfig;
  hooksConfig?: PartialHookConfiguration;
}
