import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const production = process.argv.includes('--production');

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', 'wave-webview', 'dist');
const destDir = path.join(rootDir, 'webview', 'dist');

// In production mode always rebuild the webview (minified, no source maps).
// In dev mode only build if dist is missing.
if (production) {
    console.log('[sync:webview] production build of wave-webview...');
    execSync('pnpm -F wave-webview run compile -- --production', { stdio: 'inherit' });
} else if (!fs.existsSync(srcDir)) {
    console.log('[sync:webview] webview dist not found, building wave-webview...');
    execSync('pnpm -F wave-webview run compile', { stdio: 'inherit' });
}

if (!fs.existsSync(srcDir)) {
    console.error(`[sync:webview] Source still not found after build: ${srcDir}`);
    process.exit(1);
}

// Clear destDir so it mirrors srcDir exactly (removes stale files from prior builds).
fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

// Exclude source maps in production as a safety net.
const files = fs.readdirSync(srcDir).filter(f => !production || !f.endsWith('.map'));
for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`[sync:webview] Copied ${files.length} files to webview/dist/ (${files.join(', ')})`);
