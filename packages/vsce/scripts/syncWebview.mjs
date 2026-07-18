import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'node_modules', 'wave-webview', 'dist');
const destDir = path.join(rootDir, 'webview', 'dist');

// Auto-build webview package if its dist is missing
if (!fs.existsSync(srcDir)) {
    console.log('[sync:webview] webview dist not found, building wave-webview...');
    execSync('pnpm -F wave-webview run compile', { stdio: 'inherit' });
}

if (!fs.existsSync(srcDir)) {
    console.error(`[sync:webview] Source still not found after build: ${srcDir}`);
    process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir);
for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`[sync:webview] Copied ${files.length} files to webview/dist/ (${files.join(', ')})`);
