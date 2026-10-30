/**
 * The remote page's service worker, driven the way a browser drives it.
 *
 * `sw.js` ships as plain browser JS with no build step and no module system, so
 * it is evaluated here against a hand-made `self` — the one global it uses, and
 * accordingly the only thing this file has to stub. What is under test is the
 * thing that ships, substitutions and all: `build.mjs` fills `__ICON_FILE__`
 * in, so the harness does the same and asserts the icon in the notification is
 * the hashed name the page actually serves (`sw.test.ts` reasons about the
 * placeholder; `build.mjs` is what writes the hash).
 *
 * The load-bearing rule lives here rather than in the shim: **a visible page
 * means no banner** (spec remote/remote-pwa.md「锁屏也能知道」场景 4). The worker
 * is the only place that can see whether a page is visible at delivery time —
 * the page itself is frozen or gone when it matters — so this check is the one
 * that cannot be tested anywhere else.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * The same substitution `build.mjs` performs — see its `swSource` block, which
 * also fails the build if a token survives (a one-shot `replace` there would
 * leave `ICON` asking for `__ICON_FILE__`, and nothing here could see that).
 * Hence the `/g`, the ES2020 spelling of the `replaceAll` the build uses.
 */
const ICON_NAME = "icon-512.9f2c1ab0d3.png";
const SW = readFileSync(resolve(HERE, "../../remote/sw.js"), "utf-8").replace(
  /__ICON_FILE__/g,
  ICON_NAME,
);

const ORIGIN = "https://codechat.example.com";

interface FakeClient {
  url: string;
  visibilityState: string;
  postMessage: (message: unknown) => void;
  focus: () => Promise<void>;
  navigate: (url: string) => Promise<void>;
}

/** What the page stub records, so a test can read the worker's effect on it. */
interface PageLog {
  /** `postMessage` payloads — the no-banner path's only output. */
  messages: unknown[];
  focused: number;
  navigated: string[];
  closed: number;
}

interface SwHarness {
  /** The registered handler for one event type; the worker registers exactly one each. */
  fire(type: string, event: Record<string, unknown>): Promise<void>;
  /** Every notification `showNotification` was asked to show, in order. */
  shown: { title: string; options: Record<string, unknown> }[];
  /** What `clients.openWindow` was asked to open, in order. */
  opened: string[];
  skippedWaiting: boolean;
  claimed: boolean;
}

/**
 * A page under the worker's scope. `visibilityState` is the whole point of the
 * stub: the worker's one branch reads it and nothing else about the client.
 */
function fakeClient(
  visibilityState: string,
  log: PageLog,
  url = `${ORIGIN}/remote/`,
): FakeClient {
  return {
    url,
    visibilityState,
    postMessage: (message) => log.messages.push(message),
    focus: () => {
      log.focused += 1;
      return Promise.resolve();
    },
    navigate: (next) => {
      log.navigated.push(next);
      return Promise.resolve();
    },
  };
}

function loadWorker(clients: { list: FakeClient[]; log: PageLog }): SwHarness {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const shown: SwHarness["shown"] = [];
  const opened: string[] = [];
  const sw = {
    skippedWaiting: false,
    claimed: false,
  };

  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => {
      sw.skippedWaiting = true;
    },
    addEventListener: (
      type: string,
      handler: (event: Record<string, unknown>) => void,
    ) => {
      handlers.set(type, handler);
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => {
        sw.claimed = true;
        return Promise.resolve();
      },
      matchAll: () => Promise.resolve(clients.list),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };

  vm.runInNewContext(SW, { self, URL, console }, { filename: "sw.js" });

  return {
    shown,
    opened,
    get skippedWaiting() {
      return sw.skippedWaiting;
    },
    get claimed() {
      return sw.claimed;
    },
    async fire(type, event) {
      const handler = handlers.get(type);
      if (!handler) throw new Error(`多出来的事件？${type} 没有注册`);
      let waited: Promise<unknown> | undefined;
      handler({ ...event, waitUntil: (p: Promise<unknown>) => (waited = p) });
      await waited;
    },
  };
}

/** `push` event carrying the relay's payload, as a browser would hand it over. */
function pushEvent(payload: unknown) {
  return {
    data: {
      json: () => {
        if (typeof payload === "string") throw new Error("not json");
        return payload;
      },
      text: () => (typeof payload === "string" ? payload : ""),
    },
  };
}

const empty = (): PageLog => ({
  messages: [],
  focused: 0,
  navigated: [],
  closed: 0,
});

