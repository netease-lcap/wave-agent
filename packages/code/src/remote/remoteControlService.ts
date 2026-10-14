/**
 * RemoteControlService — serves a session to a paired phone.
 *
 * It sits beside the local transports: `DaemonServer` fans every notification
 * out to its unix-socket clients, and additionally to this service when remote
 * control is on. The bridge itself is untouched, so a machine with remote
 * control off behaves exactly as before.
 *
 * Three things happen on the remote path that do not happen locally:
 *
 * 1. **Coalescing.** Streamed deltas are merged over a short window
 *    (`NotificationCoalescer`); the local path keeps its per-chunk frames.
 * 2. **Structural pushes become signals.** `messagesChange` carries the whole
 *    display list (13 MB on a long session). Forwarding it would cancel the
 *    point of reading the tail: the phone answers the signal by pulling with
 *    `getMessages({ since })` — the same path a cold start takes.
 * 3. **A status signal.** The relay cannot see inside the frames (that is the
 *    whole design), so it cannot know that somebody is waiting on an approval —
 *    which is the one state where pushing to a phone matters. The machine
 *    therefore reports `running` / `idle` / `requires_action` per session.
 *    This carries no message content, by construction: session ids and one word
 *    each.
 */

import type { AgentBridge } from "../stdio/agentBridge.js";
import type {
  RemoteControlSnapshot,
  RemoteControlStatus,
} from "wave-agent-sdk";
import {
  NotificationCoalescer,
  type RelayFrame,
} from "./notificationCoalescer.js";
import {
  RelayClient,
  type RelayEnvelope,
  type RelaySocketFactory,
} from "./relayClient.js";
import type { RemoteControlEndpoint } from "./remoteControlConfig.js";

/**
 * Methods the remote channel accepts.
 *
 * The local desktop / IDE transports have always been able to call anything —
 * they are the user's own machine talking to itself. A phone page is a web page
 * holding a token, so the remote channel is default-deny and this is the whole
 * of what it may ask for (the chat subset the phone actually renders, taken
 * from the method list in the feature request). Widening it is a deliberate
 * act, not an accident of the bridge's surface.
 */
export const REMOTE_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "listSessions",
  "getSessionInfo",
  "getMessages",
  "listPendingPermissions",
  "permissionResponse",
  "sendMessage",
  "abortMessage",
  "setPermissionMode",
]);

/**
 * How long to wait before recomputing the session status signal. Any
 * notification may be the one that flipped a session between states, so the
 * signal is recomputed on a debounce rather than by enumerating every possible
 * trigger — a missed trigger would leave a phone believing nobody is waiting
 * on an approval, which is the one thing this feature exists to fix.
 */
export const REMOTE_STATUS_DEBOUNCE_MS = 250;

/**
 * What the bridge routes `remoteControl*` requests to. The bridge owns nothing
 * here — same shape as `onShutdownRequest`, where the daemon owns the process
 * lifecycle and the bridge only forwards the call.
 *
 * The snapshot shapes it returns live in the SDK (`wave-agent-sdk`): the hosts
 * and the webview render them and cannot import this package.
 */
export interface RemoteControlController {
  getSnapshot(): RemoteControlSnapshot;
  /** `name` is an optional label for this machine, shown on the phone. */
  connect(name?: string): void;
  disconnect(): void;
}

export interface RemoteControlServiceOptions {
  /**
   * Resolved when connecting, not when the service is built: a resident daemon
   * outlives the SSO token it booted with, and remote control is usually turned
   * on long after the process started. On a machine that has never registered
   * this is also where the one registration call happens, which is why it is
   * async.
   */
  resolveEndpoint: (options?: { name?: string }) => Promise<{
    endpoint?: RemoteControlEndpoint;
    pageUrl?: string;
    error?: string;
  }>;
  createSocket?: RelaySocketFactory;
  onStatusChange?: (status: RemoteControlStatus) => void;
}

export class RemoteControlService implements RemoteControlController {
  private client: RelayClient | undefined;
  private readonly coalescer: NotificationCoalescer;
  private status: RemoteControlStatus = { state: "off" };
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStatusPayload = "";
  private pageUrl: string | undefined;
  private url: string | undefined;
  private name: string | undefined;
  /** Last state announced per session over the control channel. */
  private readonly lastHostStates = new Map<string, string>();
  /** A one-off note from the relay worth showing beside the state. */
  private notice: string | undefined;
  /**
   * Bumped by every `start`/`stop`: registering a machine is an HTTP round trip,
   * and a `stop` that lands in the middle of one must not end with a live
   * connection the user has already turned off.
   */
  private generation = 0;

  constructor(
    private readonly bridge: AgentBridge,
    private readonly options: RemoteControlServiceOptions,
  ) {
    this.coalescer = new NotificationCoalescer((frames) => this.write(frames));
  }

