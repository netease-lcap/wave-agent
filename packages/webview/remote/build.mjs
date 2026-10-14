#!/usr/bin/env node
/**
 * Build the phone page (PWA-ish) from the shared webview bundle.
 *
 * The page is the same `chat.js` the desktop/IDE hosts embed, plus
 * `remote/shim.js` as the host-side transport (see that file's header for why
 * the browser shim is what makes the webview a fifth host). Nothing here is
 * built by the normal product build: it writes only into `remote/dist/`, which
 * is gitignored, and touches no existing artifact or workflow.
 *
 * Mirrors `packages/desktop/scripts/syncWebview.mjs` on purpose — same HTML
 * skeleton, same inlined theme-base CSS (with `:root` rewritten per theme so
 * both variable sets coexist), same "copy the JS, inline the CSS" split. The
 * two deliberate deltas:
 *
 * - `connect-src 'none'` → `wss:`: the desktop page talks to its host over
 *   `postMessage` only, while the phone page must reach the relay.
 * - `terminal.*` is filtered out (the phone has no terminal pane), matching the
 *   exclusion `packages/webview/scripts/syncTargets.mjs` applies for VS Code.
 *
 * Usage:
 *   node packages/webview/remote/build.mjs                 # production (minified)
 *   node packages/webview/remote/build.mjs --dev           # unminified, for local iteration
 *   node packages/webview/remote/build.mjs --socket=wss://relay.example/v1/hosts/ws/<id>/client
 *
 * (or `pnpm -F wave-webview build:remote` from the repo root)
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // packages/webview/remote
const WEBVIEW = path.join(HERE, ".."); // packages/webview
const DIST = path.join(WEBVIEW, "dist");
const OUT = path.join(HERE, "dist");

const argv = process.argv.slice(2);
const production = !argv.includes("--dev");
const socketArg = argv.find((a) => a.startsWith("--socket="));
/** Empty unless the caller pins one: the page then reads `?ws=`/`?code=`. */
const socketUrl = socketArg ? socketArg.slice("--socket=".length) : "";

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // The one widening over the desktop page: the phone page is not bridged to a
  // parent process, so the relay connection is the page's own.
  "connect-src wss:",
].join("; ");

/** `:root {}` → `:root[data-theme="dark|light"] {}` so both sets coexist. */
const rewriteThemeBase = (css, theme) =>
  css.replace(/:root\s*\{/g, `:root[data-theme="${theme}"] {`);

function build() {
  // `--production` is what the release pipelines pass for the host embeds; the
  // difference is not cosmetic (measured 2026-10-13: 10.3 MB dev vs 4.2 MB
  // minified for chat.js).
  const args = ["esbuild.config.mjs"];
  if (production) args.push("--production");
  execFileSync("node", args, { cwd: WEBVIEW, stdio: "inherit" });
}

function emit() {
  const read = (name) => {
    const file = path.join(DIST, name);
    if (!fs.existsSync(file)) {
      throw new Error(
        `missing ${name} in packages/webview/dist — run \`pnpm -F wave-webview build\` first`,
      );
    }
    return fs.readFileSync(file, "utf-8");
  };

  const readTheme = (name) =>
    fs.readFileSync(path.join(WEBVIEW, "theme", name), "utf-8");

  const chatJs = read("chat.js");
  const chatCss = read("chat.css");
  const darkTheme = rewriteThemeBase(readTheme("theme-base-dark.css"), "dark");
  const lightTheme = rewriteThemeBase(
    readTheme("theme-base-light.css"),
    "light",
  );
  const shim = fs.readFileSync(path.join(HERE, "shim.js"), "utf-8");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "chat.js"), chatJs);
  fs.writeFileSync(path.join(OUT, "shim.js"), shim);

  const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <link rel="icon" href="data:," />
  <title>CodeWave 远程控制</title>
  <!-- The page config rides a meta tag, not an inline script: the
       script-src 'self' copied from the desktop page blocks inline execution,
       so an inline window.WAVE_REMOTE = … is silently dropped — measured, not
       theorised. A meta tag also stays editable on the deployed artifact. -->
  <meta name="wave-remote-config" content='${JSON.stringify({ socketUrl })}' />
  <style>
${darkTheme}
${lightTheme}
${chatCss}
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="./shim.js"></script>
  <script src="./chat.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, "index.html"), html, "utf-8");

  const kb = (name) =>
    Math.round(fs.statSync(path.join(OUT, name)).size / 1024) + " KB";
  console.log(
    `remote page -> packages/webview/remote/dist (${production ? "production" : "dev"})`,
  );
  console.log(
    `  index.html  chat.js ${kb("chat.js")}  shim.js ${kb("shim.js")}` +
      (socketUrl ? `  socket ${socketUrl}` : "  socket: from ?ws="),
  );
}

build();
emit();
