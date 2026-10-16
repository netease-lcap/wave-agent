/**
 * The remote page's Web Push subscription lifecycle, driven through the shim's
 * own command surface (`getPushState` / `enablePushNotifications` /
 * `disablePushNotifications`) — the same three commands the 更多 menu sends.
 *
 * Same split as the other two shim files: this one owns the browser's push
 * surface (Notification, ServiceWorkerContainer, PushManager) and the relay's
 * three REST endpoints, because that half is the "which promises did we make to
 * the user" half — did we ask for permission before subscribing, did we
 * register the endpoint we actually subscribed, did we tell the truth when a
 * revocation failed (spec ui/remote-control.md「锁屏也能知道」场景 6/7).
 * Whether a banner is *shown* is the worker's business and lives in
 * `sw.test.ts`; whether the page realigns on a delivered push is
 * `shimSessions.test.ts`'s.
 *
 * The shim ships as plain browser JS with no build step and no module system,
 * so the shipped file is what runs here — with `build.mjs`'s substitution
 * applied, so the registered worker name is the hashed one and not the token.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `__SW_FILE__` is what `build.mjs` fills in with the worker's hashed name. */
const SW_NAME = "sw.4b7d21c8ae.js";
const SHIM = readFileSync(
  resolve(HERE, "../../remote/shim.js"),
  "utf-8",
).replace(/__SW_FILE__/g, SW_NAME);

const PAGE_URL = "https://codechat.example.com/remote/?host=h-1";
/** What the relay hands back for `GET /api/relay/push/public-key`. */
const VAPID_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBKr3qBUYIHBQFLXYp5Nksh8U";

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const SUBSCRIPTION: Subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

/** One relay REST call, as the shim put it on the wire. */
interface RestCall {
  url: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

interface PushHarness {
  /** Host → page: the messages the shim dispatched at the webview. */
  posted: unknown[];
  /** Page → host: what the mounted webview's `postMessage` would send. */
  post(message: Record<string, unknown>): void;
  /** The relay REST calls, in order (the enterprise refresh path is excluded). */
  rest: RestCall[];
  /** What `navigator.serviceWorker.register` was called with, or null. */
  registered: string | null;
  /** The options the page actually passed to `pushManager.subscribe`, or null. */
  subscribedWith: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array;
  } | null;
  /** How many times the browser was asked for notification permission. */
  permissionAsked: number;
  /** Whether the browser-side subscription was dropped. */
  unsubscribed: boolean;
  /** The page's own credential store. */
  local: Map<string, string>;
  /** Anything the shim logged. */
  warns: string[];
  /** The message the shim registered on the worker (`wave-push` lands there). */
  workerMessage(event: unknown): void;
  /** Let every already-scheduled promise settle. */
  flush(): Promise<void>;
}

