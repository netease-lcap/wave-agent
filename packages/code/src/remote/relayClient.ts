/**
 * RelayClient — the machine's outbound connection to the remote-control relay.
 *
 * The phone never connects to this machine: it cannot (no public address, no
 * port forwarding). Instead this machine dials out to the relay and subscribes
 * to its own channel:
 *
 *     wss://<relay>/v1/hosts/ws/{hostId}/subscribe
 *
 * The channel is keyed by **this machine**, not by session — a session-level
 * channel cannot work here, because the phone has to learn the session list
 * from this machine in the first place, and a session-level channel would leave
 * the list screen with nowhere to ask (see `codechat#40` §1 for the three
 * reasons). One connection therefore carries every session: `sessionId` is
 * already a field of every JSON-RPC envelope the bridge emits
 * (`agentBridge.emit(method, params, sessionId)`), so the relay keeps forwarding
 * bytes without ever parsing what they mean.
 *
 * Everything about the stream is deliberately dumb: one JSON object per
 * WebSocket message, the same envelope the local transports use, plus the
 * **control frames the relay itself owns**. Those are told apart structurally,
 * not by a whitelist of names: a control frame is a JSON object with a
 * top-level `type` and no `jsonrpc`, and the relay never forwards one — which
 * is exactly why the machine has to speak them (`auth`, `ping`, `host_state`)
 * and parse them (`auth_ok`, `auth_error`, `peer_disconnected`,
 * `resync_required`, `pong`). Everything else is forwarded byte for byte,
 * unparsed, in both directions.
 *
 * A control frame that arrives malformed is dropped, never fed to the local
 * JSON-RPC layer: the relay is a shared component and a future control frame
 * we do not recognise must not take the phone offline or reach the agent.
 */

/** One notification or request travelling in either direction. */
export interface RelayEnvelope {
  method: string;
  params?: unknown;
  sessionId?: string;
  id?: number | string;
}

/**
 * Who this connection is. The relay has exactly two credentials and tells them
 * apart by this field alone:
 *
 * - `host` — the machine being controlled, holding the long-lived token the
 *   relay minted at registration (`rch_…`).
 * - `sso` — a phone, holding the user's login JWT.
 *
 * The two cannot be inferred from the caller: the phone and the machine belong
 * to the **same person**, so there is no identity to distinguish them by. And
 * the machine's link has to outlive an hour-long JWT — it is reconnected for
 * hours — so it needs the revocable `rch_` token rather than a login token.
 */
export interface RelayCredential {
  type: "host" | "sso";
  /** Never logged. */
  token: string;
}

/** The control frames the relay sends us. Not forwarded, not JSON-RPC. */
export type RelayControlFrame =
  | { type: "auth_ok"; role?: string; hostId?: string }
  | { type: "auth_error"; error: string }
  | { type: "peer_disconnected"; hostId?: string }
  | { type: "resync_required"; hostId?: string }
  | { type: "ping" }
  | { type: "pong" };

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The slice of the WebSocket client this transport needs. Node ≥22 ships a
 * global `WebSocket`, so the CLI needs no `ws` dependency; tests inject a
 * scripted double instead of standing up a server.
 */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type RelaySocketFactory = (url: string) => RelaySocket;

export const defaultRelaySocketFactory: RelaySocketFactory = (url) => {
  const Ctor = (
    globalThis as unknown as { WebSocket?: new (url: string) => RelaySocket }
  ).WebSocket;
  if (!Ctor) {
    throw new Error(
      "WebSocket is not available in this runtime (Node >= 22 required)",
    );
  }
  return new Ctor(url);
};

/** Close codes the relay uses to tell us how to react. */
export const RELAY_CLOSE_UNAVAILABLE = 4001; // transient — the host is not ready yet
export const RELAY_CLOSE_UNAUTHORIZED = 4003; // permanent — do not come back
export const RELAY_CLOSE_BACKPRESSURE = 4008; // we gave up on a stuck socket
/**
 * The `4001` reason the relay sends when another process on this machine dialled
 * in and took the channel over (it keeps the original host running the same
 * close code, so only the reason separates "I was replaced" from "this machine
 * is not online" — and those two want opposite answers: step down, versus retry).
 */
