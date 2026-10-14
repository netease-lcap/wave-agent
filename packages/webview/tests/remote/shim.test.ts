import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

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
    dispatchEvent: vi.fn(),
  };

  const document = {
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
    console: { warn: (message: string) => warns.push(message) },
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

  return {
    navigations,
    sockets,
    socket: () => {
      const socket = sockets[sockets.length - 1];
      if (!socket) throw new Error("the page never opened a relay socket");
      return socket;
    },
    banner: () => banner?.textContent ?? "",
    session,
    warns,
  };
}

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
