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

/**
 * One row of the slash-command popup, as it travels over JSON-RPC: everything
 * `SlashCommand` carries **except** `handler` (a function cannot cross the
 * wire — and a host that never registered it could not run it anyway).
 *
 * The machine composes these from two sources: the agent's own commands
 * (skills / custom / plugin, tagged with `skillSource`) and the **one** table
 * of host-local commands it keeps per surface (spec ui/slash-commands.md
 * 「弹窗里的宿主命令只有一份表」). Front ends render what they are given —
 * they keep no command-name list of their own.
 */
export interface SlashCommandInfo {
  id: string;
  name: string;
  description: string;
  /** Set only on skill-backed commands: the popup renders a source tag from it. */
  skillSource?: SkillSource;
  /** 选中即执行：the host itself handles the command (dialog / settings page /
   *  panel), so the popup sends `/name` back instead of inserting it into the
   *  input. Absent = insert the name and let the user type the rest, which is
   *  what `/btw` needs. */
  runOnSelect?: boolean;
}

/**
 * Which front end is asking for the popup's command list.
 *
 * Per **request**, not per process: one machine may serve several at once — a
 * GUI host's `--stdio` child holds the sessions its pane shows *and* the ones a
 * phone took over (spec ui/remote-control.md 边界「`--stdio` 子进程与 daemon
 * 都可能是服务方」), so a process-wide switch would make them share one answer.
 */
export type HostSurface = "desktop" | "vscode" | "jetbrains" | "remote-page";

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
