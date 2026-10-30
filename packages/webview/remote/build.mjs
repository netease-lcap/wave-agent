#!/usr/bin/env node
/**
 * Build the Web page (PWA-ish) for remote control from the shared webview.
 *
 * The page runs the same frontend bundle the desktop/IDE hosts embed — built
 * from the same `esbuild.config.mjs`, from the same entry — plus `remote/shim.js`
 * as the host-side transport (see that file's header for why the browser shim is
 * what makes the webview a fifth host). Nothing here is built by the normal
 * product build: it writes only into `remote/dist/` (gitignored) and a temp dir
 * it deletes, and touches no existing artifact or workflow. The host artifacts
 * under `packages/webview/dist/` are deliberately left untouched, so a page build
 * can never change what the IDE and desktop apps load.
 *
 * Mirrors `packages/desktop/scripts/syncWebview.mjs` on purpose — same HTML
 * skeleton, same theme-base CSS (with `:root` rewritten per theme so both
 * variable sets coexist). The deliberate deltas:
 *
 * - `connect-src 'none'` → `wss:`: the desktop page talks to its host over
 *   `postMessage` only, while the phone page must reach the relay.
 * - `terminal.*` is filtered out (the phone has no terminal pane), matching the
 *   exclusion `packages/webview/scripts/syncTargets.mjs` applies for VS Code.
 * - Every asset carries a content hash in its file name and the HTML points at
 *   the hashed names; the four IDE hosts keep reading `dist/chat.js` from disk,
 *   so this rename is confined to this build. Rationale: this page is the only
 *   HTTP-served form of the bundle, and a fixed name plus a long cache TTL leaves
 *   phones running yesterday's `chat.js` after a redeploy — silently, because the
 *   page's own version reporting is still a stub (`getStatus` answers
 *   `version: ""`). With hashes the two halves can be cached differently:
 *
 *     /remote/pair…  index.html     no-cache (or a short TTL) — the stable
 *                                  entry point and stays hand-editable
 *     *.<hash>.js/.css              immutable, max-age=31536000
 *
 *   Nothing enforces those headers yet (the hosting task owns that), and the
 *   `no-cache` half is load-bearing: a browser left holding a stale `index.html`
 *   after a deploy pruned the old hashed assets would 404 its own scripts — a
 *   visible break instead of the silent staleness this change exists to remove.
 *   The asset URLs are relative (`./chat.<hash>.js`), so the hosting must serve
 *   the HTML from the directory that holds them — i.e. `/remote/pair` → this
 *   `index.html`, and `/remote/<name>` → the file.
 * - The CSS is a hashed file too, not an inline `<style>`. Inlining it (which is
 *   what the desktop page does) makes `index.html` 508 KB / 130 KB gzipped, of
 *   which all but 636 bytes is CSS — and since the HTML's hash changes whenever
 *   the *JS* does, a JS-only redeploy would resend ~120 KB gzipped of unchanged
 *   CSS on the next load. Split this way, that redeploy re-fetches a 1 KB
 *   skeleton and the CSS/JS come from cache. The cost is one extra
 *   render-blocking request on a first visit — affordable here because the page
 *   is only reachable through the address the computer prints, and it is the
 *   reason the desktop page keeps inlining.
 * - Mermaid rides in its own chunk instead of in `chat.js` (78% of that bundle,
 *   measured: 3.27 MB of 4.09 MB), fetched by the page the first time a message
 *   actually contains a diagram. The loader is `src/mermaid-lazy.ts`, wired in by
 *   `--lazy-mermaid=`; the hosts keep the eager bundle. So the page ships four
 *   files on the critical path (HTML, CSS, the bundle, the shim), one on demand
 *   (mermaid), three for the home screen (manifest + two icons), and one more
 *   fetched after boot on its own — the push service worker (see below).
 * - `sw.js` is the page's service worker, and *only* that: Web Push needs a
 *   worker to receive a notification while the page is closed, so the page
 *   carries one — it does no caching, no offline shell, no fetch handling
 *   (nothing about this page is meant to work offline). It is registered from
 *   the shim after boot and knows nothing about the relay or the login, so a
 *   phone that never enables notifications is unaffected. Two placeholders are
 *   filled in at build time: `__ICON_FILE__` in the worker (the hashed icon the
 *   notification shows) and `__SW_FILE__` in the shim (the worker's own hashed
 *   name — a fixed `sw.js` would take the object store's long TTL and could
 *   never be replaced). The scope comes from the script's own directory, which
 *   is the page's, so no `Service-Worker-Allowed` header is needed.
 *
 * `--zip` additionally packs all of those into `dist/remote-page.zip` with
 * `index.html` at the archive root — the exact shape codechat's Ops upload route
 * takes (`POST /api/ops/remote-page` unpacks it into file-center objects under
 * `codechat/remote/`, served back at `${origin}/remote/`). Handing the zip over
 * is still a manual step on the Ops side (admin-only, writes live objects); this
 * repo only produces it. `remote/zip.mjs` is the writer — no dependency.
 *
 * Usage:
 *   node packages/webview/remote/build.mjs                 # production (minified)
 *   node packages/webview/remote/build.mjs --dev           # unminified, for local iteration
 *   node packages/webview/remote/build.mjs --zip           # …plus dist/remote-page.zip
 *   node packages/webview/remote/build.mjs --socket=wss://relay.example/v1/hosts/ws/<id>/subscribe
 *
 * (or `pnpm -F wave-webview build:remote` / `pnpm -F wave-webview pack:remote`)
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { createZip } from "./zip.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // packages/webview/remote
const WEBVIEW = path.join(HERE, ".."); // packages/webview
const OUT = path.join(HERE, "dist");

const argv = process.argv.slice(2);
const production = !argv.includes("--dev");
const wantZip = argv.includes("--zip");
const socketArg = argv.find((a) => a.startsWith("--socket="));
/**
 * Empty unless the caller pins one: the deployed page derives its socket from
 * its own origin (`/remote/` sits on the relay's domain), so a pinned address
 * is a local-debug override only.
 */
