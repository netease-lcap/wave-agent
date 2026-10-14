/**
 * Remote control (phone) availability.
 *
 * Remote control lets a paired phone watch a session and answer its pending
 * tool approvals while the agent keeps running on this machine. Serving it
 * means opening an outbound connection to a relay server and making approvals
 * reachable from off the machine, so it is **off** unless a user or an operator
 * explicitly asks for it: `enableRemoteControl: true` in settings, or a remote
 * push. The constant below is the code default and the way back.
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for remote-control availability — opt-in. */
export const REMOTE_CONTROL_DEFAULT_ENABLED = false;

/**
 * Whether this machine may serve sessions over the remote-control relay for the
 * given workdir.
 * Resolution order: remote managed settings (`enableRemoteControl` from
 * `GET /api/wave/settings`, admin override) → explicit `enableRemoteControl` in
 * local merged settings → code default (off).
 *
 * A failing settings read falls back to the default rather than propagating:
 * the verdict is consulted while standing up a network listener, and a broken
 * settings file must read as "off", never as "on" and never as a crash.
 */
export function isRemoteControlEnabled(workdir?: string): boolean {
  try {
    const remote = getRemoteSettingsSync();
    if (remote?.enableRemoteControl !== undefined) {
      return remote.enableRemoteControl;
    }
    if (workdir) {
      const config = loadMergedWaveConfig(workdir);
      if (config?.enableRemoteControl !== undefined) {
        return config.enableRemoteControl;
      }
    }
  } catch {
    // Fall through to the code default.
  }
  return REMOTE_CONTROL_DEFAULT_ENABLED;
}
