import { CustomSlashCommand } from "./commands.js";
import { Skill } from "./skills.js";
import { LspConfig } from "./lsp.js";
import { McpConfig } from "./mcp.js";
import { PartialHookConfiguration } from "./configuration.js";

/**
 * Plugin manifest structure (.wave-plugin/plugin.json or .claude-plugin/plugin.json)
 */
export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: {
    name: string;
  };
  /** Claude Code compatibility: plugin keywords */
  keywords?: string[];
  /** Claude Code compatibility: plugin homepage URL */
  homepage?: string;
  /** Claude Code compatibility: repository info */
  repository?: string;
  /** Claude Code compatibility: license info */
  license?: string;
  /** Claude Code compatibility: plugin dependencies */
  dependencies?: Record<string, string>;
  /** Claude Code compatibility: user configuration schema */
  userConfig?: Record<string, unknown>;
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