const socketUrl = socketArg ? socketArg.slice("--socket=".length) : "";
/**
 * The page's own version, reported in the relay handshake. It is informational
 * only — no gate reads it (the relay's version floor is gone) — but it has to
 * exist and sit at the frame's top level.
 */
const pageVersion = JSON.parse(
  fs.readFileSync(path.join(WEBVIEW, "package.json"), "utf-8"),
).version;

/**
 * Which commit this page was cut from, stamped into the page so the deployed
 * artifact answers "which build is live" on its own (`curl /remote/` and read
 * the meta tag) — the upload-time label that used to do that job is gone, and
 * it was never trustworthy: it was a string passed to the upload request, once
 * observed pointing at a later commit than the bytes shipped with it.
 *
 * Suffixed `-dirty` when the page's own inputs are modified: HEAD alone would
 * claim a commit the bytes did not come from. The check is scoped to the
 * webview package (plus this `remote/` directory) so that editing something
 * unrelated does not mark every build dirty — a flag that shows up all the time
 * is a flag nobody reads.
 *
 * Empty when there is no git (tarball, shallow CI checkout): absent means "not
 * known", which is honest; a placeholder would be mistaken for a real commit.
 */
const pageSha = (() => {
  const git = (args) => {
    try {
      return execFileSync("git", args, { cwd: HERE, encoding: "utf-8" }).trim();
    } catch {
      return "";
    }
  };
  const sha = git(["rev-parse", "--short=8", "HEAD"]);
  if (!sha) return "";
  const dirty = git(["status", "--porcelain", "--", ".", "../src"]);
  return dirty ? `${sha}-dirty` : sha;
})();

/**
 * The dark theme's page background (`--vscode-editor-background`), the color
 * the browser chrome and the splash take from (`theme-color` meta, manifest
 * `theme_color` / `background_color`). The page boots dark-first.
 */
const PAGE_BACKGROUND = "#1f1f1f";

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // Two widenings over the desktop page, both load-bearing: the relay
  // connection is the page's own (`wss:`), and the page talks same-origin REST
  // — the login renewal (`POST /api/auth/refresh`) and the machine list
  // (`GET /api/relay/hosts`) — hence `'self'`. (The renewal once shipped
  // without it: CSP silently blocked the request, jsdom does not execute CSP,
  // and every test stayed green.) `manifest-src` falls back to `default-src`,
  // which is `'none'` here, so the manifest link needs its own line.
  "connect-src wss: 'self'",
  "manifest-src 'self'",
  // The push service worker (`sw.js`). `worker-src` falls back to `script-src`
  // when absent, which is already `'self'`, so this line spells out what the
  // fallback would allow rather than widening anything — a service worker that
  // the page cannot register is a silent, phone-only failure.
  "worker-src 'self'",
].join("; ");

