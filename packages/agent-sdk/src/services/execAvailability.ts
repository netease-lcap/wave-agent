/**
 * Exec feature availability.
 *
 * Exec collapses the on-demand tool pool into a single scriptable tool, which
 * changes what the model sees in `tools[]`. It is off by default — the mechanism
 * is implemented, but rewriting the shape of `tools[]` is a large enough change
 * that a session opts in with `enableExec: true` (or a remote push) rather than
 * getting it silently.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";
import { STRUCTURAL_NON_DEFERRABLE } from "../exec/deferral.js";

/** Code default for Exec availability. */
export const EXEC_DEFAULT_ENABLED = false;

/**
 * Whether the Exec tool may be registered for the given workdir.
 * Resolution order: remote managed settings (`enableExec` from
 * `GET /api/wave/settings`, admin override) → explicit `enableExec` in local
 * merged settings → code default.
 */
export function isExecEnabled(workdir?: string): boolean {
  const remote = getRemoteSettingsSync();
  if (remote?.enableExec !== undefined) {
    return remote.enableExec;
  }
  if (workdir) {
    const config = loadMergedWaveConfig(workdir);
    if (config?.enableExec !== undefined) {
      return config.enableExec;
    }
  }
  return EXEC_DEFAULT_ENABLED;
}

/**
 * The names the deferral judgment must never pool, as a set.
 *
 * Resolution order for the configurable half: remote managed settings
 * (`nonDeferrableBuiltins` from `GET /api/wave/settings`, admin override) →
 * explicit `nonDeferrableBuiltins` in local merged settings → none. The
 * structural floor is unioned in afterwards and cannot be removed from either
 * direction — this list exists to *pull tools out* of the pool, so an operator
 * editing it can never widen what the sandbox reaches.
 *
 * A name in the list that matches no tool is simply never hit; the list is an
 * override, not a registry, so it must not be validated against the tool set
 * (a remote push naming a tool this build does not have is not an error).
 */
export function getNonDeferrableBuiltins(workdir?: string): Set<string> {
  const names = new Set<string>(STRUCTURAL_NON_DEFERRABLE);
  const remote = getRemoteSettingsSync();
  const configured =
    remote?.nonDeferrableBuiltins ??
    (workdir
      ? loadMergedWaveConfig(workdir)?.nonDeferrableBuiltins
      : undefined);
  for (const name of configured ?? []) {
    names.add(name);
  }
  return names;
}
