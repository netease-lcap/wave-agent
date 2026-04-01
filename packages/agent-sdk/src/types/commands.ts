/**
 * Slash command and custom command types
 * Dependencies: None
 */

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string, signal?: AbortSignal) => Promise<void> | void;
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
}
