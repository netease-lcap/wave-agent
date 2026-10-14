/**
 * Remote control (phone as a second control plane) — the payload shapes that
 * cross a process boundary.
 *
 * The implementation lives in the CLI (`packages/code/src/remote/`): a wave
 * process that holds sessions opens an outbound relay connection, and the phone
 * page talks to it through the same JSON-RPC the local transports speak. What
 * lives here is only the snapshot the three `remoteControl*` RPCs return, for
 * two consumers that cannot import the CLI:
 *
 * - the hosts (desktop / VS Code / JetBrains), which drive a `wave --stdio`
 *   child over RPC and render `/remote-control`;
 * - the webview, which renders that snapshot and reaches it through
 *   `wave-agent-sdk/types`.
 *
 * Keeping it in the SDK is what makes the host-side reply and the webview-side
 * render agree on one shape instead of two copies that drift.
 */

/** Lifecycle of the outbound relay link. `off` = never connected/dialed. */
export type RemoteControlState = "off" | "connecting" | "online" | "error";

export interface RemoteControlStatus {
  state: RemoteControlState;
  /**
   * Human-readable reason. Carries an `error` explanation, and also relay
   * notices that are worth surfacing without leaving `online` (a subscriber
   * dropping off, a resync request).
   */
  message?: string;
}

export interface RemoteControlSnapshot extends RemoteControlStatus {
  /** Subscribe URL for the current (or last attempted) connection. */
  url?: string;
  /**
   * The page a phone should open: `<server>/remote/?host=<hostId>`.
   *
   * Built by whichever process holds the channel key, because only that process
   * knows both halves — a host's webview has no server URL of its own. The key
   * in it is not a credential: the relay checks on handshake that the channel
   * belongs to the signed-in account, and that the account is an active member
   * of the enterprise.
   */
  pageUrl?: string;
}