describe("remote page service worker", () => {
  it("takes over immediately on install and claims open pages on activate", async () => {
    const log = empty();
    const worker = loadWorker({ list: [], log });

    await worker.fire("install", {});
    await worker.fire("activate", {});

    // A stale worker would keep a just-redeployed payload parser; there is no
    // other asset to keep in lockstep, so there is no reason to wait.
    expect(worker.skippedWaiting).toBe(true);
    expect(worker.claimed).toBe(true);
  });

  it("announces a push in the page instead of on screen while the user is looking at it", async () => {
    const log = empty();
    const visible = fakeClient("visible", log);
    const worker = loadWorker({ list: [visible], log });

    await worker.fire(
      "push",
      pushEvent({
        title: "有会话等待确认",
        body: "打开页面查看",
        url: "/remote/?host=h-1&session=s-1",
        data: { hostId: "h-1", sessionId: "s-1", state: "requires_action" },
      }),
    );

    // 场景 4: the page is in front of the user, so a system banner on top of the
    // view it is already showing is a duplicate. The fact still has to reach the
    // page — that is the other half of the bargain (the shim's `onWorkerMessage`
    // re-reads the session state, no tab switch, no card).
    expect(worker.shown).toEqual([]);
    expect(log.messages).toEqual([
      {
        type: "wave-push",
        hostId: "h-1",
        sessionId: "s-1",
        state: "requires_action",
      },
    ]);
  });

  it("shows a banner when the page is backgrounded, one per session", async () => {
    const log = empty();
    const worker = loadWorker({
      list: [fakeClient("hidden", log)],
      log,
    });

    await worker.fire(
      "push",
      pushEvent({
        title: "my-mac · 有会话等待确认",
        body: "打开页面查看待确认的命令与改动",
        url: "/remote/?host=h-1&session=s-1",
        data: { hostId: "h-1", sessionId: "s-1" },
      }),
    );

    expect(log.messages).toEqual([]);
    expect(worker.shown).toEqual([
      {
        title: "my-mac · 有会话等待确认",
        options: {
          body: "打开页面查看待确认的命令与改动",
          // One notification per session: a later push for the same session
          // replaces the earlier one rather than stacking.
          tag: "s-1",
          renotify: false,
          // The hashed icon `build.mjs` substituted — not a literal path.
          icon: `./${ICON_NAME}`,
          badge: `./${ICON_NAME}`,
          data: {
            url: "/remote/?host=h-1&session=s-1",
            hostId: "h-1",
            sessionId: "s-1",
          },
        },
      },
    ]);
  });

  it("still notifies when the payload cannot be parsed", async () => {
    const log = empty();
    const worker = loadWorker({ list: [fakeClient("hidden", log)], log });

    // A payload we cannot read is still a signal — and on a locked phone it is
    // the only notice the user gets, so the event must not be dropped.
    await worker.fire("push", pushEvent("有会话等待确认"));

    expect(worker.shown).toEqual([
      {
        title: "CodeWave 远程控制",
        options: expect.objectContaining({ body: "有会话等待确认" }),
      },
    ]);
  });

  it("falls back to a page-scoped tag when no session is named", async () => {
    const log = empty();
    const worker = loadWorker({ list: [fakeClient("hidden", log)], log });

    await worker.fire("push", pushEvent({ body: "有会话已完成" }));

    expect(worker.shown[0].options.tag).toBe("wave-remote");
    expect(worker.shown[0].options.data).toEqual({
      url: "./",
      hostId: undefined,
      sessionId: undefined,
    });
  });

  it("reuses the open window on tap and navigates it to the session", async () => {
    const log = empty();
    const worker = loadWorker({
      list: [
        fakeClient("hidden", log, "https://another.example.com/remote/"),
        fakeClient("hidden", log),
      ],
      log,
    });

    await worker.fire("notificationclick", {
      notification: {
        close: () => (log.closed += 1),
        data: { url: "/remote/?host=h-1&session=s-1" },
      },
    });

    // A home-screen web app is a single window: opening a second one would
    // strand the user outside it, so the page they already have is preferred —
    // and a different origin is not "their page".
    expect(log.closed).toBe(1);
    expect(worker.opened).toEqual([]);
    expect(log.focused).toBe(1);
    expect(log.navigated).toEqual(["/remote/?host=h-1&session=s-1"]);
  });

  it("opens a window when there is none to reuse", async () => {
    const log = empty();
    const worker = loadWorker({ list: [], log });

    await worker.fire("notificationclick", {
      notification: {
        close: () => (log.closed += 1),
        data: { url: "/remote/?host=h-1&session=s-1" },
      },
    });

    expect(log.closed).toBe(1);
    expect(log.focused).toBe(0);
    expect(log.navigated).toEqual([]);
    expect(worker.opened).toEqual(["/remote/?host=h-1&session=s-1"]);
  });
});
