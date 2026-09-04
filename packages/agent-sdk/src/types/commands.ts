/**
 * Slash command and custom command types
 * Dependencies: None
 */

/** UI-facing source of a skill-derived slash command. "user" covers personal
 *  (~/.wave、~/.claude、~/.agents) skills; plugin skills carry pluginName. */
export type SkillSource = "builtin" | "user" | "project" | "plugin";

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  /** Set only on commands registered from skills — GUI slash-command popup
   * renders a source tag (内置/用户/项目/插件) from it. Plain/custom/plugin
   * commands leave it undefined. */
  skillSource?: SkillSource;
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
