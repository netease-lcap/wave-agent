import type { ShellType } from "../utils/shell/shellProvider.js";

export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";
export const BASH_TOOL_NAME = "Bash";
export const POWERSHELL_TOOL_NAME = "PowerShell";
export const TASK_STOP_TOOL_NAME = "TaskStop";
export const EDIT_TOOL_NAME = "Edit";
export const ENTER_PLAN_MODE_TOOL_NAME = "EnterPlanMode";
export const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";
export const GLOB_TOOL_NAME = "Glob";
export const GREP_TOOL_NAME = "Grep";
export const LSP_TOOL_NAME = "LSP";
export const READ_TOOL_NAME = "Read";
export const SKILL_TOOL_NAME = "Skill";
export const AGENT_TOOL_NAME = "Agent";
export const TASK_CREATE_TOOL_NAME = "TaskCreate";
export const TASK_GET_TOOL_NAME = "TaskGet";
export const TASK_UPDATE_TOOL_NAME = "TaskUpdate";
export const TASK_LIST_TOOL_NAME = "TaskList";
export const WRITE_TOOL_NAME = "Write";
export const CRON_CREATE_TOOL_NAME = "CronCreate";
export const CRON_DELETE_TOOL_NAME = "CronDelete";
export const CRON_LIST_TOOL_NAME = "CronList";
export const WEB_FETCH_TOOL_NAME = "WebFetch";
/**
 * 联网搜索。服务端接口由 codechat 提供（`POST /api/v1/web-search`），入参与回执
 * 逐字对齐 CC 的 `WebSearch`（spec `core/web-search-tool.md`）。
 */
export const WEB_SEARCH_TOOL_NAME = "WebSearch";
export const ENTER_WORKTREE_TOOL_NAME = "EnterWorktree";
export const EXIT_WORKTREE_TOOL_NAME = "ExitWorktree";
export const WORKFLOW_TOOL_NAME = "Workflow";
export const ARTIFACT_TOOL_NAME = "Artifact";
export const ARTIFACT_COMMENTS_TOOL_NAME = "ArtifactComments";

/**
 * Delivers files the model just produced (reports, screenshots, build output)
 * to the user. The tool result carries a clickable path per file; clicking
 * reuses the existing text / image / OS-opener routes
 * (spec `core/send-user-file-tool.md`).
 */
export const SEND_USER_FILE_TOOL_NAME = "SendUserFile";

/**
 * Name of the REPL tool — the carrier of the on-demand tool pool.
 *
 * The tool used to be `Exec`; that spelling is not registered any more, and
 * `REPL_TOOL_ALIASES` carries the names that still are.
 */
export const REPL_TOOL_NAME = "REPL";

/**
 * Other names the same tool answers to. `Eval` is the spelling Claude Code
 * accepted before `REPL`, so hosts register the tool under every name here and
 * an older settings file or permission rule naming `Eval` still lands on it.
 */
export const REPL_TOOL_ALIASES = ["Eval"] as const;

/**
 * The explicit wait of the REPL's async lane.
 *
 * Not a pool member and not an alias: it reads the queue of results that a
 * dispatched script left behind, which makes it the one tool a model calls from
 * outside a script for a reason that only exists because the REPL does.
 */
export const POLL_TOOL_NAME = "Poll";

export const KB_SEARCH_TOOL_NAME = "kb_search";
export const KB_GET_DOC_TOOL_NAME = "kb_get_doc";
export const KB_SUGGEST_TOOL_NAME = "kb_suggest";

/**
 * Every tool that runs a command through a shell. The permission layer judges
 * these by shell *kind* (`ToolPermissionContext.shellKind`) rather than by
 * name, so a new shell tool is added here and nowhere else.
 *
 * `PowerShell` is registered only when the session's shell is PowerShell
 * (`utils/shell/shellToolGate.ts`); the name is a constant regardless, because
 * permission rules, the built-in skills and the settings documentation all key
 * off it.
 */
export const SHELL_TOOL_NAMES = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME] as const;

export type ShellToolName = (typeof SHELL_TOOL_NAMES)[number];

/** true when [toolName] names a shell tool (and so runs a command line). */
export function isShellToolName(toolName: string): toolName is ShellToolName {
  return (SHELL_TOOL_NAMES as readonly string[]).includes(toolName);
}

/** Which shell [toolName] drives; `undefined` for every other tool. */
export function shellKindOfTool(toolName: string): ShellType | undefined {
  switch (toolName) {
    case BASH_TOOL_NAME:
      return "bash";
    case POWERSHELL_TOOL_NAME:
      return "powershell";
    default:
      return undefined;
  }
}
