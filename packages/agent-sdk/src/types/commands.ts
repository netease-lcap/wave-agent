/**
 * Slash command and custom command types
 * Dependencies: None
 */

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string) => Promise<void> | void;
}

export interface CustomSlashCommandConfig {
  model?: string;
  description?: string;
  allowedTools?: string[];
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  description?: string; // Add description field
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;

  // Plugin support
  pluginPath?: string; // Absolute path to the plugin root directory (only set for plugin commands)
}
