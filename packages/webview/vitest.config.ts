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
 * The suite is split by what a spec actually needs:
 *  - `browser` (the default): every DOM spec.
 *  - `jsdom`: the specs that need node built-ins (`node:vm`/`node:fs` — the
 *    remote-page shims and the source-reading guards) *and* a DOM. Holding
 *    them in jsdom keeps node polyfills out of the browser project. The error
 *    boundary joins them for one case: it asserts a navigation side effect
 *    (`location.reload`), and a real browser's `location` is unforgeable —
 *    jsdom lets the spec swap the whole location object.
 */
const NODE_SPECS = ["tests/remote/**/*.test.ts"];
const JSDOM_SPECS = [
  ...NODE_SPECS,
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
          name: "jsdom",
          environment: "jsdom",
          include: JSDOM_SPECS,
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
          exclude: [...NODE_SPECS, ...JSDOM_SPECS, "node_modules"],
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
