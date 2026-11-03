/**
 * Task-tool availability.
 *
 * The four task-list tools (TaskCreate / TaskGet / TaskUpdate / TaskList) are
 * off by default, matching Claude Code's default for current models: the
 * written checklist is scaffolding most conversations do not need, and the
 * tool definitions plus the task reminder cost context on every turn.
 *
 * `WAVE_ENABLE_TASK_TOOLS=1` brings the set back — the same shape as Claude
 * Code's `CLAUDE_CODE_ENABLE_TODO_TOOLS`, named after our own tools (we have no
 * `TodoWrite`; the four `Task*` tools are all there is).
 */
import { loadMergedWaveConfig } from "./configurationService.js";

/** Code default for task-tool availability. */
export const TASK_TOOLS_DEFAULT_ENABLED = false;

/** Environment variable that opts the four task-list tools back in. */
export const TASK_TOOLS_ENV_VAR = "WAVE_ENABLE_TASK_TOOLS";

/**
 * `1`/`true` → on, `0`/`false` → off, anything else (including unset) → no
 * opinion, so the caller falls through to the next layer.
 */
function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return undefined;
}

/**
 * Whether the four task-list tools may be registered for the given workdir.
 * Resolution order: `env.WAVE_ENABLE_TASK_TOOLS` in merged settings.json
 * (session snapshot, wins over the process env like every other `WAVE_*`
 * variable) → `process.env` → code default (off).
 *
 * A failing settings read falls through to the remaining layers rather than
 * propagating: this runs on every tool-registry rebuild, including live reloads
 * triggered by an unrelated settings edit.
 */
export function isTaskToolsEnabled(workdir?: string): boolean {
  let fromSettings: string | undefined;
  if (workdir) {
    try {
      fromSettings = loadMergedWaveConfig(workdir)?.env?.[TASK_TOOLS_ENV_VAR];
    } catch {
      // Fall through to the process env and then the code default.
    }
  }
  return (
    parseFlag(fromSettings) ??
    parseFlag(process.env[TASK_TOOLS_ENV_VAR]) ??
    TASK_TOOLS_DEFAULT_ENABLED
  );
}