interface PushOptions {
  /** `navigator.serviceWorker` exists (a browser with a worker container). */
  serviceWorker?: boolean;
  /** `window.PushManager` exists — the capability `subscribe` needs. */
  pushManager?: boolean;
  /** iOS user agent + not added to the home screen: capability missing *and* fixable. */
  iosTab?: boolean;
  /** `Notification.requestPermission()` answers this. */
  permission?: "granted" | "denied";
  /** The VAPID answer; a status makes that request fail. */
  vapid?: { publicKey?: string; status?: number };
  /** How the relay answers `POST /subscriptions`. */
  register?: { id?: string; status?: number };
  /** How the relay answers `DELETE /subscriptions/<id>`. */
  revoke?: { status?: number };
  /** The subscription id the page remembers from an earlier visit. */
  storedPushId?: string;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeResponse {
  status: number;
  ok: boolean;
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

function loadShim(options: PushOptions): PushHarness {
  const posted: unknown[] = [];
  const rest: RestCall[] = [];
  const warns: string[] = [];
  const local = new Map<string, string>();
  if (options.storedPushId)
    local.set("wave_remote_push_sub", options.storedPushId);
  // A credential, so the page has something to send to the relay (`relayRest`
  // attaches it) and `boot()` does not spend a login hop.
  local.set("token", "jwt");

  const state = {
    registered: null as string | null,
    subscribedWith: null as PushHarness["subscribedWith"],
    permissionAsked: 0,
    unsubscribed: false,
    workerMessage: null as ((event: unknown) => void) | null,
  };

  const storage = (data: Map<string, string>) => ({
    getItem: (key: string) =>
      data.has(key) ? (data.get(key) as string) : null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });

  const subscription = {
    toJSON: () => SUBSCRIPTION,
    unsubscribe: () => {
      state.unsubscribed = true;
      return Promise.resolve(true);
    },
  };

  const registration = {
    pushManager: {
      subscribe: (init: PushHarness["subscribedWith"]) => {
        state.subscribedWith = init;
        return Promise.resolve(subscription);
      },
      getSubscription: () =>
        Promise.resolve(options.storedPushId ? subscription : null),
    },
  };

  const serviceWorker = options.serviceWorker
    ? {
        register: (path: string) => {
          state.registered = path;
          return Promise.resolve(registration);
        },
        get ready() {
          return Promise.resolve(registration);
        },
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          if (type === "message") state.workerMessage = handler;
        },
      }
    : undefined;

  const navigator = {
    userAgent: options.iosTab
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    standalone: false,
    serviceWorker,
  };

  const location = new URL(PAGE_URL);
  const window = {
    location: {
      href: location.toString(),
      protocol: location.protocol,
      hostname: location.hostname,
      pathname: location.pathname,
      search: location.search,
      replace: () => {},
    },
    history: { replaceState: () => {} },
    localStorage: storage(local),
    sessionStorage: storage(new Map()),
    navigator,
    // The standalone display mode is a media query, and on iOS the home-screen
    // web app is the *only* context with a `PushManager` — so this stub is what
    // separates 「不支持」 from 「先添加到主屏幕」.
    matchMedia: () => ({ matches: false }),
    atob: (base64: string) => Buffer.from(base64, "base64").toString("binary"),
    ...(options.pushManager ? { PushManager: function PushManager() {} } : {}),
    Notification: {
      requestPermission: () => {
        state.permissionAsked += 1;
        return Promise.resolve(options.permission ?? "granted");
      },
    },
    dispatchEvent: (event: { data: unknown }) => {
      posted.push(event.data);
      return true;
    },
    addEventListener: () => {},
    acquireVsCodeApi: null as unknown as () => {
      postMessage(message: Record<string, unknown>): void;
    },
  };

  const document = {
    documentElement: { setAttribute: () => {}, getAttribute: () => null },
    visibilityState: "visible",
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({
      id: "",
      onclick: null,
      textContent: "",
      children: [],
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild(child: unknown) {
        (this.children as unknown[]).push(child);
        return child;
      },
      remove: () => {},
    }),
    getElementById: () => null,
    body: { appendChild: () => {} },
  };

  const hostGlobals = {
    window,
    document,
    navigator,
    console: {
      warn: (...args: unknown[]) => warns.push(args.map(String).join(" ")),
    },
    URL,
    URLSearchParams,
    WebSocket: class {
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: ((event: { code: number }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {}
      send(): void {}
      close(): void {}
    },
    MessageEvent: class {
      data: unknown;
      constructor(_type: string, init: { data: unknown }) {
        this.data = init.data;
      }
    },
    // The relay's three push endpoints. Everything else that reaches `fetch`
    // here would be the enterprise's refresh — there is nothing to renew in
    // these cases, so it answers a refusal and a non-401 path never sees it.
    fetch: (
      url: string,
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      } = {},
    ) => {
      if (!url.startsWith("/api/relay/push/")) {
        return Promise.resolve(new FakeResponse(401, {}));
      }
      rest.push({
        url,
        method: init.method ?? "GET",
        authorization: init.headers?.Authorization,
        body: init.body ? JSON.parse(init.body) : undefined,
      });
      if (url === "/api/relay/push/public-key") {
        const plan = options.vapid ?? {};
        if (plan.status)
          return Promise.resolve(new FakeResponse(plan.status, {}));
        return Promise.resolve(
          new FakeResponse(200, { publicKey: plan.publicKey ?? VAPID_KEY }),
        );
      }
      if (init.method === "DELETE") {
        return Promise.resolve(
          new FakeResponse(options.revoke?.status ?? 200, {}),
        );
      }
      const plan = options.register ?? {};
      if (plan.status)
        return Promise.resolve(new FakeResponse(plan.status, {}));
      return Promise.resolve(new FakeResponse(200, { id: plan.id ?? "sub-1" }));
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };

  vm.runInNewContext(SHIM, hostGlobals, { filename: "shim.js" });

  return {
    posted,
    post: (message) => window.acquireVsCodeApi().postMessage(message),
    rest,
    get registered() {
      return state.registered;
    },
    get subscribedWith() {
      return state.subscribedWith;
    },
    get permissionAsked() {
      return state.permissionAsked;
    },
    get unsubscribed() {
      return state.unsubscribed;
    },
    local,
    warns,
    workerMessage: (event) => state.workerMessage?.(event),
    flush,
  };
}

/** The last `pushState` the page sent the webview — the menu's whole input. */
function lastPushState(page: PushHarness) {
  const states = page.posted.filter(
    (m): m is { command: string } =>
      !!m && (m as { command?: string }).command === "pushState",
  );
  return states[states.length - 1];
}

describe("remote page shim — Web Push subscription lifecycle", () => {
  it("registers the push worker on boot, under the hashed name the build filled in", async () => {
    const page = loadShim({ serviceWorker: true, pushManager: true });
    await page.flush();

    // Nothing about this needs the permission prompt, the relay or the login —
    // it is what makes 「开启通知」 possible later, so it happens at load.
    expect(page.registered).toBe(`./${SW_NAME}`);
  });

  it("answers 未开启 for a phone that can do it but has not", async () => {
    const page = loadShim({ serviceWorker: true, pushManager: true });
    await page.flush();

    page.post({ command: "getPushState" });
    await page.flush();

    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: false,
      needsHomeScreen: false,
      reason: "",
    });
  });

  it("says 先添加到主屏幕, not 不支持, on iOS in a Safari tab", async () => {
    // iOS 16.4+ exposes PushManager to a home-screen web app only, so in a tab
    // the capability is missing for a reason the user can act on — reporting
    // 「此浏览器不支持」 would be true of the tab and useless to them (场景 7).
    const page = loadShim({ serviceWorker: true, iosTab: true });
    await page.flush();

    page.post({ command: "getPushState" });
    await page.flush();

    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: false,
      subscribed: false,
      needsHomeScreen: true,
      reason: "",
    });
  });