export const RELAY_CLOSE_REPLACED = "replaced";

/** Retry cadence. Flat 2s: the relay is a well-known host, not a flaky peer —
 * exponential backoff would only delay a laptop waking from sleep. */
export const RELAY_RETRY_DELAY_MS = 2_000;
/** Attempts for an ordinary drop (relay restart, network blip). */
export const RELAY_MAX_ATTEMPTS = 5;
/** Separate, smaller budget for `4001`: the host announced itself but had no
 * session ready. Retrying a real outage five times buys nothing. */
export const RELAY_MAX_UNAVAILABLE_ATTEMPTS = 3;
/** Idle keepalive. Browsers cannot send WebSocket control pings, and the relay
 * faces the phone anyway, so this is an application-level frame. */
export const RELAY_PING_INTERVAL_MS = 30_000;
/** Above this much unsent data the phone is not keeping up. Closing (rather
 * than queueing) bounds this process's memory; the phone reconnects and catches
 * up through `getMessages({ since })`, which is the same path a cold start
 * takes. Matches the relay's own single-frame ceiling. */
export const RELAY_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export type RelayState = "idle" | "connecting" | "open" | "closed";

export interface RelayClientOptions {
  /** Full subscribe URL, including the host id path segment. */
  url: string;
  /** Who we are on that channel — read from the auth service / state file, never logged. */
  credential: RelayCredential;
  /**
   * This CLI's release version, reported so the relay can enforce the minimum
   * the served page was built against (the page itself is always the newest
   * one; the skew is handled by refusing old clients, not by keeping old
   * pages — see the version note in `docs/specs/ui/remote-control.md`).
   *
   * It sits at the **top level** of the auth frame, not inside `params`: that
   * is where the relay reads it, and a version it cannot parse is silently
   * treated as "too old to judge", i.e. the floor would quietly stop applying.
   */
  version: string;
  createSocket?: RelaySocketFactory;
  /**
   * The socket is up and the auth frame is on the wire. Not "authenticated" —
   * that is `auth_ok` (`onAuthenticated`).
   */
  onOpen?: () => void;
  /** `auth_ok`: the relay accepted us and will fan frames in both directions. */
  onAuthenticated?: (info: { role?: string; hostId?: string }) => void;
  /**
   * `auth_error`. The relay closes with `4003` right after, so this only adds
   * the *reason* — the close code cannot say why.
   */
  onAuthError?: (info: { error: string }) => void;
  /** The other end of this channel is gone (the phone, or the machine). */
  onPeerDisconnected?: () => void;
  /**
   * The relay dropped frames because our peer stopped draining, and asked for
   * a resync: whatever we were sending incrementally is no longer complete.
   */
  onResyncRequired?: () => void;
  /** A frame from the relay (phone request or notification). */
  onFrame?: (frame: RelayEnvelope) => void;
  /** The connection is gone for good — `4003`, or the retry budget ran out. */
  onFatal?: (reason: string) => void;
}

export class RelayClient {
  private state: RelayState = "idle";
  private socket: RelaySocket | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private attempts = 0;
  private unavailableAttempts = 0;
  private stopped = false;
  /** Why the relay refused us, kept so the `4003` that follows can say more. */
  private authError: { error: string } | undefined;
  /**
   * `auth_ok` has arrived. Until it does the relay parses *every* frame as the
   * auth frame, and one it cannot parse closes the connection for good
   * (`4003`, never retried) — so nothing but the auth frame may go out first.
   */
  private authed = false;
  /** Frames held back until `auth_ok`, replayed in order once it lands. */
  private outbox: string[] = [];
  private outboxBytes = 0;

  constructor(private readonly options: RelayClientOptions) {}

  getState(): RelayState {
    return this.state;
  }

