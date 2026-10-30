import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { AgentBridge } from "../../src/stdio/agentBridge.js";
import {
  RemoteControlService,
  REMOTE_ALLOWED_METHODS,
  REMOTE_STATUS_DEBOUNCE_MS,
} from "../../src/remote/remoteControlService.js";
import { REMOTE_MAX_FRAME_BYTES } from "../../src/remote/frameBudget.js";
import type { RemoteControlStatus } from "wave-agent-sdk";
import {
  RELAY_CLOSE_REPLACED,
  RELAY_CLOSE_UNAVAILABLE,
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

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  open(): void {
    this.onopen?.();
  }

  deliver(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function createBridgeStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    handleRequest: vi.fn(async () => ({ ok: true })),
    handleNotification: vi.fn(),
    listSessionStatuses: vi.fn(() => [{ sessionId: "s1", status: "idle" }]),
    ...overrides,
  } as unknown as AgentBridge;
}

type ResolveFn = (options?: { name?: string }) => Promise<{
  endpoint?: {
    url: string;
    hostId: string;
    hostToken: string;
    version: string;
  };
  pageUrl?: string;
  error?: string;
}>;

describe("RemoteControlService", () => {
  let socket: FakeSocket;
  let onStatusChange: Mock<(status: RemoteControlStatus) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new FakeSocket();
    onStatusChange = vi.fn<(status: RemoteControlStatus) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function defaultResolve() {
    return {
      endpoint: {
        url: URL,
        hostId: "h1",
        hostToken: "rch_host-token",
        version: "1.3.0",
      },
    };
  }

  function createService(
    bridge: AgentBridge,
    resolveEndpoint: ResolveFn = async () => defaultResolve(),
  ) {
    return new RemoteControlService(bridge, {
      resolveEndpoint,
      createSocket: () => socket,
      onStatusChange,
    });
  }

  /**
   * Register-and-connect as one step: resolving the identity is an HTTP round
   * trip on a machine that has never registered, so the socket only exists after
   * a tick. `auth_ok` is what makes the link usable, so the helper waits for it.
   */
  async function connect(
    bridge: AgentBridge,
    resolveEndpoint?: ResolveFn,
  ): Promise<RemoteControlService> {
    const service = createService(bridge, resolveEndpoint);
    service.connect();
    await vi.waitFor(() => {
      expect(socket.onopen).not.toBeNull();
    });
    socket.open();
    socket.deliver({ type: "auth_ok", role: "host", hostId: "h1" });
    return service;
  }

  it("should start offline and dial out on connect", async () => {
    const service = createService(createBridgeStub());
    expect(service.getSnapshot()).toEqual({ state: "off" });

    service.connect();
    expect(service.getSnapshot()).toEqual({ state: "connecting" });

    await vi.waitFor(() => {
      expect(socket.onopen).not.toBeNull();
    });
    socket.open();
    // Dialed, but not usable: the relay has not accepted the credential yet.
    expect(service.getSnapshot()).toEqual({ state: "connecting", url: URL });

    socket.deliver({ type: "auth_ok", role: "host", hostId: "h1" });
    expect(service.getSnapshot()).toEqual({ state: "online", url: URL });
  });

  it("should resolve the endpoint at connect time, not when built", async () => {
    const resolveEndpoint = vi.fn(async () => defaultResolve());
    const service = createService(createBridgeStub(), resolveEndpoint);
    expect(resolveEndpoint).not.toHaveBeenCalled();

    service.connect();
    await vi.waitFor(() => {
      expect(resolveEndpoint).toHaveBeenCalledTimes(1);
    });
  });

  it("should pass the label through to registration", async () => {
    const resolveEndpoint = vi.fn(async () => defaultResolve());
    const service = createService(createBridgeStub(), resolveEndpoint);
    service.connect("MacBook Pro");

    await vi.waitFor(() => {
      expect(resolveEndpoint).toHaveBeenCalledWith({ name: "MacBook Pro" });
    });
  });

  it("should surface why it cannot connect and never dial out", async () => {
    const service = createService(createBridgeStub(), async () => ({
      error: "Not signed in: run /login.",
    }));
    service.connect();

    await vi.waitFor(() => {
      expect(service.getSnapshot()).toMatchObject({
        state: "error",
        message: "Not signed in: run /login.",
      });
    });
    expect(socket.frames()).toHaveLength(0);
    expect(socket.onopen).toBeNull();
  });

  it("should complete the handshake: authenticate as the host, announce, snapshot", async () => {
    await connect(createBridgeStub());

    expect(socket.frames()).toEqual([
      {
        type: "auth",
        credential: { type: "host", token: "rch_host-token" },
        version: "1.3.0",
      },
      { method: "hostHello", params: { version: "1.3.0" } },
      // Sent unconditionally: a phone that just connected has no prior state.
      {
        method: "sessionStatus",
        params: { sessions: [{ sessionId: "s1", status: "idle" }] },
      },
      // …and the relay gets the same fact in the one form it reads.
      { type: "host_state", sessionId: "s1", state: "idle" },
    ]);
  });

  it("should not dial out when the user disconnects mid-registration", async () => {
    let release: (() => void) | undefined;
    const resolveEndpoint = vi.fn(
      async () =>
        await new Promise<Record<string, unknown>>((resolve) => {
          release = () => resolve(defaultResolve());
        }),
    );
    const service = createService(createBridgeStub(), resolveEndpoint);

    service.connect();
    await vi.waitFor(() => {
      expect(resolveEndpoint).toHaveBeenCalled();
    });
    service.disconnect();
    release?.();
    await vi.advanceTimersByTimeAsync(RELAY_PING_INTERVAL_MS);

    expect(service.getSnapshot()).toEqual({ state: "off" });
    // Nothing was ever dialed: a registration that lands after `off` must not
    // resurrect a connection the user has already turned off.
    expect(socket.onopen).toBeNull();
    expect(socket.frames()).toHaveLength(0);
  });

  it("should report an error status when the relay gives up", async () => {
    const service = await connect(createBridgeStub());
    socket.onclose?.({ code: 4003 });

    expect(service.getSnapshot()).toMatchObject({ state: "error" });
    expect(service.getSnapshot().message).toContain("4003");
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "error" }),
    );
  });

  it("should register again when the relay says the stored identity is gone", async () => {
    const resolveEndpoint = vi.fn<ResolveFn>(async () => defaultResolve());
    const service = await connect(createBridgeStub(), resolveEndpoint);

    socket.deliver({ type: "auth_error", error: "invalid_host_token" });
    socket.onclose?.({ code: 4003 });

    // The stored pair is dead, so the machine asks for a new one instead of
    // leaving the user with a file to delete by hand.
    await vi.waitFor(() => {
      expect(resolveEndpoint).toHaveBeenCalledTimes(2);
    });
    expect(resolveEndpoint).toHaveBeenLastCalledWith({
      refreshIdentity: true,
    });
    expect(service.getSnapshot().state).toBe("connecting");
    expect(service.getSnapshot().message).toBe(
      "the relay no longer knows this machine: registering it again",
    );

    // And the fresh credential is what dials out.
    socket.open();
    socket.deliver({ type: "auth_ok", role: "host", hostId: "h1" });
    expect(service.getSnapshot()).toEqual({ state: "online", url: URL });
  });

  it("should heal at most once per process", async () => {
    const resolveEndpoint = vi.fn<ResolveFn>(async () => defaultResolve());
    const service = await connect(createBridgeStub(), resolveEndpoint);

    socket.deliver({ type: "auth_error", error: "invalid_host_token" });
    socket.onclose?.({ code: 4003 });
    await vi.waitFor(() => {
      expect(resolveEndpoint).toHaveBeenCalledTimes(2);
    });

    // The healed connection goes stale too: re-registering mints a new token and
    // the machine may legitimately have another entry holding the old one, so an
    // unbounded heal would be two processes re-signing each other away forever.
    socket.open();
    socket.deliver({ type: "auth_ok", role: "host", hostId: "h1" });
    socket.deliver({ type: "auth_error", error: "invalid_host_token" });
    socket.onclose?.({ code: 4003 });

    expect(resolveEndpoint).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().state).toBe("error");
    expect(service.getSnapshot().message).toContain(
      "even after registering it again",
    );
  });

  it("should say both halves when registering again fails", async () => {
    const resolveEndpoint = vi.fn<ResolveFn>(async () => defaultResolve());
    const service = await connect(createBridgeStub(), resolveEndpoint);

    // The usual cause: a resident daemon outlives its sign-in, so the recovery
    // registration is refused too.
    resolveEndpoint.mockResolvedValue({
      error: "the sign-in is missing or expired: … (run /login).",
    });
    socket.deliver({ type: "auth_error", error: "unknown_host" });
    socket.onclose?.({ code: 4003 });

    await vi.waitFor(() => {
      expect(service.getSnapshot().state).toBe("error");
    });
    expect(service.getSnapshot().message).toBe(
      "the relay no longer knows this machine, and registering it again failed: the sign-in is missing or expired: … (run /login).",
    );
  });

  it("should step down when another entry takes the channel over, and dial again on the next connect", async () => {
    const service = await connect(createBridgeStub());

    socket.onclose?.({
      code: RELAY_CLOSE_UNAVAILABLE,
      reason: RELAY_CLOSE_REPLACED,
    });

    expect(service.getSnapshot()).toMatchObject({ state: "error" });
    expect(service.getSnapshot().message).toContain("took over remote control");
    // Nothing is scheduled: the process that took the channel over keeps it,
    // instead of the two replacing each other every two seconds.
    vi.advanceTimersByTime(RELAY_RETRY_DELAY_MS * 10);
    expect(service.getSnapshot()).toMatchObject({ state: "error" });

    // Dialling again from this entry is an explicit user action, and takes the
    // channel back (the relay hands it to whoever connected last).
    service.connect();
    await vi.waitFor(() => {
      expect(socket.onopen).not.toBeNull();
    });
  });

  it("should say why the relay refused", async () => {
    const service = await connect(createBridgeStub());

    socket.deliver({ type: "auth_error", error: "unknown_host" });

    expect(service.getSnapshot()).toMatchObject({ state: "error" });
    expect(service.getSnapshot().message).toContain("unknown_host");
  });

  it("should run its own keepalive as a control frame", async () => {
    await connect(createBridgeStub());
    vi.advanceTimersByTime(RELAY_PING_INTERVAL_MS);

    expect(socket.frames().some((f) => f.type === "ping")).toBe(true);
  });

  it("should show the page address resolved for this machine", async () => {
    const service = await connect(createBridgeStub(), async () => ({
      ...defaultResolve(),
      pageUrl: "https://codechat.example.com/remote/?host=h1",
    }));

    expect(service.getSnapshot().pageUrl).toBe(
      "https://codechat.example.com/remote/?host=h1",
    );
  });

  it("should route an allowlisted request to the bridge and reply with the result", async () => {
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({ sessions: [] })),
    });
    await connect(bridge);

    socket.deliver({
      id: 7,
      method: "listSessions",
      params: {},
      sessionId: "s1",
    });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)).toEqual({
        id: 7,
        method: "result",
        params: { result: { sessions: [] } },
      });
    });
    expect(bridge.handleRequest).toHaveBeenCalledWith("listSessions", {}, "s1");
  });

  it("should refuse a method that is not on the allowlist, without touching the bridge", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);

    socket.deliver({
      id: 3,
      method: "readFile",
      params: { path: "/etc/passwd" },
    });

    expect(bridge.handleRequest).not.toHaveBeenCalled();
    expect(socket.frames().at(-1)).toEqual({
      id: 3,
      method: "error",
      params: { code: -32601, message: expect.stringContaining("readFile") },
    });
  });

  it("should not accept a mutating method that the allowlist left out", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);

    socket.deliver({ id: 4, method: "shutdown", params: {} });
    expect(bridge.handleRequest).not.toHaveBeenCalled();
    expect(socket.frames().at(-1)).toMatchObject({ method: "error" });

    // The chat methods + conversation upkeep + new-session + the second batch
    // (rewind / clear / model / queue / background work / file search / prompt
    // history) + `/btw` (a one-round side question: same session, no editor, no
    // filesystem) + session deletion (`destroy` with its optional worktree param,
    // and the session-scoped change count the delete card needs) + turning the
    // running turn into a background one (`backgroundCurrentTask`: the phone has
    // no Ctrl/Cmd+B, so the message button is its only entry) are the whole
    // surface. Adding a method here is a deliberate
    // widening, so this list is pinned rather than derived.
    expect([...REMOTE_ALLOWED_METHODS].sort()).toEqual([
      "abortMessage",
      "askBtw",
      "backgroundCurrentTask",
      "clearMessages",
      "compact",
      "createWorktree",
      "deleteQueuedMessageById",
      "destroy",
      "getBackgroundTaskOutput",
      "getConfiguredModels",
      "getMessages",
      "getPromptHistory",
      "getRecentWorkdirs",
      "getSessionInfo",
      "getSessionWorktreeChanges",
      "getSlashCommands",
      "getWorkflowRuns",
      "initialize",
      "listDaemonSessions",
      "listDirectories",
      "listGitBranches",
      "listPendingPermissions",
      "listRewindCheckpoints",
      "listSessions",
      "permissionResponse",
      "rememberRecentWorkdir",
      "renameSession",
      "rewindToMessage",
      "searchFiles",
      "searchPromptHistory",
      "sendMessage",
      "setModel",
      "setPermissionMode",
      "stopBackgroundTask",
      "stopWorkflowRun",
      "updateQueuedMessage",
    ]);
  });

  it("should still refuse the panes the page has no surface for", async () => {
    // The second batch stopped short of these on purpose: no diff / worktree /
    // plan pane on the page, no editor to open a file in. A widening without a
    // caller is pure exposure, so they stay refused. `removeWorktree` /
    // `getWorktreeChanges` are the third batch's version of the same rule: the
    // page deletes through `destroy` (session-keyed) and counts through
    // `getSessionWorktreeChanges`, so the two methods that take a caller-given
    // path are still exactly what a phone must not have.
    const bridge = createBridgeStub();
    await connect(bridge);

    for (const method of [
      "getWorkspaceDiff",
      "getWorktreeChanges",
      "getPlanFile",
      "removeWorktree",
      "openFile",
      "listAllSessions",
      "restoreSession",
    ]) {
      socket.deliver({ id: 10, method, params: {} });
    }

    expect(bridge.handleRequest).not.toHaveBeenCalled();
    const refusals = socket
      .frames()
      .filter((frame) => frame.method === "error")
      .map((frame) => (frame.params as { message: string }).message);
    expect(refusals).toHaveLength(7);
    for (const method of ["getWorkspaceDiff", "removeWorktree"]) {
      expect(refusals.some((message) => message.includes(method))).toBe(true);
    }
  });

  it("should route initialize but strip every parameter outside the picked shape", async () => {
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({ sessionId: "new-1" })),
    });
    await connect(bridge);

    socket.deliver({
      id: 9,
      method: "initialize",
      params: {
        workdir: "~/repos/wave",
        permissionMode: "acceptEdits",
        // Everything below must NOT survive the remote gate.
        apiKey: "sk-evil",
        baseURL: "https://evil.example.com",
        model: "evil-model",
        tools: ["bash"],
        pluginDirs: ["/tmp/evil"],
        mcpServers: { evil: {} },
        restoreSessionId: "s1",
        // …including the telemetry entrypoint: the channel stamps its own below.
        entrypoint: "desktop",
      },
    });
    await vi.waitFor(() => {
      expect(bridge.handleRequest).toHaveBeenCalledWith(
        "initialize",
        {
          workdir: "~/repos/wave",
          permissionMode: "acceptEdits",
          // Stamped by the channel rather than picked: a session created from
          // the page is `remote` even though the daemon hosting it was started
          // from a CLI (docs/specs/enterprise/opentelemetry.md「宿主入口标识」).
          entrypoint: "remote",
        },
        undefined,
      );
    });
    expect(socket.frames().at(-1)).toMatchObject({
      id: 9,
      method: "result",
    });
  });

  it("should keep other methods' params intact while initialize is picked", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);

    socket.deliver({
      id: 10,
      method: "listDirectories",
      params: { dir: "~" },
    });
    await vi.waitFor(() => {
      expect(bridge.handleRequest).toHaveBeenCalledWith(
        "listDirectories",
        { dir: "~" },
        undefined,
      );
    });
  });

  it("should relay a bridge failure as an error carrying its code", async () => {
    const err = Object.assign(new Error("no such session"), { code: -32001 });
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => {
        throw err;
      }),
    });
    await connect(bridge);

    socket.deliver({
      id: 5,
      method: "getMessages",
      params: {},
      sessionId: "gone",
    });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)).toEqual({
        id: 5,
        method: "error",
        params: { code: -32001, message: "no such session" },
      });
    });
  });

  it("should treat a frame without an id as a notification", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);

    socket.deliver({
      method: "permissionResponse",
      params: { requestId: "r1" },
    });

    expect(bridge.handleNotification).toHaveBeenCalledWith(
      "permissionResponse",
      {
        requestId: "r1",
      },
    );
    expect(bridge.handleRequest).not.toHaveBeenCalled();
  });

  it("should survive a notification the bridge rejects", async () => {
    const bridge = createBridgeStub({
      handleNotification: vi.fn(() => {
        throw new Error("bad notification");
      }),
    });
    await connect(bridge);

    expect(() =>
      socket.deliver({ method: "permissionResponse", params: {} }),
    ).not.toThrow();
  });

  it("should strip a payload from messagesChange and forward only the signal", async () => {
    // Producers in this build already send `{}`, so this test guards the older
    // producer shape: a build that still attaches the display list must not put
    // a multi-MB frame on the relay, and the phone must keep seeing exactly one
    // shape (spec remote-control「messagesChange 只有一种形态」).
    const service = await connect(createBridgeStub());
    socket.sent.length = 0;

    service.sendNotification(
      "messagesChange",
      { messages: [{ content: "x".repeat(1000) }] },
      "s1",
    );

    expect(socket.frames()).toEqual([
      { method: "messagesChange", sessionId: "s1" },
    ]);
  });

  it("should merge a streaming burst on the way to the relay", async () => {
    const bridge = createBridgeStub();
    const service = await connect(bridge);
    socket.sent.length = 0;

    for (const chunk of ["h", "e", "y"]) {
      service.sendNotification(
        "assistantContentUpdated",
        { messageId: "m1", chunk, stage: "streaming" },
        "s1",
      );
    }
    vi.advanceTimersByTime(150);

    const deltas = socket
      .frames()
      .filter((f) => f.method === "assistantContentUpdated");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({
      method: "assistantContentUpdated",
      params: { messageId: "m1", stage: "streaming", chunk: "hey" },
      sessionId: "s1",
    });
  });

  it("should push a per-session status signal once per burst, after the debounce", async () => {
    // Starts idle, then somebody starts waiting on an approval mid-burst.
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "idle" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    const service = await connect(bridge);
    socket.sent.length = 0;
    statuses[0] = { sessionId: "s1", status: "requires_action" };

    for (const chunk of ["a", "b", "c"]) {
      service.sendNotification(
        "assistantContentUpdated",
        { messageId: "m1", chunk, stage: "streaming" },
        "s1",
      );
    }

    expect(
      socket.frames().filter((f) => f.method === "sessionStatus"),
    ).toHaveLength(0);
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    const status = socket.frames().filter((f) => f.method === "sessionStatus");
    expect(status).toHaveLength(1);
    expect(status[0].params).toEqual({
      sessions: [{ sessionId: "s1", status: "requires_action" }],
    });
  });

  it("should not repeat a status signal that did not change", async () => {
    const bridge = createBridgeStub();
    const service = await connect(bridge);
    // The handshake already sent the current state; nothing has changed since.
    socket.sent.length = 0;

    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");
    service.sendNotification("permissionRequest", { requestId: "r2" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS * 3);

    expect(
      socket.frames().filter((f) => f.method === "sessionStatus"),
    ).toHaveLength(0);
    expect(socket.frames().filter((f) => f.type === "host_state")).toHaveLength(
      0,
    );
  });

  it("should re-send the status signal when a session flips state", async () => {
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "idle" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    const service = await connect(bridge);
    socket.sent.length = 0;

    statuses[0] = { sessionId: "s1", status: "requires_action" };
    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    statuses[0] = { sessionId: "s1", status: "idle" };
    service.sendNotification("permissionRequest", { requestId: "r2" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    const signals = socket.frames().filter((f) => f.method === "sessionStatus");
    expect(signals.map((f) => f.params)).toEqual([
      { sessions: [{ sessionId: "s1", status: "requires_action" }] },
      { sessions: [{ sessionId: "s1", status: "idle" }] },
    ]);
  });

  it("should annotate every state change for the relay, once", async () => {
    // The relay turns a transition into `requires_action` into a push, so it
    // has to hear exactly the transitions — one frame each, no repeats.
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "idle" },
      { sessionId: "s2", status: "idle" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    const service = await connect(bridge);
    socket.sent.length = 0;

    statuses[0] = { sessionId: "s1", status: "requires_action" };
    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    // Same states again: nothing new for the relay to act on.
    service.sendNotification("permissionRequest", { requestId: "r2" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    expect(socket.frames().filter((f) => f.type === "host_state")).toEqual([
      { type: "host_state", sessionId: "s1", state: "requires_action" },
      // s2 never changed, so it was never re-announced.
    ]);
  });

  it("should re-announce every session after a reconnect", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);
    // A second connection: the relay restarted, so it knows nothing.
    socket.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(2_000);
    socket.open();
    socket.deliver({ type: "auth_ok", role: "host", hostId: "h1" });

    const states = socket.frames().filter((f) => f.type === "host_state");
    expect(states).toEqual([
      { type: "host_state", sessionId: "s1", state: "idle" },
      { type: "host_state", sessionId: "s1", state: "idle" },
    ]);
  });

  it("should forget a session that went away instead of ringing about it", async () => {
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "requires_action" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    const service = await connect(bridge);
    socket.sent.length = 0;

    statuses.length = 0;
    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);
    expect(socket.frames().filter((f) => f.type === "host_state")).toHaveLength(
      0,
    );

    // …and if the same state comes back on a new session, it is news again.
    statuses.push({ sessionId: "s2", status: "requires_action" });
    service.sendNotification("permissionRequest", { requestId: "r2" }, "s2");
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);
    expect(socket.frames().filter((f) => f.type === "host_state")).toEqual([
      { type: "host_state", sessionId: "s2", state: "requires_action" },
    ]);
  });

  it("should also report status when the phone asks for something", async () => {
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "idle" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    await connect(bridge);
    socket.sent.length = 0;
    statuses[0] = { sessionId: "s1", status: "running" };

    socket.deliver({ id: 1, method: "listSessions", params: {} });
    await vi.waitFor(() => {
      expect(socket.frames().some((f) => f.method === "result")).toBe(true);
    });
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS);

    expect(
      socket
        .frames()
        .filter((f) => f.method === "sessionStatus")
        .map((f) => f.params),
    ).toEqual([{ sessions: [{ sessionId: "s1", status: "running" }] }]);
  });

  it("should treat a resync request as a reason to re-announce everything", async () => {
    const bridge = createBridgeStub();
    const service = await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ type: "resync_required", hostId: "h1" });

    // A subscriber fell behind and had frames dropped: its view is incomplete,
    // so the states are re-sent rather than diffed against the last ones.
    expect(socket.frames().filter((f) => f.type === "host_state")).toEqual([
      { type: "host_state", sessionId: "s1", state: "idle" },
    ]);
    expect(service.getSnapshot().message).toContain("resync");
  });

  it("should note a peer that went away without inventing a failure", async () => {
    const service = await connect(createBridgeStub());
    socket.deliver({ type: "peer_disconnected", hostId: "h1" });

    // Still online from our side; the 4001 that follows is what acts.
    expect(service.getSnapshot().state).toBe("online");
    expect(service.getSnapshot().message).toContain("gone");
  });

  it("should drop a buffered burst when the operator disconnects", async () => {
    const bridge = createBridgeStub();
    const service = await connect(bridge);
    socket.sent.length = 0;

    service.sendNotification(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    service.disconnect();
    vi.advanceTimersByTime(150);

    expect(socket.frames()).toHaveLength(0);
    expect(service.getSnapshot()).toEqual({ state: "off", url: URL });
    expect(socket.closed?.code).toBe(1000);
  });

  it("should stop the status timer on disconnect", async () => {
    const statuses: Array<{ sessionId: string; status: string }> = [
      { sessionId: "s1", status: "idle" },
    ];
    const bridge = createBridgeStub({
      listSessionStatuses: vi.fn(() => statuses),
    });
    const service = await connect(bridge);
    socket.sent.length = 0;
    statuses[0] = { sessionId: "s1", status: "requires_action" };

    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");
    service.disconnect();
    vi.advanceTimersByTime(REMOTE_STATUS_DEBOUNCE_MS * 4);

    // The pending change is never reported: the link it would report on is gone.
    expect(socket.frames().map((f) => f.method)).toEqual(["permissionRequest"]);
  });

  it("should consume the relay's own frames instead of forwarding them", async () => {
    const bridge = createBridgeStub();
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ type: "pong" });
    // A control frame we do not know: dropped, never fed to the JSON-RPC layer.
    socket.deliver({ type: "some_future_frame" });

    expect(bridge.handleNotification).not.toHaveBeenCalled();
    expect(bridge.handleRequest).not.toHaveBeenCalled();
    expect(socket.frames()).toHaveLength(0);
  });

  // Spec ui/remote-control.md「远端通道只开一个白名单」场景 10: user image bytes
  // stay in the block for GUI hosts, but must not go over the relay.
  it("should blank user image bytes in a getMessages result", async () => {
    const messages = [
      {
        id: "m1",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [
          { type: "text", content: "look at [image0]" },
          {
            type: "image",
            imageUrls: ["data:image/png;base64,aGVsbG8="],
            imagePaths: ["/tmp/wave-image-a.png"],
          },
        ],
      },
    ];
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({ messages })),
    });
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ id: 11, method: "getMessages", params: {} });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)?.method).toBe("result");
    });

    const frame = socket.frames().at(-1) as {
      params: { result: { messages: typeof messages } };
    };
    const block = frame.params.result.messages[0].blocks[1];
    // Same number of images (the `[imageN]` tags are positional), no bytes.
    expect(block).toEqual({ type: "image", imageUrls: [""] });
  });

  // ── The frame budget ──────────────────────────────────────────────
  //
  // The relay drops any single frame that does not fit its per-subscriber
  // buffer, and it drops it silently. So the budget is enforced here, where we
  // can still choose what the phone gets instead of losing the frame.

  /** A page of messages whose serialized size is comfortably over the budget. */
  function oversizedMessages(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `m${String(index)}`,
      content: "x".repeat(16 * 1024),
    }));
  }

  it("should trim an over-budget page to the newest messages that fit", async () => {
    const all = oversizedMessages(40);
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({ messages: all, total: all.length })),
    });
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ id: 9, method: "getMessages", params: { limit: 40 } });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)?.method).toBe("result");
    });

    const frame = socket.frames().at(-1) as {
      id: number;
      params: {
        result: {
          messages: Array<{ id: string }>;
          total?: number;
        };
      };
    };
    const kept = frame.params.result.messages;
    expect(frame.id).toBe(9);
    // A usable page rather than nothing — and the newest end of it, because
    // that is the part the phone was asking for.
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(all.length);
    expect(kept.at(-1)?.id).toBe("m39");
    expect(kept[0]?.id).toBe(`m${String(all.length - kept.length)}`);
    expect(frame.params.result.total).toBe(all.length);
    // The trim is against the frame as it goes on the wire, envelope included.
    expect(
      Buffer.byteLength(JSON.stringify(frame), "utf8"),
    ).toBeLessThanOrEqual(REMOTE_MAX_FRAME_BYTES);
  });

  it("should send a page that already fits untouched", async () => {
    const all = oversizedMessages(2);
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({ messages: all, total: all.length })),
    });
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ id: 10, method: "getMessages", params: { limit: 2 } });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)?.method).toBe("result");
    });

    expect(socket.frames().at(-1)).toEqual({
      id: 10,
      method: "result",
      params: { result: { messages: all, total: all.length } },
    });
  });

  it("should refuse an over-budget answer that cannot be paged", async () => {
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({
        sessions: [
          { sessionId: "s1", title: "x".repeat(REMOTE_MAX_FRAME_BYTES + 1024) },
        ],
      })),
    });
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ id: 11, method: "listSessions", params: {} });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)?.method).toBe("error");
    });

    // Truncating it would hand the phone a well-formed lie about which sessions
    // exist; there is no "newer part" of such an answer to prefer.
    expect(socket.frames().at(-1)).toMatchObject({
      id: 11,
      method: "error",
      params: {
        code: -32603,
        message: expect.stringContaining("frame budget"),
      },
    });
  });

  it("should refuse a page not even one message of which fits", async () => {
    const bridge = createBridgeStub({
      handleRequest: vi.fn(async () => ({
        messages: [
          { id: "m1", content: "x".repeat(REMOTE_MAX_FRAME_BYTES + 1024) },
        ],
      })),
    });
    await connect(bridge);
    socket.sent.length = 0;

    socket.deliver({ id: 12, method: "getMessages", params: { limit: 1 } });
    await vi.waitFor(() => {
      expect(socket.frames().at(-1)?.method).toBe("error");
    });

    // An empty list would only make the phone ask again forever.
    expect(socket.frames().at(-1)).toMatchObject({
      id: 12,
      method: "error",
      params: { code: -32603 },
    });
  });

  it("should stand in for an over-budget notification with a re-read signal", async () => {
    const service = await connect(createBridgeStub());
    socket.sent.length = 0;

    service.sendNotification(
      "permissionRequest",
      {
        requestId: "r1",
        context: { planContent: "x".repeat(REMOTE_MAX_FRAME_BYTES + 1024) },
      },
      "s1",
    );

    // Silently dropping this one would leave an approval nobody can answer, so
    // the phone is told to re-read the snapshot instead of nothing at all.
    expect(socket.frames()).toEqual([
      { method: "messagesChanged", params: { full: true }, sessionId: "s1" },
    ]);
  });

  it("should leave a notification that fits alone", async () => {
    const service = await connect(createBridgeStub());
    socket.sent.length = 0;

    service.sendNotification("permissionRequest", { requestId: "r1" }, "s1");

    expect(socket.frames()).toEqual([
      {
        method: "permissionRequest",
        params: { requestId: "r1" },
        sessionId: "s1",
      },
    ]);
  });
});