  start(): void {
    const generation = ++this.generation;
    this.setStatus({ state: "connecting" });
    void this.setup(generation);
  }

  /**
   * Resolve the identity (registering this machine on first use), then dial.
   * Every await is followed by a generation check, so a `stop` that arrives
   * while the relay is being asked for a host id wins.
   */
  private async setup(generation: number): Promise<void> {
    const resolved = await this.options.resolveEndpoint(
      this.name !== undefined ? { name: this.name } : {},
    );
    if (generation !== this.generation) return;

    if (!resolved.endpoint) {
      this.setStatus({
        state: "error",
        message: resolved.error ?? "Remote control is unavailable.",
      });
      return;
    }
    const { url, hostToken, version } = resolved.endpoint;
    this.url = url;
    if (resolved.pageUrl) this.pageUrl = resolved.pageUrl;
    // A reconnect has to re-announce every session: the relay keeps the last
    // state it was told, and that state may be minutes old.
    this.lastHostStates.clear();
    this.notice = undefined;

    this.client = new RelayClient({
      url,
      // The machine is not a phone with a login token: it is the thing being
      // controlled, identified by the long-lived token the relay minted when it
      // registered this machine. With `sso` the relay would take this side for a
      // subscriber — the handshake would succeed and the phone would then be
      // told nobody is home (4001).
      credential: { type: "host", token: hostToken },
      version,
      createSocket: this.options.createSocket,
      onAuthenticated: () => {
        this.setStatus({ state: "online" });
        // Tell the phone which CLI build is behind this session: the page is
        // always the newest one, so a mismatch is resolved by asking the user
        // to upgrade the machine, never by keeping old pages around. The label
        // rides along so a user with two computers can tell them apart. Sent
        // after `auth_ok` because frames sent before the handshake are not
        // forwarded anywhere.
        this.client?.send({
          method: "hostHello",
          params: {
            version,
            ...(this.name ? { name: this.name } : {}),
          },
        });
        this.lastHostStates.clear();
        this.emitStatus(true);
      },
      onAuthError: (info) => {
        // The close that follows carries the mechanics (4003 = do not retry);
        // the frame is the only place the *reason* lives, and for a version
        // floor the only place the required version lives.
        this.setStatus({
          state: "error",
          message:
            info.error === "host_version_unsupported"
              ? `the relay requires a newer wave on this machine${info.minVersion ? ` (minimum ${info.minVersion})` : ""}`
              : `the relay refused this machine: ${info.error}`,
        });
      },
      onPeerDisconnected: () => {
        // A host should never be told this; a subscriber is. Recorded rather
        // than acted on: the 4001 that follows is what drives the retry.
        this.notice = "the relay reports the other end of this channel is gone";
      },
      onResyncRequired: () => {
        // Our frames to a slow peer were dropped, so its view is no longer
        // complete — and it cannot tell which frames it lost. Re-announcing
        // every state (not just the changed ones) is what lets it rebuild.
        this.notice =
          "a subscriber fell behind: the relay dropped frames and asked for a resync";
        this.lastHostStates.clear();
        this.emitStatus(true);
      },
      onFrame: (frame) => this.handleFrame(frame),
      onFatal: (message) => {
        if (generation !== this.generation) return;
        this.setStatus({ state: "error", message });
      },
    });
    this.client.start();
  }

