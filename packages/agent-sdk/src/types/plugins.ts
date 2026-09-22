import { CustomSlashCommand } from "./commands.js";
import { Skill } from "./skills.js";
import { LspConfig } from "./lsp.js";
import { McpConfig, McpServerConfig } from "./mcp.js";
import { PartialHookConfiguration } from "./configuration.js";
import { SubagentConfiguration } from "../utils/subagentParser.js";

/**
 * Plugin manifest structure (.wave-plugin/plugin.json)
 */
export interface PluginManifest {
  name: string;
  description: string;
  /**
   * Optional: plugins in the Claude Code ecosystem often omit it (spec plugin
   * A-022). Install and load both fall back to `1.0.0`.
   */
  version?: string;
  author?: {
    name: string;
  };
  /**
   * Inline MCP server declarations, equivalent to a sibling `.mcp.json`
   * (spec plugin A-023). Claude Code also allows a path string or array of
   * paths here; only the object form is supported.
   */
  mcpServers?: Record<string, McpServerConfig>;
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
  /** Always resolved on load: a missing manifest version becomes `1.0.0` (A-022). */
  version: string;
  path: string;
  commands: CustomSlashCommand[];
  skills: Skill[];
  agents: SubagentConfiguration[];
  lspConfig?: LspConfig;
  mcpConfig?: McpConfig;
  hooksConfig?: PartialHookConfiguration;
}