  it("subscribes, registers the endpoint with the relay, and remembers the id", async () => {
    const page = loadShim({ serviceWorker: true, pushManager: true });
    await page.flush();

    page.post({ command: "enablePushNotifications" });
    await page.flush();

    // Permission first, and from this call: the prompt has to come from the
    // user's tap, never from page load.
    expect(page.permissionAsked).toBe(1);
    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: true,
      needsHomeScreen: false,
      reason: "",
    });

    // Both halves of the switch are visible on the wire: the browser-side
    // subscription took the relay's VAPID key, and the relay got the exact
    // endpoint/keys that subscription actually has.
    expect(page.subscribedWith?.userVisibleOnly).toBe(true);
    expect([...(page.subscribedWith?.applicationServerKey ?? [])].length).toBe(
      65,
    );
    expect(page.rest).toEqual([
      {
        url: "/api/relay/push/public-key",
        method: "GET",
        authorization: "Bearer jwt",
        body: undefined,
      },
      {
        url: "/api/relay/push/subscriptions",
        method: "POST",
        authorization: "Bearer jwt",
        body: SUBSCRIPTION,
      },
    ]);
    // The id is the only handle on the subscription, so it is stored before
    // success is reported — losing it means the relay keeps pushing to a
    // browser that no longer listens.
    expect(page.local.get("wave_remote_push_sub")).toBe("sub-1");
  });

  it("asks for nothing else when the user refuses the permission", async () => {
    const page = loadShim({
      serviceWorker: true,
      pushManager: true,
      permission: "denied",
    });
    await page.flush();

    page.post({ command: "enablePushNotifications" });
    await page.flush();

    // A refused permission is a real answer, not a failure to hide (场景 7):
    // it is reported as such, and no subscription is attempted behind the
    // user's back.
    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: false,
      needsHomeScreen: false,
      reason: "denied",
    });
    expect(page.rest).toEqual([]);
    expect(page.subscribedWith).toBeNull();
  });

  it("says 失败 rather than 已开启 when the relay refuses to register", async () => {
    const page = loadShim({
      serviceWorker: true,
      pushManager: true,
      register: { status: 500 },
    });
    await page.flush();

    page.post({ command: "enablePushNotifications" });
    await page.flush();

    // The browser half did subscribe, so the honest report is "not on": the
    // relay is what actually delivers, and it has nothing.
    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: false,
      needsHomeScreen: false,
      reason: "failed",
    });
    expect(page.local.get("wave_remote_push_sub")).toBeUndefined();
    expect(page.warns.join(" ")).toContain("开启通知失败");
  });

  it("revokes with the relay before dropping the browser subscription", async () => {
    const page = loadShim({
      serviceWorker: true,
      pushManager: true,
      storedPushId: "sub-9",
    });
    await page.flush();

    page.post({ command: "disablePushNotifications" });
    await page.flush();

    expect(page.rest).toEqual([
      {
        url: "/api/relay/push/subscriptions/sub-9",
        method: "DELETE",
        authorization: "Bearer jwt",
        body: undefined,
      },
    ]);
    expect(page.unsubscribed).toBe(true);
    expect(page.local.get("wave_remote_push_sub")).toBe("");
    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: false,
      needsHomeScreen: false,
      reason: "",
    });
  });

  it("keeps the id and says 失败 when the revocation does not land", async () => {
    const page = loadShim({
      serviceWorker: true,
      pushManager: true,
      storedPushId: "sub-9",
      revoke: { status: 500 },
    });
    await page.flush();

    page.post({ command: "disablePushNotifications" });
    await page.flush();

    // The subscription is still live at the relay, so the switch is NOT off.
    // Forgetting the id here would leave pushes arriving for a switch the user
    // believes they turned off — and no way to ever revoke it.
    expect(page.local.get("wave_remote_push_sub")).toBe("sub-9");
    expect(lastPushState(page)).toEqual({
      command: "pushState",
      supported: true,
      subscribed: true,
      needsHomeScreen: false,
      reason: "failed",
    });
    expect(page.warns.join(" ")).toContain("注销订阅失败");
  });

  it("hands a delivered push to the page's own realign path", async () => {
    const page = loadShim({ serviceWorker: true, pushManager: true });
    await page.flush();

    // The worker posts this instead of showing a banner while the page is
    // visible (场景 4, `sw.test.ts`); the page's half is to re-read the session
    // state it is already showing. Anything but `wave-push` is not ours.
    expect(() =>
      page.workerMessage({ data: { type: "something-else" } }),
    ).not.toThrow();
    expect(() =>
      page.workerMessage({
        data: { type: "wave-push", hostId: "h-1", sessionId: "s-1" },
      }),
    ).not.toThrow();
  });
});
