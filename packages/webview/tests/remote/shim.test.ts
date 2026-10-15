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
 * `fetch` is one of them: the renewal request goes to the enterprise, so the
 * stub below is the enterprise answering (or not).
 */

const SHIM = fs.readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../remote/shim.js"),
  "utf-8",
);

/** Written by the shim before it navigates; see `hopToLogin`. */
const HOP_KEY = "wave_remote_login_hop";
const ENTERPRISE_URL = "https://codechat.example.com/remote/?host=host-1";
const LOGIN_PREFIX = "/login?redirect=";
/** The one navigation every unusable-credential path ends with. */
const LOGIN_HOP = `${LOGIN_PREFIX}${encodeURIComponent("/remote/?host=host-1")}`;

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

/**
 * The shim paints with plain DOM calls (status banner, machine picker), so the
 * fake elements only need what it touches: text (a *computed* one — the banner
 * rebuilds by clearing `textContent` and appending a span, and the tests read
 * the concatenation the way a real node reports it), children, attributes, and
 * click handlers.
 */
class FakeElement {
  id = "";
  type = "";
  /** Tags the banner's action buttons, so tests can tell them from text. */
  onclick: (() => void) | null = null;
  removed = false;
  private ownText = "";
  children: FakeElement[] = [];

  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }

  set textContent(value: string) {
    // A real node clears its children here; the shim leans on that to rebuild
    // the banner between statuses.
    this.ownText = value;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    if (name === "id") this.id = value;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removed = true;
  }
}

/** What the enterprise's refresh endpoint answers, or that it cannot be reached. */
interface RefreshPlan {
  status?: number;
  body?: unknown;
}

class FakeResponse {
  ok: boolean;
  status: number;
  private payload: unknown;