  start(): void {
    if (this.stopped || this.state === "connecting" || this.state === "open") {
      return;
    }
    this.connect();
  }

  /** Tear down for good — no retry, no pending timers. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.clearOutbox();
    const socket = this.socket;
    this.socket = undefined;
    this.state = "closed";
    // Close only after detaching handlers: a deliberate stop must not be
    // mistaken for a dropped link and schedule a reconnect.
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, "client stop");
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Send one envelope. Returns false when there is nowhere to put it (the link
   * is down) — the caller may drop the frame; the phone re-syncs from a
   * snapshot on reconnect, so a gap is recoverable, a crash is not. A frame
   * handed over before the handshake completes is parked rather than dropped:
   * it still goes out, in order, the moment the relay accepts us.
   */
  send(frame: RelayEnvelope): boolean {
    return this.write(JSON.stringify(frame));
  }

  /**
   * Send one control frame. Same channel, different judge: control frames are
   * the only ones the relay interprets rather than forwards, so they are plain
   * objects (`{type}`) rather than JSON-RPC envelopes (`{method}`).
   */
  sendControl(frame: Record<string, unknown>): boolean {
    return this.write(JSON.stringify(frame));
  }

  /**
   * The handshake owns the first frame. On an unauthenticated connection the
   * relay parses *every* frame it receives as `auth` (it has no way to tell a
   * straggler apart from the handshake), and a frame that does not parse is a
   * permanent `4003` — so going out early is the difference between "the phone
   * is reconnecting" and "this machine never comes back".
   */
  private write(payload: string): boolean {
    const socket = this.socket;
    if (!socket || this.state !== "open") return false;
    if (!this.authed) return this.park(payload);
    return this.writeNow(payload);
  }

