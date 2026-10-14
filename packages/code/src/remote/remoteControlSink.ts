/**
 * The seam between a session holder and the outbound relay that serves a
 * paired phone.
 *
 * Every process that holds sessions needs it, for the same reason and with the
 * same shape:
 *
 * - `--daemon <socket>` — the resident process on a remote host;
 * - `--stdio` — the child each GUI host (desktop / VS Code / JetBrains) spawns
 *   and drives over JSON-RPC;
 * - the interactive CLI itself — the session the user is sitting in front of,
 *   which lives in that process's React state and nowhere else.
 *
 * Whichever one holds the sessions has to be the one serving them: a phone
 * pointed at another process would show a different session set than the user
 * is looking at. So the sink is built where the sessions are, never shared
 * across processes — and, for the CLI, that means built on a `RemoteControlHost`
 * the front end implements rather than on an `AgentBridge` (which the CLI has
 * none of).
 */

import { isRemoteControlEnabled } from "wave-agent-sdk";
import { resolveRemoteControlEndpoint } from "./remoteControlConfig.js";
import {
  RemoteControlService,
  type RemoteControlController,
  type RemoteControlHost,
} from "./remoteControlService.js";

/**
 * A second fan-out target for a server's notifications, beside its local
 * clients (unix-socket clients for the daemon, the host's pipe for `--stdio`).
 *
 * Its lifecycle is deliberately decoupled from the client set: the daemon is
 * resident and a paired phone keeps watching while no desktop is attached —
 * that is the point of serving from the daemon rather than from a GUI host.
 */
export interface RemoteNotificationSink {
  /** Same signature as `JsonRpcConnection.sendNotification`. */
  sendNotification(method: string, params: unknown, sessionId?: string): void;
  stop(): void;
}

/**
 * The two halves of a remote-control sink: the server fans notifications into
 * it, and the bridge routes the three `remoteControl*` RPCs to it.
 */
export interface RemoteControlSink
  extends RemoteNotificationSink,
    RemoteControlController {}

/**
 * Build the sink factory a session holder takes, or `undefined` when remote
 * control is switched off for this process.
 *
 * The switch is read **once**, here, at process start: a machine that was
 * already running keeps its old answer, which is why the CLI hint says to
 * restart (the daemon, or the TUI itself) after changing it. `workdir` decides
 * which settings files are merged — the user-level `~/.wave/settings.json` is
 * always consulted, the workdir's own `.wave/settings.json` only when the
 * process was started there (a GUI host's `--stdio` child inherits the app's
 * cwd, not the project's, so user-level is the reliable place to set it).
 */
export function createRemoteControlSinkFactory(
  workdir: string,
): ((host: RemoteControlHost) => RemoteControlSink) | undefined {
  // Opt-in twice over: this switch says the machine *may* serve its sessions to
  // a paired phone, and `wave remote-control on` / `/remote-control` is what
  // actually dials out. The sink is therefore built but not connected.
  if (!isRemoteControlEnabled(workdir)) {
    return undefined;
  }
  return (host: RemoteControlHost): RemoteControlSink =>
    new RemoteControlService(host, {
      resolveEndpoint: resolveRemoteControlEndpoint,
    });
}
