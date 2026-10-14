/**
 * The remote page's shim, driven the way a browser drives it: a stub WebSocket
 * on one side, the shared UI's `acquireVsCodeApi()` on the other.
 *
 * The shim ships as plain browser JS with no build step and no module system, so
 * the tests load the shipped file itself (`remote/shim.js`) rather than a copy —
 * what is under test is the thing that ships.
 *
 * The relay is device-level: one socket carries every session the serving
 * process holds, and the envelope's `sessionId` is the only thing that says
 * which conversation a frame belongs to. So the interesting cases here are all
 * about *misattribution* — another session's frames, a switch that overtakes an
 * in-flight reply, a stale pin from the address.
 *
 * Scope split with the sibling `shim.test.ts`: that file owns the login hop
 * (`location.replace`, which jsdom performs as a no-op), this one owns everything
 * that goes over the socket. jsdom is what makes the latter drivable — real
 * promises, timers and `window.dispatchEvent` for the host→page direction.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SHIM = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../remote/shim.js"),
  "utf8",
);

type Frame = Record<string, unknown>;

const SESSIONS = [
  {
    sessionId: "s-old",
    workingDirectory: "/tmp/other",
    lastActiveAt: "2026-10-14T09:00:00.000Z",
  },
  {
    sessionId: "s-new",
    workingDirectory: "/repo",
    customTitle: "登录页",
    lastActiveAt: "2026-10-14T10:00:00.000Z",
  },
];

const SEED = { id: "m1", role: "user", blocks: [] };

/** Stands in for the relay's socket: frames out are recorded, frames in are pushed. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }

  send(line: string) {
    this.sent.push(line);
  }

  /** The relay completed the handshake. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The relay pushed one frame at the page. */
  receive(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(): Frame[] {
    return this.sent.map((line) => JSON.parse(line) as Frame);
  }

  /** Requests for one method, in the order they went out. */
  framesFor(method: string): Frame[] {
    return this.frames().filter((frame) => frame.method === method);
  }
}

let messageListeners: Array<(event: MessageEvent) => void> = [];

/**
 * Load the page in a browser-like environment and complete the handshake — unless
 * the caller passes `handshake: false` to observe the pre-handshake state itself.
 */
function startPage(search: string, handshake = true) {
  const posted: Frame[] = [];
  const listener = (event: MessageEvent) => posted.push(event.data as Frame);
  messageListeners.push(listener);
  window.addEventListener("message", listener);

  window.history.replaceState({}, "", "/remote/" + search);
  window.localStorage.setItem("token", "sso-token");

  new Function(SHIM)();
  const socket = FakeSocket.opened[FakeSocket.opened.length - 1];
  if (handshake) {
    socket.open();
    socket.receive({ type: "auth_ok" });
  }

  const answered = new Set<unknown>();
  return {
    socket,
    posted,
    api: (
      window as unknown as {
        acquireVsCodeApi(): { postMessage(msg: unknown): void };
      }
    ).acquireVsCodeApi(),
    /** How many requests for `method` the page has sent so far. */
    requests: (method: string) => socket.framesFor(method).length,
    /**
     * Reply to the oldest unanswered request for `method`, as the machine would,
     * and let the page take its next step before returning.
     */
    async answer(method: string, result: unknown) {
      const frame = nextFrame(method);
      socket.receive({ id: frame.id, result });
      await flush();
      return frame;
    },
    /** Refuse the oldest unanswered request for `method`, as a machine would. */
    async refuse(method: string, message: string) {
      const frame = nextFrame(method);
      socket.receive({ id: frame.id, error: { message } });
      await flush();
      return frame;
    },
  };

  function nextFrame(method: string) {
    const frame = socket
      .framesFor(method)
      .find((candidate) => !answered.has(candidate.id));
    if (!frame) throw new Error(`the page never sent a ${method} request`);
    answered.add(frame.id);
    return frame;
  }
}

/** Let the promises inside the shim settle. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/** The last message the page handed to the shared UI. */
function lastPosted(page: { posted: Frame[] }) {
  return page.posted[page.posted.length - 1];
}