  /**
   * Straight to the wire: the auth frame, and the replay after `auth_ok`. Kept
   * separate from `write` so the one frame that is allowed before the handshake
   * completes has to say so at the call site.
   */
  private writeNow(payload: string): boolean {
    const socket = this.socket;
    if (!socket || this.state !== "open") return false;

    const buffered = socket.bufferedAmount ?? 0;
    if (buffered > RELAY_MAX_BUFFERED_BYTES) {
      this.dropForBackpressure();
      return false;
    }

    try {
      socket.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hold one frame until `auth_ok`. The window is a single relay round trip
   * (the relay verifies the token against the database before answering), so
   * this stays tiny — but it is capped anyway, at the same ceiling `writeNow`
   * uses: a queue that can grow without bound is exactly what the backpressure
   * judgement exists to prevent, and the remedy is the same (drop the link,
   * let the phone resync).
   */
  private park(payload: string): boolean {
    const bytes = Buffer.byteLength(payload, "utf8");
    if (this.outboxBytes + bytes > RELAY_MAX_BUFFERED_BYTES) {
      this.dropForBackpressure();
      return false;
    }
    this.outbox.push(payload);
    this.outboxBytes += bytes;
    return true;
  }

  /** Replay what was parked, in order. Called the moment `auth_ok` lands. */
  private flushOutbox(): void {
    const queued = this.outbox;
    this.clearOutbox();
    for (const payload of queued) {
      // The gate is behind us, so these are ordinary sends again — the
      // backpressure judgement still applies to every one of them.
      if (!this.writeNow(payload)) return;
    }
  }

  private clearOutbox(): void {
    this.outbox = [];
    this.outboxBytes = 0;
  }

  // ── Connection lifecycle ──────────────────────────────────────

  private connect(): void {
    this.state = "connecting";
    // Every socket starts unauthenticated, however the last one ended.
    this.authed = false;
    let socket: RelaySocket;
    try {
      socket = (this.options.createSocket ?? defaultRelaySocketFactory)(
        this.options.url,
      );
    } catch (err) {
      this.state = "closed";
      this.options.onFatal?.((err as Error).message);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.state = "open";
      this.attempts = 0;
      this.unavailableAttempts = 0;
      // The relay authenticates the runner before it will fan anything out, and
      // it reads the version from the top level of this same frame. Ten seconds
      // without it and the relay closes with `auth_timeout` (4003). This is the
      // one frame that may travel before `auth_ok`, so it goes to the wire
      // directly instead of through the gate in `write`.
      this.writeNow(
        JSON.stringify({
          type: "auth",
          credential: {
            type: this.options.credential.type,
            token: this.options.credential.token,
          },
          version: this.options.version,
        }),
      );
      this.startPing();
      this.options.onOpen?.();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      // Control frames are judged first and never reach the JSON-RPC layer:
      // they carry no `method`, so the envelope parser would drop them
      // silently — which is how "the version floor is too low" and "the token
      // was revoked" used to look exactly alike from here.
      const control = parseRelayControlFrame(event.data);
      if (control) {
        this.handleControlFrame(control);
        return;
      }
      const frame = parseRelayFrame(event.data);
      if (frame) this.options.onFrame?.(frame);
    };

    socket.onerror = () => {
      // The close event that follows carries the code; nothing to do here.
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopPing();
      this.handleClose(event?.code, event?.reason);
    };
  }

  private handleClose(code: number | undefined, reason?: string): void {
    if (this.stopped) {
      this.state = "closed";
      return;
    }

    if (code === RELAY_CLOSE_UNAVAILABLE && reason === RELAY_CLOSE_REPLACED) {
      // Another process on this machine dialled in and the relay handed the
      // channel over to it. Retrying would take the channel back, and then the
      // other side would retry too: the two would replace each other every two
      // seconds, forever — every successful connect resets the retry budget, so
      // neither ever exceeds it. So this side steps down for good; dialling
      // again from here is an explicit user action and takes the channel back.
      this.stopped = true;
      this.state = "closed";
      this.options.onFatal?.(
        "another wave process on this machine took over remote control",
      );
      return;
    }

    if (code === RELAY_CLOSE_UNAUTHORIZED) {
      this.stopped = true;
      this.state = "closed";
      this.options.onFatal?.(
        this.authError
          ? `relay rejected the credential (4003): ${this.authError.error}`
          : "relay rejected the credential (4003)",
      );
      return;
    }

    if (code === RELAY_CLOSE_UNAVAILABLE) {
      this.unavailableAttempts += 1;
      if (this.unavailableAttempts > RELAY_MAX_UNAVAILABLE_ATTEMPTS) {
        this.stopped = true;
        this.state = "closed";
        this.options.onFatal?.("relay reported the host unavailable (4001)");
        return;
      }
    } else {
      this.attempts += 1;
      if (this.attempts > RELAY_MAX_ATTEMPTS) {
        this.stopped = true;
        this.state = "closed";
        this.options.onFatal?.(
          `relay connection lost${code === undefined ? "" : ` (${code})`}`,
        );
        return;
      }
    }

    this.state = "closed";
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopped) this.connect();
    }, RELAY_RETRY_DELAY_MS);
    this.retryTimer.unref?.();
  }

  /**
   * The phone stopped draining. Queueing would grow this process without bound,
   * so the link is dropped instead: the phone reconnects and re-reads the tail
   * through `getMessages({ since })`. `4008` tells it not to bother re-sending
   * whatever it had buffered.
   */
  private dropForBackpressure(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = undefined;
    this.stopPing();
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(RELAY_CLOSE_BACKPRESSURE, "backpressure");
    } catch {
      // Already gone.
    }
    this.attempts = 0;
    this.state = "closed";
    if (!this.stopped) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (!this.stopped) this.connect();
      }, RELAY_RETRY_DELAY_MS);
      this.retryTimer.unref?.();
    }
  }

  /**
   * The relay owns the control channel, so it is the one that gets to refuse
   * us — and its refusals are not interchangeable: a revoked token and a build
   * the relay considers too old both end in `4003`, and only the frame tells
   * them apart.
   */
  private handleControlFrame(frame: RelayControlFrame): void {
    switch (frame.type) {
      case "auth_ok":
        this.authError = undefined;
        this.authed = true;
        // Before anything the callback sends: parked frames are older, and the
        // phone has to see them in the order they were produced.
        this.flushOutbox();
        this.options.onAuthenticated?.({
          ...(frame.role !== undefined ? { role: frame.role } : {}),
          ...(frame.hostId !== undefined ? { hostId: frame.hostId } : {}),
        });
        return;
      case "auth_error":
        this.authError = { error: frame.error };
        this.options.onAuthError?.(this.authError);
        return;
      case "peer_disconnected":
        this.options.onPeerDisconnected?.();
        return;
      case "resync_required":
        this.options.onResyncRequired?.();
        return;
      case "ping":
        this.sendControl({ type: "pong" });
        return;
      case "pong":
        return;
    }
  }

  /** Give up for good, with a reason worth showing a human. */
  private fail(reason: string): void {
    this.stopped = true;
    this.clearTimers();
    this.clearOutbox();
    this.state = "closed";
    this.options.onFatal?.(reason);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      // Application-level on purpose: browsers cannot send WebSocket control
      // pings, and this connection is the one a phone page would hold too. The
      // relay answers it (`pong`) and forwards neither direction — with a
      // `method` envelope instead, every heartbeat would be broadcast to every
      // subscriber of this machine.
      this.sendControl({ type: "ping" });
    }, RELAY_PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private clearTimers(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.stopPing();
  }
}

