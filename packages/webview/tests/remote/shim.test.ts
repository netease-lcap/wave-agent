import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The phone page's shim is browser JS with no imports and no build step — it
 * ships verbatim beside the webview bundle — so it is run here the way the
 * browser runs it: evaluated against a hand-made window. The decisions under
 * test are navigations (`location.replace`), which jsdom will not perform
 * ("Not implemented: navigation") and expose no way to observe, so this file
 * owns the host surface instead. Everything the shim touches is listed by
 * `hostGlobals` below — a new global in the shim shows up as a ReferenceError.
 */

const SHIM = fs.readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../remote/shim.js"),
  "utf-8",
);

/** Written by the shim before it navigates; see `hopToLogin`. */
const HOP_KEY = "wave_remote_login_hop";
const ENTERPRISE_URL = "https://codechat.example.com/remote/?host=host-1";
const LOGIN_PREFIX = "/login?redirect=";

class FakeSocket {
  url: string;
  sent: string[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  /** Feed the shim one frame the way the relay would. */
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

class FakeMessageEvent {
  data: unknown;

  constructor(_type: string, init: { data: unknown }) {
    this.data = init.data;
  }
}

interface Banner {
  textContent: string;
  setAttribute(): void;
  remove(): void;
}

interface Harness {
  /** Every navigation the shim attempted, in order. */
  navigations: string[];
  /** The relay socket, once the page decided it had something to say. */
  socket(): FakeSocket;
  sockets: FakeSocket[];
  /** The status banner's text, or empty when there is none. */
  banner(): string;
  session: Map<string, string>;
  warns: string[];
  /** An attribute the shim set on <html> (the page's CSS hooks live there). */
  htmlAttribute(name: string): string | null;
  /** Host → page: the messages the shim dispatched at the webview. */
  posted: unknown[];
  /** Page → host: what the mounted webview's `postMessage` would send. */
  post(message: Record<string, unknown>): void;
  /** The requests the shim put on the wire, parsed, auth frame excluded. */
  requests(): { id: number; method: string; params: Record<string, unknown> }[];
  /** Answer the request the shim sent most recently, the way the host does. */
  reply(result: unknown): void;
  /** The error half of the same envelope. */
  replyWithError(message: string): void;
}

function loadShim(options: {
  url?: string;
  token?: string;
  /** localStorage throws on every access — private mode. */
  storageBroken?: boolean;
  /** Pretend a login round-trip just happened. */
  hoppedAt?: number;
}): Harness {
  const location = new URL(options.url ?? ENTERPRISE_URL);
  const navigations: string[] = [];
  const warns: string[] = [];
  const sockets: FakeSocket[] = [];
  const posted: unknown[] = [];
  let banner: Banner | null = null;

  const local = new Map<string, string>();
  if (options.token) local.set("token", options.token);
  const session = new Map<string, string>();
  if (options.hoppedAt) session.set(HOP_KEY, String(options.hoppedAt));

  const storage = (data: Map<string, string>, broken: boolean) => ({
    getItem(key: string): string | null {
      if (broken) throw new Error("storage is not available");
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      if (broken) throw new Error("storage is not available");
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  });

  const window = {
    location: {
      href: location.toString(),
      protocol: location.protocol,
      hostname: location.hostname,
      pathname: location.pathname,
      search: location.search,
      replace: (url: string) => {
        navigations.push(url);
      },
    },
    localStorage: storage(local, options.storageBroken ?? false),
    sessionStorage: storage(session, false),
    // Host → page traffic lands here and nowhere else: the shim does not
    // register listeners itself (the webview app does), so recording what it
    // dispatches *is* observing what the page would receive.
    dispatchEvent: (event: { data: unknown }) => {
      posted.push(event.data);
      return true;
    },
    // Installed by the shim itself, the way a real host installs it — hence the
    // placeholder rather than an implementation.
    acquireVsCodeApi: null as unknown as () => {
      postMessage(message: Record<string, unknown>): void;
    },
  };

  const document = {
    // The shim marks the page for its own CSS by setting an attribute on <html>;
    // recorded the way a browser would answer `getAttribute`.
    documentElement: (() => {
      const attributes = new Map<string, string>();
      return {
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value);
        },
        getAttribute: (name: string) => attributes.get(name) ?? null,
      };
    })(),
    querySelector: () => null,
    createElement: (): Banner => ({
      textContent: "",
      setAttribute: () => {},
      remove: () => {
        banner = null;
      },
    }),
    body: {
      appendChild: (element: Banner) => {
        banner = element;
      },
    },
  };

  const hostGlobals = {
    window,
    document,
    // The shim logs the failure with the error as a second argument, the way
    // the console would render it; both halves belong in the line.
    console: {
      warn: (...args: unknown[]) => warns.push(args.map(String).join(" ")),
    },
    URL,
    URLSearchParams,
    WebSocket: class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
    MessageEvent: FakeMessageEvent,
    // The shim only arms timers on paths these tests do not drive (retry,
    // heartbeat, RPC timeouts); firing them would keep the process alive.
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
  };

  vm.runInNewContext(SHIM, hostGlobals, { filename: "shim.js" });

  const socketOf = () => {
    const socket = sockets[sockets.length - 1];
    if (!socket) throw new Error("the page never opened a relay socket");
    return socket;
  };

  const parsed = () => socketOf().sent.map((frame) => JSON.parse(frame));

  /** The newest request on the wire — the one a reply has to answer. */
  const lastRequest = () => {
    const frames = parsed().filter((frame) => frame.id !== undefined);
    const last = frames[frames.length - 1];
    if (!last) throw new Error("the shim has not asked the host anything");
    return last;
  };

  const answer = (method: string, params: unknown) => {
    socketOf().receive({ id: lastRequest().id, method, params });
  };

  return {
    navigations,
    sockets,
    socket: socketOf,
    banner: () => banner?.textContent ?? "",
    session,
    warns,
    htmlAttribute: (name) => document.documentElement.getAttribute(name),
    posted,
    post: (message) => {
      window.acquireVsCodeApi().postMessage(message);
    },
    requests: () => parsed().filter((frame) => frame.id !== undefined),
    reply: (result) => {
      answer("result", { result });
    },
    replyWithError: (message) => {
      answer("error", { code: -32603, message });
    },
  };
}

describe("remote page shim — this page is the browser host", () => {
  it("marks <html> for the Web-page-only viewport rules", () => {
    // No credential here either: the mark belongs to the page, not to a
    // successful connection, and it is set before chat.js runs (index.html loads
    // this file first) so the first paint already has it. The shared CSS hangs
    // the phone-only viewport rules (visible height + safe-area insets) on it —
    // the other four hosts embed in a window that IS the screen, so those rules
    // must not reach them.
    const page = loadShim({});

    expect(page.htmlAttribute("data-remote-page")).toBe("1");
  });
});

describe("remote page shim — logging in", () => {
  it("hops to the enterprise login page and asks to come back to this address", () => {
    const page = loadShim({});

    expect(page.navigations).toEqual([
      `${LOGIN_PREFIX}${encodeURIComponent("/remote/?host=host-1")}`,
    ]);
    // Nothing to say to the relay without a credential, so no socket at all.
    expect(page.sockets).toEqual([]);
    // The marker is what stops a second automatic hop before the user is back.
    expect(page.session.get(HOP_KEY)).toBeTruthy();
  });

  it("stays on the local debug page — there is no login page to reach", () => {
    const page = loadShim({ url: "http://localhost:5173/remote/?host=host-1" });

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("hops at most once per window, so a login that fixes nothing cannot ping-pong", () => {
    const page = loadShim({ hoppedAt: Date.now() });

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("does not hop when browser storage is unusable — the login page could not store a token either", () => {
    const page = loadShim({ storageBroken: true });

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("hops when the relay rejects the stored token as invalid", () => {
    const page = loadShim({ token: "stale-jwt" });
    const socket = page.socket();
    socket.readyState = 1;

    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "auth",
      credential: { type: "sso", token: "stale-jwt" },
    });

    socket.receive({ type: "auth_error", error: "invalid_token" });

    expect(page.navigations).toEqual([
      `${LOGIN_PREFIX}${encodeURIComponent("/remote/?host=host-1")}`,
    ]);
    // An invalid token is the login page's business, not a permanent error to
    // park on screen.
    expect(page.banner()).toBe("");
  });

  it("keeps the on-page reason for relay refusals a login cannot fix", () => {
    const page = loadShim({ token: "jwt" });
    const socket = page.socket();

    socket.onopen?.();
    socket.receive({ type: "auth_error", error: "unknown_host" });

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("没有登记过这个通道");
  });
});

/**
 * Let the shim's promise chain (request → then → post) run out. A macrotask is
 * the boundary: the vm context shares this realm's microtask queue, and the
 * shim's own `setTimeout` is stubbed out.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Handshake + first screen, the state every RPC test starts from. */
async function openPage(): Promise<Harness> {
  const page = loadShim({ token: "jwt" });
  const socket = page.socket();
  socket.onopen?.();
  socket.receive({ type: "auth_ok" });
  page.post({ command: "webviewReady" });
  await flush();
  // The live-session registry's own field names (`sessionId` /
  // `workingDirectory`), which the page maps onto what the shared list renders.
  page.reply({
    sessions: [
      { sessionId: "s1", workingDirectory: "/tmp", customTitle: "会话一" },
    ],
  });
  await flush();
  page.reply({ messages: [{ id: "m10" }, { id: "m11" }], hasMore: true });
  await flush();
  page.reply({ requests: [] });
  await flush();
  return page;
}

describe("remote page shim — talking to the host", () => {
  it("reads a reply as the host's JSON-RPC envelope, not a bare result", async () => {
    const page = await openPage();

    expect(page.requests().map((frame) => frame.method)).toEqual([
      "listDaemonSessions",
      "getMessages",
      "listPendingPermissions",
    ]);
    expect(page.requests()[1]?.params).toEqual({ limit: 100 });
    // The whole point: `params.result` is what reached the page. Reading
    // `frame.result` left every reply `undefined`, so this object arrived with
    // no sessions and no messages — the page then showed "电脑侧还没有正在跑的
    // 会话。" on a machine that had sessions, and nothing it asked for ever
    // worked.
    expect(page.posted).toEqual([
      expect.objectContaining({
        command: "setInitialState",
        messages: [{ id: "m10" }, { id: "m11" }],
        sessions: [expect.objectContaining({ id: "s1", workdir: "/tmp" })],
        session: expect.objectContaining({ id: "s1" }),
        isAuthenticated: true,
      }),
    ]);
    expect(page.banner()).toBe("");
  });

  it("rejects the error half of the envelope instead of resolving it", async () => {
    const page = loadShim({ token: "jwt" });
    const socket = page.socket();
    socket.onopen?.();
    socket.receive({ type: "auth_ok" });

    page.post({ command: "webviewReady" });
    await flush();
    page.replyWithError(
      "listDaemonSessions: the answer is larger than the frame budget",
    );
    await flush();

    // A refusal has to surface as a refusal: with the reply misread as an empty
    // success the page shows an empty picker instead of the reason.
    expect(page.banner()).toContain("读不到电脑侧的会话列表");
    expect(page.banner()).toContain("frame budget");
  });
});

describe("remote page shim — pulling the list further up", () => {
  it("asks for the page above the anchor, at the first screen's page size", async () => {
    const page = await openPage();

    page.post({ command: "loadOlderMessages", before: "m10", requestId: 7 });
    await flush();

    // `before` is exclusive: the host returns what is older than m10, so the
    // message the reader is holding is never re-sent.
    expect(page.requests()[3]).toMatchObject({
      method: "getMessages",
      params: { before: "m10", limit: 100 },
      sessionId: "s1",
    });

    page.reply({ messages: [{ id: "m8" }, { id: "m9" }], hasMore: true });
    await flush();

    expect(page.posted[1]).toEqual({
      command: "olderMessages",
      requestId: 7,
      messages: [{ id: "m8" }, { id: "m9" }],
      hasMore: true,
    });
  });

  it("carries the end-of-history flag through, so the page can stop asking", async () => {
    const page = await openPage();

    page.post({ command: "loadOlderMessages", before: "m10", requestId: 8 });
    await flush();
    page.reply({ messages: [{ id: "m1" }], hasMore: false });
    await flush();

    expect(page.posted[1]).toEqual({
      command: "olderMessages",
      requestId: 8,
      messages: [{ id: "m1" }],
      hasMore: false,
    });
  });

  it("reports a failed page and leaves the reader where they were", async () => {
    const page = await openPage();
    const before = page.requests().length;

    page.post({ command: "loadOlderMessages", before: "m10", requestId: 9 });
    await flush();
    page.replyWithError(
      "getMessages: the answer is larger than the frame budget",
    );
    await flush();

    expect(page.posted[1]).toEqual({
      command: "olderMessagesError",
      requestId: 9,
      error: "getMessages: the answer is larger than the frame budget",
    });
    expect(page.warns).toContain(
      "[wave-remote] 翻更早失败：getMessages: the answer is larger than the frame budget",
    );
    // No tail re-pull: that would replace the very position being held on to.
    expect(page.requests().length).toBe(before + 1);
  });

  it("answers an empty page itself when the page has no session yet", async () => {
    const page = loadShim({ token: "jwt" });
    page.socket().onopen?.();
    page.socket().receive({ type: "auth_ok" });

    page.post({ command: "loadOlderMessages", before: "m1", requestId: 10 });
    await flush();

    // Nothing to ask: no session means there is no anchor to page from.
    expect(page.requests()).toEqual([]);
    expect(page.posted).toEqual([
      { command: "olderMessages", requestId: 10, messages: [], hasMore: false },
    ]);
  });
});
