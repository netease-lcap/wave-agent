/**
 * Lean prompt availability.
 *
 * Lean replaces the static system prompt and each built-in tool's description
 * with condensed text (aligned with Claude Code's simple-system-prompt variant).
 * It rewrites what the model reads every turn, so it is off by default and a
 * session opts in with `leanPrompt: true` rather than getting it silently.
 */
import { loadMergedWaveConfig } from "./configurationService.js";

/** Code default for the lean prompt set. */
export const LEAN_PROMPT_DEFAULT_ENABLED = false;

/**
 * Whether the lean prompt set is used for the given workdir.
 * Resolution order: explicit `leanPrompt` in local merged settings → code
 * default.
 *
 * A failing settings read falls back to the default rather than propagating:
 * this runs on every turn that builds the system prompt and the tool list, and
 * an unreadable configuration must not take the turn down with it.
 */
export function isLeanPromptEnabled(workdir?: string): boolean {
  if (workdir) {
    try {
      const config = loadMergedWaveConfig(workdir);
      if (config?.leanPrompt !== undefined) {
        return config.leanPrompt;
      }
    } catch {
      // Fall through to the code default.
    }
  }
  return LEAN_PROMPT_DEFAULT_ENABLED;
}
