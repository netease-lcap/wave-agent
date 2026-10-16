import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import {
  RelayClient,
  parseRelayControlFrame,
  parseRelayFrame,
  type RelayEnvelope,
  RELAY_CLOSE_BACKPRESSURE,
  RELAY_CLOSE_REPLACED,
  RELAY_CLOSE_UNAVAILABLE,
  RELAY_MAX_ATTEMPTS,
  RELAY_MAX_BUFFERED_BYTES,
  RELAY_MAX_UNAVAILABLE_ATTEMPTS,
  RELAY_PING_INTERVAL_MS,
  RELAY_RETRY_DELAY_MS,
  type RelaySocket,
} from "../../src/remote/relayClient.js";

const URL = "wss://relay.example/v1/hosts/ws/h1/subscribe";

class FakeSocket implements RelaySocket {
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  open(): void {
    this.onopen?.();
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }

  drop(code?: number, reason?: string): void {
    this.onclose?.({ code, reason });
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

describe("RelayClient", () => {
  let sockets: FakeSocket[];
  let onOpen: Mock<() => void>;
  let onAuthenticated: Mock<(info: { role?: string; hostId?: string }) => void>;
  let onAuthError: Mock<(info: { error: string; minVersion?: string }) => void>;
  let onPeerDisconnected: Mock<() => void>;
  let onResyncRequired: Mock<() => void>;
  let onFrame: Mock<(frame: RelayEnvelope) => void>;
  let onFatal: Mock<(reason: string) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    onOpen = vi.fn<() => void>();
    onAuthenticated =
      vi.fn<(info: { role?: string; hostId?: string }) => void>();
    onAuthError =
      vi.fn<(info: { error: string; minVersion?: string }) => void>();
    onPeerDisconnected = vi.fn<() => void>();
    onResyncRequired = vi.fn<() => void>();
    onFrame = vi.fn<(frame: RelayEnvelope) => void>();
    onFatal = vi.fn<(reason: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createClient() {
    return new RelayClient({
      url: URL,
      credential: { type: "host", token: "rch_host-token" },
      version: "1.3.0",
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      onOpen,
      onAuthenticated,
      onAuthError,
      onPeerDisconnected,
      onResyncRequired,
      onFrame,
      onFatal,
    });
  }

  it("should dial the configured url on start", () => {
    const client = createClient();
    client.start();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe(URL);
    expect(client.getState()).toBe("connecting");
  });

  it("should authenticate with the host credential and the CLI version once open", () => {
    const client = createClient();
    client.start();
    sockets[0].open();

    expect(client.getState()).toBe("open");
    expect(sockets[0].frames()).toEqual([
      {
        type: "auth",
        credential: { type: "host", token: "rch_host-token" },
        // Top level on purpose: that is where the relay reads the version, and
        // a version it cannot find is treated as "too old to judge".
        version: "1.3.0",
      },
    ]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("should send the sso credential unchanged for a phone-shaped client", () => {
    const client = new RelayClient({
      url: URL,
      credential: { type: "sso", token: "login-jwt" },
      version: "1.3.0",
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    client.start();
    sockets[0].open();

    expect(sockets[0].frames()).toEqual([
      {
        type: "auth",
        credential: { type: "sso", token: "login-jwt" },
        version: "1.3.0",
      },
    ]);
  });

  it("should forward a parsed frame and ignore a malformed one", () => {
    const client = createClient();
    client.start();
    sockets[0].open();

    sockets[0].deliver(
      JSON.stringify({ method: "getMessages", id: 1, sessionId: "s1" }),
    );
    expect(onFrame).toHaveBeenCalledWith({
      method: "getMessages",
      id: 1,
      sessionId: "s1",
    });

    sockets[0].deliver("{not json");
    sockets[0].deliver(JSON.stringify({ noMethod: true }));
    sockets[0].deliver(undefined);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe("open");
  });

  it("should ping on an interval while open", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );

    vi.advanceTimersByTime(RELAY_PING_INTERVAL_MS * 3);
    const pings = sockets[0].frames().filter((f) => f.type === "ping");
    expect(pings).toHaveLength(3);
    // A control frame, not an envelope: with `method` the relay would forward
    // every heartbeat to every subscriber of this machine.
    expect(pings[0]).toEqual({ type: "ping" });
  });

  it("should stop pinging once the socket is gone", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    sockets[0].drop(1006);

    vi.advanceTimersByTime(RELAY_PING_INTERVAL_MS);
    expect(sockets[0].frames().filter((f) => f.type === "ping")).toHaveLength(
      0,
    );
  });

  it("should send an envelope only while open", () => {
    const client = createClient();
    expect(client.send({ method: "pong" })).toBe(false);

    client.start();
    expect(client.send({ method: "pong" })).toBe(false);

    sockets[0].open();
    expect(client.send({ method: "pong" })).toBe(true);
    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );
    expect(sockets[0].frames().at(-1)).toEqual({ method: "pong" });
  });

  it("should hold back every frame until auth_ok, then replay them in order", () => {
    const client = createClient();
    client.start();
    sockets[0].open();

    client.send({ method: "sessionStatus", params: { sessions: [] } });
    client.sendControl({ type: "host_state", sessionId: "s1", state: "idle" });
    client.send({ method: "messageDelta", params: { text: "hi" } });

    // An unauthenticated connection carries the handshake and nothing else:
    // the relay parses any other frame as `auth`, and a frame it cannot parse
    // is a permanent 4003 — the machine would never come back on its own.
    expect(sockets[0].frames()).toEqual([
      {
        type: "auth",
        credential: { type: "host", token: "rch_host-token" },
        version: "1.3.0",
      },
    ]);

    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );
    expect(sockets[0].frames().map((f) => f.type ?? f.method)).toEqual([
      "auth",
      "sessionStatus",
      "host_state",
      "messageDelta",
    ]);
  });

  it("should replay what was parked on the connection that dropped", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    client.send({ method: "messageDelta", params: { text: "hi" } });
    sockets[0].drop(1006);

    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);
    const retried = sockets.at(-1)!;
    retried.open();
    retried.deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );

    expect(retried.frames().map((f) => f.type ?? f.method)).toEqual([
      "auth",
      "messageDelta",
    ]);
  });

  it("should drop the link rather than park past the queue ceiling", () => {
    const client = createClient();
    client.start();
    sockets[0].open();

    const huge = "x".repeat(RELAY_MAX_BUFFERED_BYTES + 1);
    expect(client.send({ method: "messageDelta", params: { huge } })).toBe(
      false,
    );
    expect(sockets[0].closed?.code).toBe(RELAY_CLOSE_BACKPRESSURE);
    expect(client.getState()).toBe("closed");
  });

  it("should retry a dropped link up to the budget, then report fatal", () => {
    const client = createClient();
    client.start();

    for (let i = 0; i < RELAY_MAX_ATTEMPTS; i++) {
      sockets.at(-1)!.drop(1006);
      vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);
    }
    expect(onFatal).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(RELAY_MAX_ATTEMPTS + 1);

    sockets.at(-1)!.drop(1006);
    expect(onFatal).toHaveBeenCalledWith(
      expect.stringContaining("connection lost"),
    );
    expect(client.getState()).toBe("closed");

    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(RELAY_MAX_ATTEMPTS + 1);
  });

