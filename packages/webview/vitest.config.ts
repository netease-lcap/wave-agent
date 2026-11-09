import { createRequire } from "node:module";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const requireFromHere = createRequire(import.meta.url);
const pathBrowserify = requireFromHere.resolve("path-browserify");
const cryptoShim = requireFromHere.resolve("./tests/shims/crypto-browser.ts");

/**
 * Webview unit tests run in a **real Chromium** (vitest browser mode).
 *
 * The suite used to emulate the DOM with jsdom, which does no layout: the old
 * `tests/setup.ts` stubbed `offsetHeight`/`offsetWidth`/`scrollTo`/
 * `DataTransfer`/`innerText` so components would render at all. Those stubs
 * made every layout assertion measure the stub instead of the component, so
 * the whole suite now runs where the APIs are real.
 *
 * The suite is split by what a spec actually needs, not by taste:
 *  - `browser` (the default): every DOM spec.
 *  - `node`: the remote-page specs that build their own `vm` context around a
 *    shipped script (`remote/sw.js`) or just read a file and assert on its
 *    source. They never touch `document`, so a DOM environment is pure
 *    overhead — `environment: 'node'` is what the Vitest docs recommend for
 *    exactly this shape.
 *  - `jsdom`: the specs that need a DOM *and* node built-ins. Two shapes:
 *    (a) the ones that load the shipped `remote/shim.js` and drive it through a
 *    stub WebSocket plus a jsdom `window` — that fake host is the design, not a
 *    shortcut: the cases are frame misattribution (another session's frames, a
 *    switch that overtakes an in-flight reply), which needs the relay to stay a
 *    stub and the shim's `location.replace` to stay a no-op (a real browser
 *    would navigate the test iframe away);
 *    (b) `settingsGlobal`, whose import chain reaches `os.homedir` through the
 *    SDK's constants (`Module "os" has been externalized` is what the browser
 *    project says if you move it back), and `errorBoundary` for one case: it
 *    asserts a navigation side effect (`location.reload`) and a real browser's
 *    `location` is unforgeable, while a real `location.reload()` inside browser
 *    mode hangs the run (vitest#6439) — jsdom lets the spec swap the object.
 */
const REMOTE_SPECS = ["tests/remote/**/*.test.ts"];
/** Remote-page specs that need nothing but Node — no DOM at all. */
const NODE_SPECS = [
  "tests/remote/sw.test.ts",
  "tests/remote/remotePageZoomGuard.test.ts",
];
const JSDOM_SPECS = [
  ...REMOTE_SPECS,
  "tests/webview/settingsGlobal.test.tsx",
  "tests/webview/errorBoundary.test.tsx",
];

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.tsx", "src/**/*.css"],
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: NODE_SPECS,
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: JSDOM_SPECS,
          exclude: [...NODE_SPECS, "**/node_modules/**"],
          setupFiles: ["tests/setup.jsdom.ts"],
          // Node 25+ ships its own experimental localStorage accessor on
          // globalThis; vitest then skips installing jsdom's working Storage
          // (vitest-dev/vitest#10867), leaving `window.localStorage`
          // undefined. Disable the node accessor so jsdom's copy lands — the
          // flag is rejected on older Node, hence the version guard.
          execArgv:
            Number(process.versions.node.split(".")[0]) >= 25
              ? ["--no-webstorage"]
              : [],
        },
      },
      {
        test: {
          name: "browser",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          // `JSDOM_SPECS` already covers every `tests/remote/**` spec (node + jsdom).
          exclude: [...JSDOM_SPECS, "node_modules"],
          setupFiles: ["tests/setup.browser.ts"],
          // jsdom's `window.innerWidth` is a constant 1024; a real browser's
          // default viewport instead pushes the panes into their narrow-layout
          // branch and every locator misses. Pin a desktop-sized viewport.
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            viewport: { width: 1280, height: 800 },
            instances: [{ browser: "chromium" }],
          },
        },
        resolve: {
          alias: [
            // Both shims exist for the module graph, not for assertions: some
            // specs still reach node built-ins transitively, and the browser
            // has neither. `createRequire` keeps the resolved paths absolute —
            // a bare package name fails to resolve from a spec in `tests/`.
            { find: /^path$/, replacement: pathBrowserify },
            { find: /^node:path$/, replacement: pathBrowserify },
            { find: /^crypto$/, replacement: cryptoShim },
            { find: /^node:crypto$/, replacement: cryptoShim },
          ],
        },
      },
    ],
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
  },
});
