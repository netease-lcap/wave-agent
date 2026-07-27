#!/usr/bin/env node
/**
 * Sync the shared webview bundle (packages/webview/dist) into
 * packages/desktop/webview and generate the index.html the BrowserWindow
 * loads. CSS is inlined (style-src allows 'unsafe-inline'); the JS bundle is
 * referenced as a file so script-src can stay 'self'.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const webviewDist = path.resolve(desktopRoot, '../webview/dist');
const outDir = path.join(desktopRoot, 'webview');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
].join('; ');

for (const file of ['chat.js', 'chat.css']) {
  if (!fs.existsSync(path.join(webviewDist, file))) {
    console.error(`[syncWebview] Missing ${file} in ${webviewDist}. Run \`pnpm -F wave-webview build\` first.`);
    process.exit(1);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(webviewDist, 'chat.js'), path.join(outDir, 'chat.js'));

const css = fs.readFileSync(path.join(webviewDist, 'chat.css'), 'utf-8');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wave 代码智聊</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="./chat.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
console.log('[syncWebview] webview synced to', outDir);
