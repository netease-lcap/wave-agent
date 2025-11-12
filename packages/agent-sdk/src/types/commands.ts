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
  allowedTools?: string[];
  model?: string;
  description?: string;
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  description?: string; // Add description field
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
}
