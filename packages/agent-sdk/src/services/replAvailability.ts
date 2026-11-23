/**
 * REPL feature availability.
 *
 * The REPL collapses the on-demand tool pool into a single scriptable tool, which
 * changes what the model sees in `tools[]`. It is on by default — the mechanism
 * shipped behind an opt-in switch first, and that switch stays as the way back:
 * `enableRepl: false` (or a remote push) restores the flat declarations. The
 * retired spelling `enableExec` is still accepted at both layers, so a settings
 * file or an admin push written before the rename keeps working.
 *
 * Two switches, one shape: `enableRepl` (the channel) and `enableReplCoreTools`
 * (whether the seven hot tools are pooled into it). Both are booleans resolved
 * the same way, both are separately pushable, and the second is an *input* to the
 * first — see `isReplCoreToolsEnabled`.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";
import { STRUCTURAL_NON_DEFERRABLE } from "../repl/deferral.js";

/** Code default for REPL availability. */
export const REPL_DEFAULT_ENABLED = true;

/**
 * Code default for pooling the core tools. Off, because it turns every hot call
 * into a script wrapper; worth turning on only for a workflow that already thinks
 * in scripts (Claude Code ships it as the default, we do not).
 */
export const REPL_CORE_TOOLS_DEFAULT_ENABLED = false;

/**
 * The settings keys this module reads.
 *
 * `WaveConfiguration` does not declare the two `enableRepl*` keys yet (the
 * settings plumbing lands with the caller's change), so they are read through
 * this structural view rather than widening the public config type from here.
 */
interface ReplSettingsKeys {
  enableRepl?: boolean;
  enableReplCoreTools?: boolean;
  /** Retired spelling of `enableRepl`; still accepted on both layers. */
  enableExec?: boolean;
}

/**
 * One settings layer's boolean, or `undefined` when that layer says nothing.
 *
 * A non-boolean is treated as "says nothing" rather than coerced: a malformed
 * push must not be able to flip a switch, and "unset" is the reading that leaves
 * the fallback chain intact.
 */
function readSetting(
  settings: unknown,
  key: keyof ReplSettingsKeys,
): boolean | undefined {
  const value = (settings as ReplSettingsKeys | null | undefined)?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Whether the REPL tool may be registered for the given workdir.
 *
 * Resolution order, highest first:
 *   remote `enableRepl` → remote `enableExec` → local merged `enableRepl` →
 *   local merged `enableExec` → code default.
 *
 * The legacy key comes after the current one *within the same layer*, and a
 * remote layer always wins over the local one: an admin push is the authority,
 * and it names whichever spelling its version knows.
 */
export function isReplEnabled(workdir?: string): boolean {
  const remote = getRemoteSettingsSync();
  const remoteRepl = readSetting(remote, "enableRepl");
  if (remoteRepl !== undefined) {
    return remoteRepl;
  }
  const remoteLegacy = readSetting(remote, "enableExec");
  if (remoteLegacy !== undefined) {
    return remoteLegacy;
  }
  if (workdir) {
    const config = loadMergedWaveConfig(workdir);
    const localRepl = readSetting(config, "enableRepl");
    if (localRepl !== undefined) {
      return localRepl;
    }
    const localLegacy = readSetting(config, "enableExec");
    if (localLegacy !== undefined) {
      return localLegacy;
    }
  }
  return REPL_DEFAULT_ENABLED;
}

/**
 * Whether the core tools (`Read` / `Glob` / `Grep` / `Bash` / `PowerShell` /
 * `Write` / `Edit`) are pooled into the REPL instead of declared flat.
 *
 * Resolution order: remote `enableReplCoreTools` → local merged
 * `enableReplCoreTools` → code default (`false`).
 *
 * The master switch wins over everything: with `enableRepl: false` there is no
 * sandbox to pool anything into, so this reports `false` whatever the layer says
 * — otherwise those tools would end up neither in `tools[]` nor reachable, which
 * is a capability loss, not a configuration choice.
 */
export function isReplCoreToolsEnabled(workdir?: string): boolean {
  if (!isReplEnabled(workdir)) {
    return false;
  }
  const remoteCore = readSetting(
    getRemoteSettingsSync(),
    "enableReplCoreTools",
  );
  if (remoteCore !== undefined) {
    return remoteCore;
  }
  if (workdir) {
    const localCore = readSetting(
      loadMergedWaveConfig(workdir),
      "enableReplCoreTools",
    );
    if (localCore !== undefined) {
      return localCore;
    }
  }
  return REPL_CORE_TOOLS_DEFAULT_ENABLED;
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
