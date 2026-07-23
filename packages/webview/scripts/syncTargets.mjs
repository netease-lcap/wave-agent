import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Sync the freshly built webview bundle into both consumers (VS Code extension and
// JetBrains plugin) so `pnpm -F wave-webview build` alone keeps them up to date.
// Kept as a plain Node script so the webview build has no JVM/gradle dependency;
// it mirrors what vsce's syncWebview.mjs and jetbrains' gradle copyWebviewAssets do.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const webviewDir = path.join(__dirname, '..');
const distDir = path.join(webviewDir, 'dist');
const utilsDir = path.join(webviewDir, 'e2e', 'utils');

const repoRoot = path.join(webviewDir, '..', '..');
const vsceDest = path.join(repoRoot, 'packages', 'vsce', 'webview', 'dist');
const jbDest = path.join(repoRoot, 'packages', 'jetbrains', 'src', 'main', 'resources', 'webview');

if (!fs.existsSync(distDir)) {
    console.error(`[sync-targets] Build output not found: ${distDir}`);
    process.exit(1);
}

// VS Code extension: copy the whole dist (bundle + sourcemaps).
fs.mkdirSync(vsceDest, { recursive: true });
const distFiles = fs.readdirSync(distDir);
for (const file of distFiles) {
    fs.copyFileSync(path.join(distDir, file), path.join(vsceDest, file));
}
console.log(`[sync-targets] vsce: copied ${distFiles.length} files (${distFiles.join(', ')})`);

// JetBrains plugin: only the runtime bundle plus the VS Code theme variables,
// which the plugin loads as theme-base.css.
fs.mkdirSync(jbDest, { recursive: true });
for (const file of ['chat.js', 'chat.css']) {
    fs.copyFileSync(path.join(distDir, file), path.join(jbDest, file));
}
fs.copyFileSync(path.join(utilsDir, 'vscode-styles.css'), path.join(jbDest, 'theme-base.css'));
fs.copyFileSync(path.join(utilsDir, 'theme-base-light.css'), path.join(jbDest, 'theme-base-light.css'));
console.log('[sync-targets] jetbrains: copied chat.js, chat.css, theme-base.css, theme-base-light.css');
