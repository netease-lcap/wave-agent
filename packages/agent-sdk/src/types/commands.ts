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

  // Nested command support
  namespace?: string; // Parent directory for nested commands (e.g., "openspec")
  isNested: boolean; // Whether command is in a subdirectory
  depth: number; // 0 = root, 1 = nested
  segments: string[]; // Path components for ID generation (e.g., ["openspec", "apply"])
}