/** `:root {}` → `:root[data-theme="dark|light"] {}` so both sets coexist. */
const rewriteThemeBase = (css, theme) =>
  css.replace(/:root\s*\{/g, `:root[data-theme="${theme}"] {`);

/**
 * `<base>.<sha256-10>.<ext>` — content-addressed, so the emitted `index.html` is
 * the only thing a redeploy needs to replace: any byte change in the asset
 * changes the name the HTML asks for, and a browser that cached the old name
 * never gets asked for it again. Hence the split in the header comment: HTML
 * `no-cache`, hashed assets `immutable`. Same rule in `--dev` (one code path).
 */
const hashedName = (base, text, ext = "js") =>
  `${base}.${createHash("sha256").update(text).digest("hex").slice(0, 10)}.${ext}`;

/**
 * A placeholder that survived substitution is the one build failure nobody would
 * notice: the page loads and looks right, and only the notification icon (or the
 * registered worker) is wrong. Nothing else can check it — the tests read the
 * sources, not this script's output — so it fails the build here.
 */
function assertSubstituted(text, token) {
  if (text.includes(token)) {
    throw new Error(
      `build.mjs: ${token} survived substitution — the replace missed an occurrence (use replaceAll)`,
    );
  }
}

/**
 * The chart library as its own file, so the page pays for it only when a diagram
 * is rendered. Built before the frontend bundle because the loader needs the
 * hashed name baked in as an esbuild `define`, and it must stay an ES module:
 * the loader fetches it with a runtime `import()`.
 */
function buildMermaidChunk() {
  const { outputFiles } = esbuild.buildSync({
    // A bare specifier is a valid entry point: this is exactly the `mermaid`
    // the frontend would otherwise inline, same version, same entry.
    entryPoints: ["mermaid"],
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: production,
    sourcemap: false,
    write: false,
    logLevel: "warning",
    absWorkingDir: WEBVIEW,
    define: {
      "process.env.NODE_ENV": production ? '"production"' : '"development"',
    },
  });
  const text = outputFiles[0].text;
  return { name: hashedName("mermaid", text), text };
}

/**
 * The frontend bundle, built by the normal config with two extra flags: write to
 * a temp dir instead of `dist/`, and alias `mermaid` to the lazy loader pointed
 * at the chunk above (see `esbuild.config.mjs`).
 */
function buildFrontend(mermaidName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wave-remote-"));
  const args = ["esbuild.config.mjs"];
  if (production) args.push("--production");
  args.push(`--outdir=${tmp}`, `--lazy-mermaid=./${mermaidName}`);
  try {
    execFileSync("node", args, { cwd: WEBVIEW, stdio: "inherit" });
    return {
      chatJs: fs.readFileSync(path.join(tmp, "chat.js"), "utf-8"),
      chatCss: fs.readFileSync(path.join(tmp, "chat.css"), "utf-8"),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function emit({ chatJs, chatCss, mermaid }) {
  const readTheme = (name) =>
    fs.readFileSync(path.join(WEBVIEW, "theme", name), "utf-8");

  const darkTheme = rewriteThemeBase(readTheme("theme-base-dark.css"), "dark");
  const lightTheme = rewriteThemeBase(
    readTheme("theme-base-light.css"),
    "light",
  );
  // Both theme variable sets plus the bundle's stylesheet, in one hashed file —
  // see the header comment for why this is not an inline <style>.
  const pageCss = `${darkTheme}\n${lightTheme}\n${chatCss}\n`;
  const chatName = hashedName("chat", chatJs);
  const cssName = hashedName("chat", pageCss, "css");
  // The home-screen icons (generated from the desktop app's icon by
  // `generate-icons.mjs`, committed under `remote/assets/`): one 180 file
  // serves as favicon and `apple-touch-icon` alike, the 512 backs the
  // manifest. Hashed like every other asset, so a redeploy never serves a
  // stale icon against a fresh page.
  const appleTouch = fs.readFileSync(
    path.join(HERE, "assets", "apple-touch-icon.png"),
  );
  const icon512 = fs.readFileSync(path.join(HERE, "assets", "icon-512.png"));
  const appleTouchName = hashedName("apple-touch-icon", appleTouch, "png");
  const icon512Name = hashedName("icon-512", icon512, "png");
  /**
   * The service worker (spec「锁屏也能知道」): a notification has to reach a
   * phone whose page is closed, so the page ships a worker of its own. Two
   * substitutions, both computed here rather than written into the sources —
   * the worker needs the hashed icon name, and the shim needs the worker's own
   * hashed name (it is what `registerServiceWorker` registers; a literal name
   * could not survive the content hashing, and a fixed name would be cached
   * for the object store's 30-day TTL and could never be replaced).
   *
   * Both use `replaceAll`, not `replace`: a single-shot `replace` substitutes
   * the FIRST occurrence, so the moment either source mentions its placeholder
   * in a comment, the mention silently wins and the file ships with the token
   * still in it — a worker asking for an icon named `__ICON_FILE__`, a shim
   * registering a worker named `__SW_FILE__`. The assertions below are what
   * makes that loud instead of silent.
   */
  const swSource = fs.readFileSync(path.join(HERE, "sw.js"), "utf-8");
  const swText = swSource.replaceAll("__ICON_FILE__", icon512Name);
  const swName = hashedName("sw", swText);
  const shim = fs
    .readFileSync(path.join(HERE, "shim.js"), "utf-8")
    .replaceAll("__SW_FILE__", swName);
  const shimName = hashedName("shim", shim);
  assertSubstituted(swText, "__ICON_FILE__");
  assertSubstituted(shim, "__SW_FILE__");
  /**
   * The web app manifest. `start_url` is the page root **without** a query:
   * which machine to connect to is state the page manages (last choice, then
   * the list), not something the entry point pins — an icon added from a
   * `?host=` address keeps that address regardless. Colors follow the dark
   * theme (`--vscode-editor-background`), the page's default.
   */
  const manifest = JSON.stringify(
    {
      name: "CodeWave 远程控制",
      short_name: "CodeWave",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: PAGE_BACKGROUND,
      theme_color: PAGE_BACKGROUND,
      icons: [
        {
          src: `./${icon512Name}`,
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
    },
    null,
    2,
  );
  const manifestName = hashedName("manifest", manifest, "json");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, chatName), chatJs);
  fs.writeFileSync(path.join(OUT, cssName), pageCss);
  fs.writeFileSync(path.join(OUT, shimName), shim);
  fs.writeFileSync(path.join(OUT, swName), swText);
  fs.writeFileSync(path.join(OUT, mermaid.name), mermaid.text);
  fs.writeFileSync(path.join(OUT, manifestName), manifest);
  fs.writeFileSync(path.join(OUT, appleTouchName), appleTouch);
  fs.writeFileSync(path.join(OUT, icon512Name), icon512);

  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <!-- 这里**不锁**缩放：双指放大是这一页上唯一的「字不够大我自己放大」退路，
       得留着。聚焦不放大改由样式层做到——把文本类控件抬到 16px（iOS Safari 对
       computed font-size < 16px 的文本控件会在聚焦时把整页缩放到等效 16px，15px
       仍触发），见 src/styles/remote-page.css 与 docs/specs/remote/remote-mobile.md
       场景 2。锁缩放那条路 2026-10-14 上过真机，被判定为「字太小又没得放大」。 -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <!-- 主屏元信息：图标与名字（spec remote/remote-pwa.md「PWA 主屏元信息」）。
       apple-touch-icon 是 iOS 认的那一个；standalone 双声明（manifest 与
       meta 各代 iOS 各取其一）；black-translucent 让内容延伸到状态栏之下，
       与 viewport-fit=cover + 安全区内边距的既有设计配套。 -->
  <link rel="icon" type="image/png" href="./${appleTouchName}" />
  <link rel="apple-touch-icon" href="./${appleTouchName}" />
  <link rel="manifest" href="./${manifestName}" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="CodeWave" />
  <meta name="theme-color" content="${PAGE_BACKGROUND}" />
  <link rel="stylesheet" href="./${cssName}" />
  <title>CodeWave 远程控制</title>
  <!-- The page config rides a meta tag, not an inline script: the
       script-src 'self' copied from the desktop page blocks inline execution,
       so an inline window.WAVE_REMOTE = … is silently dropped — measured, not
       theorised. A meta tag also stays editable on the deployed artifact. -->
  <meta name="wave-remote-config" content='${JSON.stringify({ socketUrl, version: pageVersion, sha: pageSha })}' />
</head>
<body>
  <div id="root"></div>
  <script src="./${shimName}"></script>
  <script src="./${chatName}"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, "index.html"), html, "utf-8");

  const pageFiles = [
    "index.html",
    cssName,
    chatName,
    shimName,
    swName,
    mermaid.name,
    manifestName,
    appleTouchName,
    icon512Name,
  ];
  if (wantZip) {
    // 根含 index.html（收端的准入条件），文件名就是相对路径 —— 解包后逐文件
    // 落成 `codechat/remote/<相对路径>` 的对象。
    const zipPath = path.join(OUT, "remote-page.zip");
    fs.writeFileSync(
      zipPath,
      createZip(
        pageFiles.map((name) => ({
          path: name,
          data: fs.readFileSync(path.join(OUT, name)),
        })),
      ),
    );
  }

  const kb = (name) =>
    Math.round(fs.statSync(path.join(OUT, name)).size / 1024) + " KB";
  console.log(
    `remote page -> packages/webview/remote/dist (${production ? "production" : "dev"})`,
  );
  console.log(
    `  index.html ${kb("index.html")}  ${cssName} ${kb(cssName)}  ${chatName} ${kb(chatName)}  ${shimName} ${kb(shimName)}` +
      `  ${swName} ${kb(swName)}` +
      (socketUrl ? `  socket ${socketUrl}` : "  socket: from ?ws="),
  );
  console.log(
    `  on demand: ${mermaid.name} ${kb(mermaid.name)} — fetched when a diagram first renders`,
  );
  if (wantZip) {
    console.log(
      `  zip: remote-page.zip ${kb("remote-page.zip")} (${pageFiles.length} files, root index.html)`,
    );
  }
}

const mermaid = buildMermaidChunk();
emit({ ...buildFrontend(mermaid.name), mermaid });
