/**
 * Slash command and custom command types
 * Dependencies: None
 */

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string, signal?: AbortSignal) => Promise<void> | void;
  /** Whether this command should bypass the message queue when AI is busy.
   * - `true`: always immediate
   * - Function: receives args, returns true for immediate variants */
  immediate?: boolean | ((args?: string) => boolean);
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