  constructor(status: number, payload: unknown) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.payload = payload;
  }

  async json(): Promise<unknown> {
    return this.payload;
  }
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
  /** What the enterprise has in localStorage — the page's credential store. */
  local: Map<string, string>;
  /** The renewal requests the page sent, in order. */
  fetches: { url: string; init: { body: string } }[];
  /** Addresses written by `history.replaceState` (the picker's URL writes). */
  replaced: string[];
  /** A page-shell element by id — the machine picker lives there. */
  element(id: string): FakeElement | null;
  /** The status banner's action buttons, label plus what a tap runs. */
  bannerButtons(): { label: string; click: () => void }[];
  /** Every timer the shim armed (backoff retries and RPC timeouts alike). */
  timers: { delay: number; cleared: boolean; run(): void }[];
  /** Fire the pending backoff timers by hand; RPC timeouts stay put. */
  runRetryTimers(): void;
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
  /** The refresh token the enterprise would have left behind, if any. */
  refreshToken?: string;
  /** `expiresAt` relative to now; omitted entirely when not given. */
  expiresInMs?: number;
  /** Anything else the enterprise may have stored (e.g. `user`). */
  stored?: Record<string, string>;
  /** How the enterprise's refresh endpoint answers, or "network". */
  refresh?: RefreshPlan | "network";
  /** How the relay's machine-list endpoint answers, or "network". */
  hosts?: RefreshPlan | "network";
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
  const fetches: Harness["fetches"] = [];
  const replaced: string[] = [];
  const timers: Harness["timers"] = [];
  let banner: FakeElement | null = null;
  const bodyChildren: FakeElement[] = [];

  const local = new Map<string, string>();
  if (options.token) local.set("token", options.token);
  if (options.refreshToken) local.set("refreshToken", options.refreshToken);
  if (options.expiresInMs !== undefined)
    local.set("expiresAt", String(Date.now() + options.expiresInMs));
  for (const key of Object.keys(options.stored ?? {}))
    local.set(key, (options.stored as Record<string, string>)[key] as string);

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
    // The picker writes its choice back into the address; the stub records the
    // URL and keeps the location the shim reads in step with it.
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        replaced.push(url);
        const next = new URL(url, location.toString());
        location.href = next.toString();
        location.search = next.search;
        window.location.href = next.toString();
        window.location.search = next.search;
      },
    },
    localStorage: storage(local, options.storageBroken ?? false),
    sessionStorage: storage(session, false),
    // Host → page traffic lands here and nowhere else: the page's `message`
    // listener belongs to the webview app, not the shim, so recording what the
    // shim dispatches *is* observing what the page would receive. (The shim does
    // register resume listeners of its own — hence the stub below — but those
    // never carry host frames.)
    dispatchEvent: (event: { data: unknown }) => {
      posted.push(event.data);
      return true;
    },
    // `pageshow`. The sibling `shimSessions.test.ts` drives the resume path
    // through jsdom's real event target; nothing here fires either event, and
    // the shim only needs the registration itself to succeed.
    addEventListener: () => {},
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
    // `visibilitychange`. See the note on the window stub: registered, never
    // fired here.
    addEventListener: () => {},
    createElement: (): FakeElement => new FakeElement(),
    getElementById: (id: string): FakeElement | null =>
      bodyChildren.find((element) => element.id === id && !element.removed) ??
      null,
    body: {
      appendChild: (element: FakeElement) => {
        bodyChildren.push(element);
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
    // The enterprise's refresh endpoint, standing in for the one host surface
    // the page reaches outside its own origin. "network" is the request never
    // getting an answer at all, which must read the same as a refusal here.
    // The machine list rides the same stub under its own plan.
    fetch: (url: string, init: Harness["fetches"][number]["init"]) => {
      fetches.push({ url, init });
      if (url === "/api/relay/hosts") {
        const plan = options.hosts ?? { status: 200, body: { hosts: [] } };
        if (plan === "network") return Promise.reject(new Error("网络不可用"));
        return Promise.resolve(
          new FakeResponse(plan.status ?? 200, plan.body ?? {}),
        );
      }
      const plan = options.refresh ?? { status: 200, body: {} };
      if (plan === "network") return Promise.reject(new Error("网络不可用"));
      return Promise.resolve(
        new FakeResponse(plan.status ?? 200, plan.body ?? {}),
      );
    },
    // Timers are recorded, never fired on their own: the RPC timeouts (20s /
    // 5min) firing would keep rejecting promises after a test moved on. The
    // backoff tests drive the recorded retries by hand (`runRetryTimers`).
    setTimeout: (fn: () => void, delay: number) => {
      const timer = {
        delay,
        cleared: false,
        // One-shot: a fired timer must not fire again when a later
        // `runRetryTimers` sweeps the list.
        run: () => {
          timer.cleared = true;
          fn();
        },
      };
      timers.push(timer);
      return timers.length;
    },
    clearTimeout: (id: number) => {
      const timer = timers[id - 1];
      if (timer) timer.cleared = true;
    },
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
    bannerButtons: () =>
      (banner?.children ?? [])
        .filter((child) => child.onclick)
        .map((child) => ({
          label: child.textContent,
          click: () => child.onclick?.(),
        })),
    element: (id) => document.getElementById(id),
    replaced,
    timers,
    runRetryTimers: () => {
      for (const timer of [...timers]) {
        // 20s is the RPC timeout, 5min the turn budget — neither is a retry
        // step; the backoff walks 2s → 4s → … → the 30s cap.
        if (!timer.cleared && timer.delay <= 30000 && timer.delay !== 20000)
          timer.run();
      }
    },
    session,
    local,
    fetches,
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
  it("hops to the enterprise login page and asks to come back to this address", async () => {
    const page = loadShim({});
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
    // Nothing to say to the relay without a credential, so no socket at all.
    expect(page.sockets).toEqual([]);
    // The marker is what stops a second automatic hop before the user is back.
    expect(page.session.get(HOP_KEY)).toBeTruthy();
  });

  it("stays on the local debug page — there is no login page to reach", async () => {
    const page = loadShim({ url: "http://localhost:5173/remote/?host=host-1" });
    await flush();

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("hops at most once per window, so a login that fixes nothing cannot ping-pong", async () => {
    const page = loadShim({ hoppedAt: Date.now() });
    await flush();

    expect(page.navigations).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("does not hop when browser storage is unusable — the login page could not store a token either", async () => {
    const page = loadShim({
      storageBroken: true,
      refreshToken: "rt-1",
      refresh: {
        body: {
          token: "fresh-jwt",
          refreshToken: "rt-2",
          expiresInSeconds: 3600,
        },
      },
    });
    await flush();

    expect(page.navigations).toEqual([]);
    // Nor is a renewal attempted: storage that cannot be read cannot be written
    // back either, so the request would buy nothing.
    expect(page.fetches).toEqual([]);
    expect(page.banner()).toContain("请先在企业端登录");
  });

  it("hops when the relay rejects the stored token as invalid", async () => {
    const page = loadShim({ token: "stale-jwt" });
    const socket = page.socket();
    socket.readyState = 1;

    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "auth",
      credential: { type: "sso", token: "stale-jwt" },
    });

    socket.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
    // No refresh token stored, so there was nothing to renew with: the request
    // that would have been pointless is never made.
    expect(page.fetches).toEqual([]);
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

describe("remote page shim — renewing an expired login", () => {
  /** What the enterprise answers a renewal with: the login response's shape. */
  const FRESH = {
    token: "fresh-jwt",
    refreshToken: "rt-2",
    expiresInSeconds: 3600,
    user: { id: "u1", email: "new@example.com" },
  };

  it("renews a token that aged out instead of sending the user to log in", async () => {
    const page = loadShim({
      token: "stale-jwt",
      expiresInMs: -1000,
      refreshToken: "rt-1",
      refresh: { body: FRESH },
    });
    await flush();

    // The whole point: an hour-old token costs one invisible request, and the
    // page stays exactly where it is.
    expect(page.navigations).toEqual([]);
    expect(page.fetches).toHaveLength(1);
    expect(page.fetches[0]?.url).toBe("/api/auth/refresh");
    expect(JSON.parse(page.fetches[0]?.init.body ?? "")).toEqual({
      refreshToken: "rt-1",
    });

    const socket = page.socket();
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "auth",
      credential: { type: "sso", token: "fresh-jwt" },
    });

    // Written back the way the enterprise's own SPA writes it, so the next load
    // starts from the new pair instead of renewing the same stale one.
    expect(page.local.get("token")).toBe("fresh-jwt");
    expect(page.local.get("refreshToken")).toBe("rt-2");
    expect(Number(page.local.get("expiresAt"))).toBeGreaterThan(Date.now());
    expect(JSON.parse(page.local.get("user") ?? "")).toEqual(FRESH.user);
  });

  it("renews when the token is gone but the refresh token is still there", async () => {
    const page = loadShim({ refreshToken: "rt-1", refresh: { body: FRESH } });
    await flush();

    expect(page.navigations).toEqual([]);
    expect(page.fetches).toHaveLength(1);
    page.socket().onopen?.();
    expect(JSON.parse(page.socket().sent[0])).toMatchObject({
      credential: { type: "sso", token: "fresh-jwt" },
    });
  });

  it("spends no request on a token that is still good", async () => {
    const page = loadShim({
      token: "jwt",
      expiresInMs: 3600_000,
      refreshToken: "rt-1",
    });
    await flush();

    expect(page.fetches).toEqual([]);
    expect(page.navigations).toEqual([]);
    page.socket().onopen?.();
    expect(JSON.parse(page.socket().sent[0])).toMatchObject({
      credential: { type: "sso", token: "jwt" },
    });
  });

  it("treats a token with no stored expiry as usable, and lets the handshake judge it", async () => {
    const page = loadShim({ token: "jwt", refreshToken: "rt-1" });
    await flush();

    expect(page.fetches).toEqual([]);
    expect(page.socket().url).toContain("/v1/hosts/ws/host-1/subscribe");
  });

  it("falls back to the login page when the renewal is refused", async () => {
    const page = loadShim({
      token: "stale-jwt",
      expiresInMs: -1000,
      refreshToken: "rt-1",
      refresh: { status: 401 },
    });
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
    expect(page.sockets).toEqual([]);
    expect(page.banner()).toBe("");
  });

  it("treats a renewal that never got an answer the same as a refusal", async () => {
    const page = loadShim({
      token: "stale-jwt",
      expiresInMs: -1000,
      refreshToken: "rt-1",
      refresh: "network",
    });
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
    // Nothing was written: a network blip must not cost the user the refresh
    // token that is still valid.
    expect(page.local.get("token")).toBe("stale-jwt");
    expect(page.local.get("refreshToken")).toBe("rt-1");
  });

  it("keeps every stored credential when the answer is not a session", async () => {
    const page = loadShim({
      stored: {
        token: "stale-jwt",
        refreshToken: "rt-1",
        expiresAt: String(Date.now() - 1000),
        user: '{"id":"u1","email":"old@example.com"}',
      },
      refresh: { body: { refreshToken: "rt-2", expiresInSeconds: 3600 } },
    });
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
    // The response carried no token, so it is not a session and half of it is
    // worth nothing: the old credentials stay exactly as they were.
    expect(page.local.get("token")).toBe("stale-jwt");
    expect(page.local.get("refreshToken")).toBe("rt-1");
    expect(Number(page.local.get("expiresAt"))).toBeLessThan(Date.now());
    expect(page.local.get("user")).toBe(
      '{"id":"u1","email":"old@example.com"}',
    );
  });

  it("writes only the fields the answer carried, keeping the rest as they were", async () => {
    const page = loadShim({
      token: "stale-jwt",
      refreshToken: "rt-1",
      expiresInMs: -1000,
      refresh: { body: { token: "fresh-jwt" } },
    });
    await flush();

    // The renewal itself worked: no navigation, and the handshake carries the
    // new token.
    expect(page.navigations).toEqual([]);
    page.socket().onopen?.();
    expect(JSON.parse(page.socket().sent[0])).toMatchObject({
      type: "auth",
      credential: { type: "sso", token: "fresh-jwt" },
    });

    expect(page.local.get("token")).toBe("fresh-jwt");
    // The keys the answer never mentioned keep what they had. Writing them
    // unconditionally would put the literal "undefined" where the refresh token
    // was — throwing away one that may still be valid, and leaving a page that
    // fails every renewal from then on.
    expect(page.local.get("refreshToken")).toBe("rt-1");
    expect(page.local.get("expiresAt")).not.toBe("NaN");
    expect(Number(page.local.get("expiresAt"))).toBeLessThan(Date.now());
  });

  it("renews once and re-handshakes when the relay refuses the token", async () => {
    const page = loadShim({
      token: "stale-jwt",
      refreshToken: "rt-1",
      refresh: { body: FRESH },
    });
    const first = page.socket();
    first.onopen?.();
    first.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    expect(page.navigations).toEqual([]);
    expect(page.fetches).toHaveLength(1);
    const second = page.socket();
    expect(second).not.toBe(first);
    second.onopen?.();
    expect(JSON.parse(second.sent[0])).toMatchObject({
      type: "auth",
      credential: { type: "sso", token: "fresh-jwt" },
    });

    // The abandoned connection still dies — the relay closes a refused
    // handshake — and its death must not narrate over the live one.
    first.onclose?.({ code: 4003 });
    expect(page.banner()).toBe("");
  });

  it("hops when the renewal after a refusal comes back empty", async () => {
    const page = loadShim({
      token: "stale-jwt",
      refreshToken: "rt-1",
      refresh: { status: 401 },
    });
    const socket = page.socket();
    socket.onopen?.();
    socket.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    expect(page.navigations).toEqual([LOGIN_HOP]);
  });

  it("makes at most one renewal attempt, so a refusal cannot ping-pong with the login page", async () => {
    const page = loadShim({
      token: "stale-jwt",
      refreshToken: "rt-1",
      refresh: { status: 401 },
    });
    const socket = page.socket();
    socket.onopen?.();
    socket.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    expect(page.fetches).toHaveLength(1);
    expect(page.navigations).toHaveLength(1);

    // A second refusal — the user came back from a login that fixed nothing, or
    // the relay is simply repeating itself — earns no second request. That is
    // exactly the loop the single attempt exists to prevent.
    socket.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    expect(page.fetches).toHaveLength(1);
    expect(page.navigations).toHaveLength(1);
    expect(page.banner()).toContain("登录态无效或已过期");
  });

  it("shares one request between two refusals that arrive together", async () => {
    const page = loadShim({
      token: "stale-jwt",
      refreshToken: "rt-1",
      refresh: { body: FRESH },
    });
    const socket = page.socket();
    socket.onopen?.();
    socket.receive({ type: "auth_error", error: "invalid_token" });
    socket.receive({ type: "auth_error", error: "invalid_token" });
    await flush();

    // Two questions, one answer: the second refusal rides the request already in
    // flight rather than rotating the refresh token out from under it.
    expect(page.fetches).toHaveLength(1);
    expect(page.navigations).toEqual([]);
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
  // The snapshot path's own session-state read (`getSessionInfo`, scenario 26):
  // the page asks before it pulls messages, and the machine answers for the
  // session in the envelope.
  page.reply({ sessionId: "s1", permissionMode: "default" });
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
      "getSessionInfo",
      "getMessages",
      "listPendingPermissions",
    ]);
    expect(
      page.requests().find((frame) => frame.method === "getMessages")?.params,
    ).toEqual({ limit: 100 });
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

  it("sends an approval as a notification, never an id-carrying request", async () => {
    const page = await openPage();
    const askedBefore = page.requests().length;

    page.post({
      command: "confirmationResponse",
      confirmationId: "req-1",
      approved: true,
      decision: { behavior: "allow", message: JSON.stringify({ q: "other" }) },
    });
    await flush();

    // `permissionResponse` is a notification in this protocol — the IDE and
    // desktop hosts send it through `notify`, with no id, and the host side
    // answers an id-carrying one with "Method not found". Framing it as a
    // request is what made every approval on this page do nothing at all: the
    // machine kept waiting, and the approval reappeared on the next resync.
    const approvalFrames = page
      .socket()
      .sent.map((line) => JSON.parse(line))
      .filter((frame) => frame.method === "permissionResponse");
    expect(approvalFrames).toEqual([
      {
        method: "permissionResponse",
        params: {
          requestId: "req-1",
          decision: { behavior: "allow", message: '{"q":"other"}' },
        },
        sessionId: "s1",
      },
    ]);
    // Nothing was asked, so nothing is pending: no 20 s timeout, and no
    // rejection swallowed into a warning the phone can never see.
    expect(page.requests().length).toBe(askedBefore);
    expect(page.warns).toEqual([]);
  });

  it("turns a bare yes/no into an allow/deny decision", async () => {
    const page = await openPage();

    page.post({
      command: "confirmationResponse",
      confirmationId: "req-1",
      approved: true,
    });
    page.post({
      command: "confirmationResponse",
      confirmationId: "req-2",
      approved: false,
    });
    await flush();

    const decisions = page
      .socket()
      .sent.map((line) => JSON.parse(line))
      .filter((frame) => frame.method === "permissionResponse")
      .map((frame) => frame.params);
    expect(decisions).toEqual([
      { requestId: "req-1", decision: { behavior: "allow" } },
      { requestId: "req-2", decision: { behavior: "deny" } },
    ]);
  });
});

describe("remote page shim — pulling the list further up", () => {
  it("asks for the page above the anchor, at the first screen's page size", async () => {
    const page = await openPage();

    page.post({ command: "loadOlderMessages", before: "m10", requestId: 7 });
    await flush();

    // `before` is exclusive: the host returns what is older than m10, so the
    // message the reader is holding is never re-sent.
    const asked = page
      .requests()
      .filter((frame) => frame.method === "getMessages");
    expect(asked[asked.length - 1]).toMatchObject({
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

describe("remote page shim — choosing a machine (the picker)", () => {
  const HOSTS = {
    status: 200,
    body: {
      hosts: [
        { id: "host-1", name: "工位机", platform: "darwin", online: true },
        { id: "host-2", name: "家里那台", platform: "win32", online: false },
      ],
    },
  };
  const BARE_URL = "https://codechat.example.com/remote/";

  it("a direct link with ?host= never asks for the machine list", async () => {
    const page = loadShim({ token: "jwt", hosts: HOSTS });
    await flush();

    expect(page.fetches.filter((f) => f.url === "/api/relay/hosts")).toEqual(
      [],
    );
    expect(page.socket().url).toContain("/v1/hosts/ws/host-1/subscribe");
  });

  it("without ?host=, the remembered machine connects and takes over the address", async () => {
    const page = loadShim({
      url: BARE_URL,
      token: "jwt",
      hosts: HOSTS,
      stored: { wave_remote_last_host: "host-2" },
    });
    await flush();

    // The list is read all the same: only it can say the remembered machine
    // still exists (an unbound channel would otherwise fail the handshake).
    expect(page.fetches.some((f) => f.url === "/api/relay/hosts")).toBe(true);
    expect(page.socket().url).toContain("host-2/subscribe");
    expect(page.replaced).toEqual([BARE_URL + "?host=host-2"]);
    expect(page.local.get("wave_remote_last_host")).toBe("host-2");
  });

  it("with nothing remembered, the list is shown and a pick writes the address", async () => {
    const page = loadShim({ url: BARE_URL, token: "jwt", hosts: HOSTS });
    await flush();

    const picker = page.element("remote-machine-picker");
    expect(picker).toBeTruthy();
    expect(picker?.textContent).toContain("工位机");
    expect(picker?.textContent).toContain("macOS");
    expect(picker?.textContent).toContain("离线");

    const panel = picker?.children[0];
    const row = panel?.children.find(
      (child) => child.onclick && child.textContent.includes("家里那台"),
    );
    row?.onclick?.();
    await flush();

    expect(page.socket().url).toContain("host-2/subscribe");
    expect(page.replaced).toEqual([BARE_URL + "?host=host-2"]);
    expect(page.local.get("wave_remote_last_host")).toBe("host-2");
    // The overlay is gone — the machine took the stage.
    expect(page.element("remote-machine-picker")).toBeNull();
  });

  it("a remembered machine that is no longer listed falls back to the list", async () => {
    const page = loadShim({
      url: BARE_URL,
      token: "jwt",
      hosts: HOSTS,
      stored: { wave_remote_last_host: "host-9" },
    });
    await flush();

    expect(page.sockets).toEqual([]);
    expect(page.element("remote-machine-picker")).toBeTruthy();
  });

  it("an empty account is a state, not a blank screen", async () => {
    const page = loadShim({
      url: BARE_URL,
      token: "jwt",
      hosts: { status: 200, body: { hosts: [] } },
    });
    await flush();

    const picker = page.element("remote-machine-picker");
    expect(picker?.textContent).toContain("还没有开启远程控制的电脑");
    expect(picker?.textContent).toContain("wave remote-control on");
  });

  it("a list that will not come is a banner with a retry, not a blank screen", async () => {
    const page = loadShim({ url: BARE_URL, token: "jwt", hosts: "network" });
    await flush();

    expect(page.banner()).toContain("取不到机器列表");
    expect(page.bannerButtons().map((b) => b.label)).toContain("重试");
  });

  it("a 401 from the list renews once, then hops once renewal is spent", async () => {
    const page = loadShim({
      url: BARE_URL,
      token: "jwt",
      refreshToken: "rt-1",
      hosts: { status: 401, body: {} },
      refresh: { body: { token: "fresh-jwt" } },
    });
    await flush();

    // First 401 → renewal → the retry fetch → 401 again → renewal already
    // spent → the login page. The hop returns to this page's own address,
    // which here carries no ?host=.
    expect(
      page.fetches.filter((f) => f.url === "/api/relay/hosts"),
    ).toHaveLength(2);
    expect(page.navigations).toEqual([
      LOGIN_PREFIX + encodeURIComponent("/remote/"),
    ]);
  });

  it("the header chip shows the list over a live connection", async () => {
    const page = loadShim({ token: "jwt", hosts: HOSTS });
    await flush();
    page.post({ command: "webviewReady" });
    await flush();

    page.post({ command: "openMachinePicker" });
    await flush();

    expect(page.element("remote-machine-picker")?.textContent).toContain(
      "工位机",
    );
    // The connection stays up: switching happens when one is chosen.
    expect(page.socket().readyState).toBe(1);
  });
});

describe("remote page shim — a machine switch resets the view", () => {
  const HOSTS = {
    status: 200,
    body: {
      hosts: [
        { id: "host-1", name: "工位机", platform: "darwin", online: true },
        { id: "host-2", name: "家里那台", platform: "win32", online: false },
      ],
    },
  };

  it("switching drops the old session pin and re-pulls on the new socket", async () => {
    const page = loadShim({
      url: ENTERPRISE_URL + "&session=s-old",
      token: "jwt",
      hosts: HOSTS,
    });
    await flush();
    page.post({ command: "webviewReady" });
    await flush();

    page.post({ command: "openMachinePicker" });
    await flush();
    const panel = page.element("remote-machine-picker")?.children[0];
    const row = panel?.children.find(
      (child) => child.onclick && child.textContent.includes("家里那台"),
    );
    row?.onclick?.();
    await flush();

    const next = page.socket();
    expect(next.url).toContain("host-2/subscribe");
    // The address lost the previous machine's session pin with it.
    expect(page.replaced[page.replaced.length - 1]).toBe(
      "https://codechat.example.com/remote/?host=host-2",
    );
    // The app is already mounted — no second `webviewReady` will come — so the
    // switch itself must produce the snapshot pull, on the new socket.
    next.readyState = 1;
    next.onopen?.();
    next.receive({ type: "auth_ok" });
    await flush();
    const methods = next.sent
      .map((frame) => JSON.parse(frame))
      .filter((frame) => frame.id !== undefined)
      .map((frame) => frame.method);
    expect(methods).toContain("listDaemonSessions");
  });
});

describe("remote page shim — healing after a disconnect", () => {
  async function connectedPage() {
    const page = loadShim({ token: "jwt" });
    await flush();
    const socket = page.socket();
    socket.readyState = 1;
    socket.onopen?.();
    socket.receive({ type: "auth_ok" });
    await flush();
    return { page, socket };
  }

  const pendingRetryDelay = (page: ReturnType<typeof loadShim>) => {
    const pending = page.timers.filter(
      // 20s is the RPC timeout — the only other timer this page arms.
      (timer) =>
        !timer.cleared && timer.delay <= 30000 && timer.delay !== 20000,
    );
    return pending[pending.length - 1]?.delay ?? -1;
  };

  it("waits out a 4001 with an unbounded backoff — no retry budget to spend", async () => {
    const { page } = await connectedPage();

    for (let i = 0; i < 12; i++) {
      page.socket().onclose?.({ code: 4001 });
      expect(page.banner()).toContain("等待上线");
      page.runRetryTimers();
    }
    // Twelve attempts in, still trying — the old page gave up after five and
    // parked on 「已停止重试」 forever (a home-screen page never reloads).
    expect(page.sockets.length).toBeGreaterThan(6);
    expect(page.banner()).not.toContain("已停止重试");
  });

  it("grows the backoff up to the cap, and any open starts it over", async () => {
    const { page } = await connectedPage();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      page.socket().onclose?.({ code: 4001 });
      delays.push(pendingRetryDelay(page));
      page.runRetryTimers();
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);

    // An open puts the backoff back at the fastest step.
    page.socket().readyState = 1;
    page.socket().onopen?.();
    page.socket().receive({ type: "auth_ok" });
    page.socket().onclose?.({ code: 4001 });
    expect(pendingRetryDelay(page)).toBe(2000);
  });

  it("a 4003 stops for good, and offers 换机器 rather than a retry", async () => {
    const { page } = await connectedPage();
    const before = page.sockets.length;

    page.socket().onclose?.({ code: 4003 });
    expect(page.banner()).toContain("未授权");
    expect(page.bannerButtons().map((b) => b.label)).toContain("换机器");
    page.runRetryTimers();
    expect(page.sockets.length).toBe(before);
  });

  it("a permanent auth_error parks with 换机器 and never retries", async () => {
    const { page } = await connectedPage();

    page.socket().receive({ type: "auth_error", error: "unknown_host" });
    await flush();
    // The relay follows the `auth_error` with the 4003 close.
    const before = page.sockets.length;
    page.socket().onclose?.({ code: 4003 });
    expect(page.banner()).toContain("没有登记过这个通道");
    expect(page.bannerButtons().map((b) => b.label)).toContain("换机器");
    page.runRetryTimers();
    expect(page.sockets.length).toBe(before);
  });

  it("重新连接 forgets the backoff and dials this second", async () => {
    const { page } = await connectedPage();

    // Two drops in: the armed step is 4s. The button must not wait for it.
    page.socket().onclose?.({ code: 4001 });
    page.runRetryTimers();
    page.socket().onclose?.({ code: 4001 });
    expect(pendingRetryDelay(page)).toBe(4000);

    const before = page.sockets.length;
    const button = page.bannerButtons().find((b) => b.label === "重新连接");
    button?.click();
    expect(page.sockets.length).toBe(before + 1);
    // The scheduled retry was cancelled with it — it must not open a second
    // socket behind the live one.
    expect(
      page.timers.filter((timer) => !timer.cleared && timer.delay <= 16000),
    ).toEqual([]);

    // …and the next drop starts from the fastest step again.
    page.socket().readyState = 1;
    page.socket().onopen?.();
    page.socket().receive({ type: "auth_ok" });
    page.socket().onclose?.({ code: 4001 });
    expect(pendingRetryDelay(page)).toBe(2000);
  });

  it("the waiting banner offers 重新连接, and 换机器 opens the list", async () => {
    const { page } = await connectedPage();

    page.socket().onclose?.({ code: 4001 });
    const labels = page.bannerButtons().map((b) => b.label);
    expect(labels).toContain("重新连接");
    expect(labels).toContain("换机器");

    page
      .bannerButtons()
      .find((b) => b.label === "换机器")
      ?.click();
    await flush();
    expect(page.element("remote-machine-picker")).toBeTruthy();
  });
});