  stop(): void {
    // Ordered before the teardown so a registration still in flight cannot
    // finish and dial out afterwards.
    this.generation += 1;
    if (this.statusTimer !== undefined) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }
    this.coalescer.discard();
    const client = this.client;
    this.client = undefined;
    client?.stop();
    this.pageUrl = undefined;
    this.lastHostStates.clear();
    this.notice = undefined;
    this.lastStatusPayload = "";
    this.setStatus({ state: "off" });
  }

  getStatus(): RemoteControlStatus {
    return this.status;
  }

  getSnapshot(): RemoteControlSnapshot {
    // `message` is the error reason when there is one, and otherwise the last
    // thing the relay told us (a peer went away, a resync was requested).
    const message = this.status.message ?? this.notice;
    return {
      state: this.status.state,
      ...(this.url ? { url: this.url } : {}),
      ...(message ? { message } : {}),
      ...(this.pageUrl ? { pageUrl: this.pageUrl } : {}),
    };
  }

  /** The controller surface the bridge routes to. */
  connect(name?: string): void {
    if (name !== undefined) this.name = name;
    this.start();
  }

  disconnect(): void {
    this.stop();
  }

  // ── Outbound: the daemon's notification fan-out ───────────────

  /**
   * Same signature as `JsonRpcConnection.sendNotification`, so the daemon can
   * treat local clients and the relay identically.
   */
  sendNotification(method: string, params: unknown, sessionId?: string): void {
    // Nothing to serve while the link is down. Dropping here (rather than
    // buffering) is deliberate: a phone that was disconnected re-reads the tail
    // through `getMessages({ since })` anyway, so a backlog would only be a
    // burst of frames it is about to discard.
    if (!this.client) return;

    if (method === "messagesChange") {
      // Full-list snapshot. On a long session this is the largest frame the
      // bridge can produce; the phone pulls what it actually needs instead.
      this.send({ method: "messagesChanged", sessionId });
      this.scheduleStatus();
      return;
    }
    this.coalescer.push(method, params, sessionId);
    this.scheduleStatus();
  }

  // ── Inbound: what the phone asks for ──────────────────────────

  private handleFrame(frame: RelayEnvelope): void {
    if (frame.id === undefined) {
      // Notification (no reply expected) — `permissionResponse` is the one the
      // protocol defines.
      try {
        this.bridge.handleNotification(frame.method, frame.params);
      } catch {
        // Notifications have no reply channel; a bad one is not fatal.
      }
      this.scheduleStatus();
      return;
    }

    if (!REMOTE_ALLOWED_METHODS.has(frame.method)) {
      this.send({
        id: frame.id,
        method: "error",
        params: {
          code: -32601,
          message: `Method not available over remote control: ${frame.method}`,
        },
      });
      return;
    }

    void this.bridge
      .handleRequest(frame.method, frame.params, frame.sessionId)
      .then((result) => {
        this.send({ id: frame.id, method: "result", params: { result } });
        this.scheduleStatus();
      })
      .catch((err: unknown) => {
        const { code, message } = describeRpcError(err);
        this.send({
          id: frame.id,
          method: "error",
          params: { code, message },
        });
      });
  }

  // ── Plumbing ──────────────────────────────────────────────────

  /** Frames are simply dropped when the link is down; the phone re-syncs. */
  private send(frame: RelayEnvelope): void {
    this.client?.send(frame);
  }

  private write(frames: RelayFrame[]): void {
    for (const frame of frames) {
      this.send({
        method: frame.method,
        params: frame.params,
        sessionId: frame.sessionId,
      });
    }
  }

  private scheduleStatus(): void {
    if (this.statusTimer !== undefined) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.emitStatus(false);
    }, REMOTE_STATUS_DEBOUNCE_MS);
    this.statusTimer.unref?.();
  }

  /**
   * Recompute and push the per-session status signal. Sent only when it
   * actually changed: at 250 ms debounce this would otherwise be a steady
   * trickle of identical frames for the life of a session.
   *
   * Two carriers, because they serve two readers: the JSON-RPC notification is
   * what the phone page renders, and the `host_state` control frame is the only
   * thing the **relay** reads — it has to, because "somebody is waiting on an
   * approval" is the one state worth a Web Push, and deriving that from a
   * business envelope would mean parsing the payloads it promises not to parse.
   */
  private emitStatus(force: boolean): void {
    let sessions: Array<{ sessionId: string; status: string }>;
    try {
      sessions = this.bridge.listSessionStatuses();
    } catch {
      return;
    }
    const payload = JSON.stringify(sessions);
    if (!force && payload === this.lastStatusPayload) return;
    this.lastStatusPayload = payload;
    this.send({ method: "sessionStatus", params: { sessions } });
    this.reportHostStates(sessions);
  }

  /**
   * Announce every state the relay has not been told yet, one frame per session
   * (`{type:'host_state', sessionId, state}`). Only changes, because the relay
   * turns a transition *into* `requires_action` into a push — re-announcing an
   * unchanged state would be a push per frame.
   *
   * Sessions that went away are simply forgotten: a state the relay holds for a
   * session nobody can ask about does nothing, while a stale `requires_action`
   * would keep a phone ringing about a session that no longer exists.
   */
  private reportHostStates(
    sessions: Array<{ sessionId: string; status: string }>,
  ): void {
    const seen = new Set<string>();
    for (const session of sessions) {
      seen.add(session.sessionId);
      if (this.lastHostStates.get(session.sessionId) === session.status)
        continue;
      this.lastHostStates.set(session.sessionId, session.status);
      this.client?.sendControl({
        type: "host_state",
        sessionId: session.sessionId,
        state: session.status,
      });
    }
    for (const sessionId of [...this.lastHostStates.keys()]) {
      if (!seen.has(sessionId)) this.lastHostStates.delete(sessionId);
    }
  }

  private setStatus(status: RemoteControlStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}

function describeRpcError(err: unknown): { code: number; message: string } {
  const code =
    err && typeof err === "object" && "code" in err
      ? Number((err as { code: unknown }).code)
      : -32603;
  const message = err instanceof Error ? err.message : String(err);
  return { code: Number.isFinite(code) ? code : -32603, message };
}
