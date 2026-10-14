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

/**
 * A one-time pairing code, issued by the relay at registration time and
 * displayed on this machine.
 *
 * The code belongs to the relay, not to us: it is the relay that keeps the
 * pairing table and trades the code for a long-lived token. It reaches this
 * side as a field of the `POST /api/relay/hosts` response — the relay never
 * pushes one over the socket — so a phone that types an expired code gets its
 * answer from the relay, not from here.
 */
export interface PairingInfo {
  code: string;
  /** Subscribe URL the phone should open, when the relay sends one. */
  url?: string;
  expiresAt?: string;
}

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
  pairing?: PairingInfo;
}