/** Boot + mount (webviewReady) + first snapshot, i.e. the page as the phone sees it. */
async function openPage(search = "?host=h-1") {
  const page = startPage(search);
  await flush();
  page.api.postMessage({ command: "webviewReady" });
  await flush();
  await page.answer("listDaemonSessions", { sessions: SESSIONS });
  const pull = await page.answer("getMessages", { messages: [SEED] });
  await page.answer("listPendingPermissions", { requests: [] });
  return { page, pull };
}

beforeEach(() => {
  FakeSocket.opened = [];
  messageListeners = [];
  // A real page load starts from a fresh document; jsdom reuses one, and the
  // shim's status banner is a plain DOM node it never removes on teardown.
  document.getElementById("remote-status")?.remove();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const listener of messageListeners) {
    window.removeEventListener("message", listener);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("remote page shim", () => {
  test("sends the handshake first and holds every request behind it", async () => {
    const page = startPage("?host=h-1", false);
    page.socket.open();

    // The relay parses **every** frame as `auth` while the connection is
    // unauthenticated, and a parse failure is a permanent 4003 — so the
    // handshake owns the first frame.
    expect(page.socket.frames()).toEqual([
      {
        type: "auth",
        credential: { type: "sso", token: "sso-token" },
        version: "",
      },
    ]);

    // The app mounts before the handshake is answered; its requests wait.
    page.api.postMessage({ command: "webviewReady" });
    await flush();
    expect(page.socket.frames()).toHaveLength(1);

    page.socket.receive({ type: "auth_ok" });
    await flush();
    expect(page.requests("listDaemonSessions")).toBe(1);
  });

  test("a machine that cannot list its sessions says so instead of going blank", async () => {
    const page = startPage("?host=h-1");
    await flush();
    page.api.postMessage({ command: "webviewReady" });
    await flush();

    // The likeliest cause is a machine older than this page: the page is served
    // centrally, so the method sits behind the machine's own remote allowlist and
    // the relay's version floor is what is supposed to catch the mismatch first.
    await page.refuse("listDaemonSessions", "Method not allowed");

    expect(document.getElementById("remote-status")?.textContent).toContain(
      "读不到电脑侧的会话列表",
    );
  });

  test("says what is missing when the page has no enterprise login", () => {
    window.history.replaceState({}, "", "/remote/?host=h-1");
    window.localStorage.setItem("token", "");

    new Function(SHIM)();

    // Nothing to connect with, so nothing is attempted.
    expect(FakeSocket.opened).toHaveLength(0);
    expect(document.getElementById("remote-status")?.textContent).toContain(
      "请先在企业端登录",
    );
  });

  test("boots with the auth frame and lists the sessions the process is running", async () => {
    const page = startPage("?host=h-1");
    await flush();

    // No address to configure: the page is served from the relay's own domain.
    expect(page.socket.url).toBe(
      "ws://localhost:3000/v1/hosts/ws/h-1/subscribe",
    );
    expect(page.socket.frames()[0]).toEqual({
      type: "auth",
      credential: { type: "sso", token: "sso-token" },
      version: "",
    });

    page.api.postMessage({ command: "webviewReady" });
    await flush();

    // The list is the machine's live registry, never the on-disk transcripts:
    // reading requires the session to be live in the serving process, so a disk
    // entry would fail the moment it is tapped.
    expect(page.requests("listSessions")).toBe(0);
    expect(page.requests("listDaemonSessions")).toBe(1);

    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    // Most recently active wins: the page cannot see the computer's screen, so
    // that is the only ordering signal it has.
    const pull = await page.answer("getMessages", { messages: [SEED] });
    expect(pull.sessionId).toBe("s-new");
    expect(pull.params).toEqual({ limit: 300 });

    await page.answer("listPendingPermissions", { requests: [] });

    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      session: { id: "s-new", workdir: "/repo", customTitle: "登录页" },
      sessions: [{ id: "s-new" }, { id: "s-old", workdir: "/tmp/other" }],
      // The relay authenticated this page with the machine's own credential;
      // there is no separate phone login to satisfy.
      isAuthenticated: true,
    });
  });

  test("drops another session's frames but never another session's approval", async () => {
    const { page } = await openPage();
    const before = page.posted.length;

    page.socket.receive({
      method: "assistantMessageAdded",
      params: { message: { id: "other-1" } },
      sessionId: "s-old",
    });
    expect(page.posted.slice(before)).toHaveLength(0);

    page.socket.receive({
      method: "assistantMessageAdded",
      params: { message: { id: "mine-1" } },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "appendMessage",
      message: { id: "mine-1" },
    });

    // Approvals are process-wide (the reply is routed by requestId, not by
    // session) and are the one thing the user must not miss — usually waiting in
    // the conversation they are *not* looking at.
    page.socket.receive({
      method: "permissionRequest",
      params: { requestId: "r1", context: { toolName: "Bash" } },
      sessionId: "s-old",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "showConfirmation",
      confirmationId: "r1",
      toolName: "Bash",
    });
  });

  test("the picker switches the page's own view without touching the computer", async () => {
    const { page } = await openPage();

    page.api.postMessage({ command: "restoreSession", sessionId: "s-old" });
    await flush();

    // "Show me that conversation here" is answered locally on purpose: the
    // machine's own restoreSession is an *in-place* load, which on a desktop host
    // swaps the conversation the user is looking at.
    expect(page.requests("restoreSession")).toBe(0);

    // The switch re-reads the registry first: a session can end while the picker
    // sits open, and an id that is gone only produces "Session not found".
    await page.answer("listDaemonSessions", { sessions: SESSIONS });

    const pull = await page.answer("getMessages", {
      messages: [{ id: "old-1", role: "user", blocks: [] }],
    });
    expect(pull.sessionId).toBe("s-old");
    // A switch re-reads from scratch: the window the page held belongs to the
    // session it just left.
    expect(pull.params).toEqual({ limit: 300 });

    await page.answer("listPendingPermissions", { requests: [] });
    expect(lastPosted(page)).toMatchObject({
      command: "setInitialState",
      session: { id: "s-old" },
      messages: [{ id: "old-1" }],
    });
  });

  test("a session that is no longer running is refused, not silently opened", async () => {
    const { page } = await openPage();
    const pulls = page.requests("getMessages");

    page.api.postMessage({ command: "restoreSession", sessionId: "s-gone" });
    await flush();

    expect(page.requests("getMessages")).toBe(pulls);
    expect(document.getElementById("remote-status")?.textContent).toContain(
      "不在电脑侧的运行中",
    );
  });

  test("both spellings of the change signal re-read only what was appended", async () => {
    const { page } = await openPage();

    page.socket.receive({
      method: "messagesChange",
      params: {},
      sessionId: "s-new",
    });
    await flush();
    const delta = await page.answer("getMessages", {
      messages: [{ id: "m2", role: "assistant", blocks: [] }],
    });
    expect(delta.params).toMatchObject({ since: "m1" });
    expect(lastPosted(page)).toMatchObject({
      command: "updateMessages",
      messages: [{ id: "m1" }, { id: "m2" }],
    });

    // A machine older than the rename still says `messagesChanged`; the page
    // speaks both so it stays connectable either way.
    page.socket.receive({
      method: "messagesChanged",
      params: {},
      sessionId: "s-new",
    });
    await flush();
    expect(
      (await page.answer("getMessages", { messages: [] })).params,
    ).toMatchObject({
      since: "m2",
    });

    // The other shape of the same method carries the whole array — a host
    // snapshot, which replaces the window instead of asking for one.
    const pulls = page.requests("getMessages");
    page.socket.receive({
      method: "messagesChange",
      params: { messages: [{ id: "solo", role: "user", blocks: [] }] },
      sessionId: "s-new",
    });
    expect(lastPosted(page)).toMatchObject({
      command: "updateMessages",
      messages: [{ id: "solo" }],
    });
    expect(page.requests("getMessages")).toBe(pulls);
  });

  test("a ?session= pin is honored while that session is live, else the newest wins", async () => {
    const pinned = startPage("?host=h-1&session=s-old");
    await flush();
    pinned.api.postMessage({ command: "webviewReady" });
    await flush();
    await pinned.answer("listDaemonSessions", { sessions: SESSIONS });
    expect(
      (await pinned.answer("getMessages", { messages: [] })).sessionId,
    ).toBe("s-old");

    // The pin is a name, not an authority: it never makes an unopened session
    // openable.
    const stale = startPage("?host=h-1&session=s-gone");
    await flush();
    stale.api.postMessage({ command: "webviewReady" });
    await flush();
    await stale.answer("listDaemonSessions", { sessions: SESSIONS });
    expect(
      (await stale.answer("getMessages", { messages: [] })).sessionId,
    ).toBe("s-new");
  });
});
