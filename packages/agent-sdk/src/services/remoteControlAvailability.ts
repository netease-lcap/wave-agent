/**
 * Remote control (phone) availability.
 *
 * Remote control lets a paired phone watch a session and answer its pending
 * tool approvals while the agent keeps running on this machine. Serving it
 * means opening an outbound connection to a relay server and making approvals
 * reachable from off the machine.
 *
 * That exposure happens at **dial time**, not at this switch: the switch only
 * says the machine *may* serve, and `wave remote-control on` (or the GUI's
 * 「开启远程控制」) is what actually opens the relay connection. So the default
 * is on — the capability ships usable — while dialing stays explicit. Turning
 * it off has two doors: `enableRemoteControl: false` in settings, or a remote
 * push from the operator (which wins over both the local value and this
 * default).
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for remote-control availability. */
export const REMOTE_CONTROL_DEFAULT_ENABLED = true;

/**
 * What a settings read that throws counts as.
 *
 * Deliberately independent of the default: the verdict is consulted while
 * standing up a network listener, so a broken settings file must read as
 * "off", never as "on" and never as a crash. Keeping it its own constant is
 * what lets the default flip without silently turning read failures into an
 * enable.
 */
const SETTINGS_READ_FAILURE_ENABLED = false;

/**
 * Whether this machine may serve sessions over the remote-control relay for the
 * given workdir.
 * Resolution order: remote managed settings (`enableRemoteControl` from
 * `GET /api/wave/settings`, admin override) → explicit `enableRemoteControl` in
 * local merged settings → code default (on).
 *
 * A failing settings read falls back to "off" rather than the code default:
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
    return SETTINGS_READ_FAILURE_ENABLED;
  }
  return REMOTE_CONTROL_DEFAULT_ENABLED;
}