  it("should give 4001 its own, smaller retry budget", () => {
    const client = createClient();
    client.start();

    for (let i = 0; i < RELAY_MAX_UNAVAILABLE_ATTEMPTS; i++) {
      sockets.at(-1)!.drop(4001);
      vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);
    }
    expect(onFatal).not.toHaveBeenCalled();

    sockets.at(-1)!.drop(4001);
    expect(onFatal).toHaveBeenCalledWith(
      expect.stringContaining("unavailable"),
    );
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(RELAY_MAX_UNAVAILABLE_ATTEMPTS + 1);
  });

  it("should step down for good when another process took the channel over", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    sockets[0].drop(RELAY_CLOSE_UNAVAILABLE, RELAY_CLOSE_REPLACED);

    expect(onFatal).toHaveBeenCalledWith(
      expect.stringContaining("took over remote control"),
    );
    expect(client.getState()).toBe("closed");

    // No retry: retrying here is what made two processes replace each other
    // every two seconds forever — each successful connect resets the budget, so
    // neither side ever runs out of it.
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(1);

    client.start();
    expect(sockets).toHaveLength(1);
  });

  it("should treat 4003 as permanent: no retry, no reconnect on a later start", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    sockets[0].drop(4003);

    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining("4003"));
    expect(client.getState()).toBe("closed");

    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(1);

    client.start();
    expect(sockets).toHaveLength(1);
  });

  it("should reset the retry budget after a successful open", () => {
    const client = createClient();
    client.start();

    for (let i = 0; i < RELAY_MAX_ATTEMPTS - 1; i++) {
      sockets.at(-1)!.drop(1006);
      vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);
    }
    sockets.at(-1)!.open();
    sockets.at(-1)!.drop(1006);
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);

    expect(onFatal).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(RELAY_MAX_ATTEMPTS + 1);
  });

  it("should drop a socket that is not draining, and reconnect", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );

    sockets[0].bufferedAmount = RELAY_MAX_BUFFERED_BYTES + 1;
    expect(client.send({ method: "pong" })).toBe(false);

    expect(sockets[0].closed?.code).toBe(4008);
    expect(client.getState()).toBe("closed");

    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);
    expect(sockets).toHaveLength(2);
  });

  it("should report fatal when no WebSocket implementation exists", () => {
    const client = new RelayClient({
      url: URL,
      credential: { type: "host", token: "rch_t" },
      version: "1.3.0",
      createSocket: () => {
        throw new Error("WebSocket is not available in this runtime");
      },
      onFatal,
    });
    client.start();

    expect(onFatal).toHaveBeenCalledWith(
      expect.stringContaining("not available"),
    );
    expect(client.getState()).toBe("closed");
  });

  it("should detach handlers on stop so the close is not mistaken for a drop", () => {
    const client = createClient();
    client.start();
    sockets[0].open();
    const socket = sockets[0];

    client.stop();
    expect(socket.closed?.code).toBe(1000);
    expect(socket.onclose).toBeNull();
    expect(socket.onmessage).toBeNull();

    expect(client.getState()).toBe("closed");
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(1);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("should not start a second connection while one is in flight", () => {
    const client = createClient();
    client.start();
    client.start();
    sockets[0].open();
    client.start();

    expect(sockets).toHaveLength(1);
  });

  it("should ignore events from a socket that was already replaced", () => {
    const client = createClient();
    client.start();
    const first = sockets[0];
    first.open();
    first.drop(1006);
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS);

    // The stale socket keeps firing after we moved on.
    first.deliver(JSON.stringify({ method: "getMessages", id: 9 }));
    expect(onFrame).not.toHaveBeenCalled();
  });
});