/**
 * Read one **control** frame off the wire, or `undefined` when this is payload.
 *
 * The judge is the relay's own, read in reverse: a JSON object with a top-level
 * string `type` and no `jsonrpc` marker. A `type` we do not know is dropped
 * rather than thrown — a newer relay may grow control frames, and none of them
 * should be able to disconnect a machine — and so is a malformed one, for the
 * same reason `parseRelayFrame` drops those.
 */
export function parseRelayControlFrame(
  data: unknown,
): RelayControlFrame | undefined {
  if (typeof data !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const frame = parsed as Record<string, unknown>;
  const type = asString(frame.type);
  if (type === undefined || frame.jsonrpc !== undefined) return undefined;

  const hostId = asString(frame.hostId);
  switch (type) {
    case "auth_ok": {
      const role = asString(frame.role);
      return {
        type: "auth_ok",
        ...(role !== undefined ? { role } : {}),
        ...(hostId !== undefined ? { hostId } : {}),
      };
    }
    case "auth_error": {
      const error = asString(frame.error);
      if (error === undefined) return undefined;
      // Any `minVersion` an older relay still sends is dropped here: the
      // version floor is no longer part of the contract.
      return { type: "auth_error", error };
    }
    case "peer_disconnected":
      return {
        type: "peer_disconnected",
        ...(hostId !== undefined ? { hostId } : {}),
      };
    case "resync_required":
      return {
        type: "resync_required",
        ...(hostId !== undefined ? { hostId } : {}),
      };
    case "ping":
      return { type: "ping" };
    case "pong":
      return { type: "pong" };
    default:
      return undefined;
  }
}

/**
 * Read one envelope off the wire. A malformed frame is dropped rather than
 * tearing the connection down: the relay is a shared component and a future
 * control frame we do not understand must not take the phone offline.
 *
 * Only frames **without** a top-level `type` reach here — control frames are
 * claimed by `parseRelayControlFrame` first, so this stays a JSON-RPC parser.
 */
export function parseRelayFrame(data: unknown): RelayEnvelope | undefined {
  if (typeof data !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const frame = parsed as {
    method?: unknown;
    params?: unknown;
    sessionId?: unknown;
    id?: unknown;
  };
  if (typeof frame.method !== "string") return undefined;
  const result: RelayEnvelope = { method: frame.method };
  if (frame.params !== undefined) result.params = frame.params;
  if (typeof frame.sessionId === "string") result.sessionId = frame.sessionId;
  if (typeof frame.id === "string" || typeof frame.id === "number") {
    result.id = frame.id;
  }
  return result;
}
