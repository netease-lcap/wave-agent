#!/usr/bin/env node
/**
 * Sync the shared webview bundle (packages/webview/dist) into
 * packages/desktop/webview and generate the index.html the BrowserWindow
 * loads. CSS is inlined (style-src allows 'unsafe-inline'); the JS bundle is
 * referenced as a file so script-src can stay 'self'.
 *
 * Both VS Code theme variable sets (theme-base-dark/light) are inlined with
 * `:root[data-theme="dark|light"]` selectors so the renderer can switch themes
 * by toggling the `data-theme` attribute on <html> — no reload, no React tree
 * rebuild (FR-018). chat.css follows the variable sets so `var(--vscode-*)`
 * resolves against the active theme.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const webviewDist = path.resolve(desktopRoot, "../webview/dist");
const themeDir = path.resolve(desktopRoot, "../webview/theme");
const outDir = path.join(desktopRoot, "webview");

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
].join("; ");

for (const file of ["chat.js", "chat.css", "terminal.js", "terminal.css"]) {
  if (!fs.existsSync(path.join(webviewDist, file))) {
    console.error(
      `[syncWebview] Missing ${file} in ${webviewDist}. Run \`pnpm -F wave-webview build\` first.`,
    );
    process.exit(1);
  }
}
for (const file of ["theme-base-dark.css", "theme-base-light.css"]) {
  if (!fs.existsSync(path.join(themeDir, file))) {
    console.error(`[syncWebview] Missing ${file} in ${themeDir}.`);
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(
  path.join(webviewDist, "chat.js"),
  path.join(outDir, "chat.js"),
);
// Desktop-only terminal chunk — lazy-injected by TerminalPane via a same-origin
// <script> tag (CSP script-src 'self' allows it); its CSS is inlined up front.
fs.copyFileSync(
  path.join(webviewDist, "terminal.js"),
  path.join(outDir, "terminal.js"),
);

// Rewrite each theme-base `:root { ... }` block to only apply when <html> carries
// the matching `data-theme` attribute, so both sets can coexist in one <style>.
const rewriteThemeBase = (css, theme) =>
  css.replace(/:root\s*\{/g, `:root[data-theme="${theme}"] {`);

const chatCss = fs.readFileSync(path.join(webviewDist, "chat.css"), "utf-8");
const terminalCss = fs.readFileSync(
  path.join(webviewDist, "terminal.css"),
  "utf-8",
);
const darkThemeCss = rewriteThemeBase(
  fs.readFileSync(path.join(themeDir, "theme-base-dark.css"), "utf-8"),
  "dark",
);
const lightThemeCss = rewriteThemeBase(
  fs.readFileSync(path.join(themeDir, "theme-base-light.css"), "utf-8"),
  "light",
);
const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codewave IDE</title>
  <style>
${darkThemeCss}
${lightThemeCss}
${chatCss}
${terminalCss}
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="./chat.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");
console.log("[syncWebview] webview synced to", outDir);