describe("relay control frames", () => {
  let sockets: FakeSocket[];
  let onAuthenticated: Mock<(info: { role?: string; hostId?: string }) => void>;
  let onAuthError: Mock<(info: { error: string; minVersion?: string }) => void>;
  let onPeerDisconnected: Mock<() => void>;
  let onResyncRequired: Mock<() => void>;
  let onFrame: Mock<(frame: RelayEnvelope) => void>;
  let onFatal: Mock<(reason: string) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    onAuthenticated =
      vi.fn<(info: { role?: string; hostId?: string }) => void>();
    onAuthError =
      vi.fn<(info: { error: string; minVersion?: string }) => void>();
    onPeerDisconnected = vi.fn<() => void>();
    onResyncRequired = vi.fn<() => void>();
    onFrame = vi.fn<(frame: RelayEnvelope) => void>();
    onFatal = vi.fn<(reason: string) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openClient() {
    const client = new RelayClient({
      url: URL,
      credential: { type: "host", token: "rch_host-token" },
      version: "1.3.0",
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      onAuthenticated,
      onAuthError,
      onPeerDisconnected,
      onResyncRequired,
      onFrame,
      onFatal,
    });
    client.start();
    sockets[0].open();
    // A usable connection: nothing but the auth frame may precede `auth_ok`.
    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );
    return client;
  }

  it("should hand auth_ok to the handshake callback, not to the json-rpc layer", () => {
    openClient();
    sockets[0].deliver(
      JSON.stringify({ type: "auth_ok", role: "host", hostId: "h1" }),
    );

    expect(onAuthenticated).toHaveBeenCalledWith({
      role: "host",
      hostId: "h1",
    });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("should say why 4003 happened, when the relay told us", () => {
    openClient();
    sockets[0].deliver(
      JSON.stringify({ type: "auth_error", error: "invalid_host_token" }),
    );
    expect(onAuthError).toHaveBeenCalledWith({ error: "invalid_host_token" });

    sockets[0].drop(4003);
    expect(onFatal).toHaveBeenCalledWith(
      expect.stringContaining("invalid_host_token"),
    );
  });

  it("should give up for good on a version floor it cannot meet", () => {
    openClient();
    sockets[0].deliver(
      JSON.stringify({
        type: "auth_error",
        error: "host_version_unsupported",
        minVersion: "9.9.9",
      }),
    );

    expect(onFatal).toHaveBeenCalledWith(expect.stringContaining("9.9.9"));
    // The advice is "upgrade", not "the credential is bad", so the close code
    // that follows must not replace it — and no amount of retrying helps.
    sockets[0].drop(4003);
    expect(onFatal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(sockets).toHaveLength(1);
  });

  it("should surface peer_disconnected and resync_required", () => {
    openClient();
    sockets[0].deliver(
      JSON.stringify({ type: "peer_disconnected", hostId: "h1" }),
    );
    sockets[0].deliver(
      JSON.stringify({ type: "resync_required", hostId: "h1" }),
    );

    expect(onPeerDisconnected).toHaveBeenCalledTimes(1);
    expect(onResyncRequired).toHaveBeenCalledTimes(1);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it("should answer a control ping and ignore a control type it does not know", () => {
    const client = openClient();
    sockets[0].deliver(JSON.stringify({ type: "ping" }));
    expect(sockets[0].frames().at(-1)).toEqual({ type: "pong" });

    sockets[0].deliver(JSON.stringify({ type: "from_a_newer_relay" }));
    expect(onFrame).not.toHaveBeenCalled();
    expect(client.getState()).toBe("open");
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("should keep frames that carry a json-rpc marker out of the control layer", () => {
    openClient();
    sockets[0].deliver(
      JSON.stringify({
        type: "auth_ok",
        jsonrpc: "2.0",
        method: "getMessages",
      }),
    );

    // One handshake, from `openClient` — not two: `jsonrpc` disqualifies this
    // frame as a control frame, so it is a JSON-RPC call and belongs to the
    // bridge, `type` and all.
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith({ method: "getMessages" });
  });
});

describe("parseRelayControlFrame", () => {
  it("should parse each control frame the relay can send", () => {
    expect(
      parseRelayControlFrame(
        JSON.stringify({ type: "auth_ok", role: "subscriber", hostId: "h1" }),
      ),
    ).toEqual({ type: "auth_ok", role: "subscriber", hostId: "h1" });
    expect(
      parseRelayControlFrame(
        JSON.stringify({
          type: "auth_error",
          error: "unknown_host",
          minVersion: "1.2.0",
        }),
      ),
    ).toEqual({
      type: "auth_error",
      error: "unknown_host",
      minVersion: "1.2.0",
    });
    expect(
      parseRelayControlFrame(JSON.stringify({ type: "peer_disconnected" })),
    ).toEqual({ type: "peer_disconnected" });
    expect(
      parseRelayControlFrame(JSON.stringify({ type: "resync_required" })),
    ).toEqual({ type: "resync_required" });
    expect(parseRelayControlFrame(JSON.stringify({ type: "pong" }))).toEqual({
      type: "pong",
    });
  });

  it("should leave payload, malformed frames and unknown types alone", () => {
    expect(
      parseRelayControlFrame(JSON.stringify({ method: "getMessages" })),
    ).toBeUndefined();
    expect(parseRelayControlFrame(JSON.stringify({ type: 7 }))).toBeUndefined();
    expect(
      parseRelayControlFrame(JSON.stringify({ type: "who_knows" })),
    ).toBeUndefined();
    // An auth_error without a reason is not actionable, so it is dropped.
    expect(
      parseRelayControlFrame(JSON.stringify({ type: "auth_error" })),
    ).toBeUndefined();
    expect(parseRelayControlFrame("{not json")).toBeUndefined();
    expect(parseRelayControlFrame(Buffer.from("{}"))).toBeUndefined();
  });

  it("should not trust a non-string field", () => {
    expect(
      parseRelayControlFrame(
        JSON.stringify({ type: "auth_ok", role: 3, hostId: null }),
      ),
    ).toEqual({ type: "auth_ok" });
  });
});

describe("parseRelayFrame", () => {
  it("should parse a minimal envelope", () => {
    expect(parseRelayFrame(JSON.stringify({ method: "pong" }))).toEqual({
      method: "pong",
    });
  });

  it("should keep params, a string sessionId and both id kinds", () => {
    expect(
      parseRelayFrame(
        JSON.stringify({
          method: "getMessages",
          params: { limit: 5 },
          sessionId: "s1",
          id: "abc",
        }),
      ),
    ).toEqual({
      method: "getMessages",
      params: { limit: 5 },
      sessionId: "s1",
      id: "abc",
    });
  });

  it("should drop a payload that is not a JSON object with a method", () => {
    expect(parseRelayFrame("not json")).toBeUndefined();
    expect(parseRelayFrame(JSON.stringify([1, 2]))).toBeUndefined();
    expect(parseRelayFrame(JSON.stringify({ method: 1 }))).toBeUndefined();
    expect(parseRelayFrame(Buffer.from("{}"))).toBeUndefined();
  });

  it("should drop a non-string sessionId rather than trust it", () => {
    expect(
      parseRelayFrame(JSON.stringify({ method: "pong", sessionId: 7 })),
    ).toEqual({
      method: "pong",
    });
  });
});
