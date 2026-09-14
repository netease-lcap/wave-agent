/**
 * Exec feature availability.
 *
 * Exec collapses the MCP tool pool into a single scriptable tool, which changes
 * what the model sees in `tools[]`. It is on by default (the collapse only
 * applies once the pool is big enough to be worth it — see
 * `EXEC_MIN_MCP_TOOLS`); `enableExec: false` is the escape hatch for a session
 * that wants the flat MCP declarations back without downgrading.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for Exec availability. */
export const EXEC_DEFAULT_ENABLED = true;

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
