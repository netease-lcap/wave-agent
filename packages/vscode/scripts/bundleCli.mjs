#!/usr/bin/env node
/**
 * bundleCli — copy the wave CLI into dist/wave-cli/ so the extension runs its
 * agent with the extension-host Node runtime — no system Node.js/npm required.
 * Ships the version-probe shim (bin/wave-code.js), the self-contained CLI
 * bundle (dist/bundle/wave.mjs) and the package.json the shim reads for
 * `wave -v`. The grep tool's rg binary is NOT bundled — it is downloaded to
 * ~/.wave/cli on first use. dist/ is already part of the published vsix
 * (package.json "files"), so the CLI ships with the extension and its version
 * tracks the extension version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeRoot = path.resolve(__dirname, "..");
const codeRoot = path.resolve(vscodeRoot, "../code");
const outDir = path.join(vscodeRoot, "dist", "wave-cli");

const sourceBundle = path.join(codeRoot, "dist", "bundle", "wave.mjs");
const sourceShim = path.join(codeRoot, "bin", "wave-code.js");
const sourcePackageJson = path.join(codeRoot, "package.json");
for (const f of [sourceBundle, sourceShim, sourcePackageJson]) {
  if (!fs.existsSync(f)) {
    console.error(
      `[bundleCli] 缺少 wave CLI 构建产物：${f}。请先构建 packages/code（pnpm -F wave-code build）。`,
    );
    process.exit(1);
  }
}

// The bundle is copied verbatim, so a checkout that was never rebuilt ships
// whatever CLI happened to be in packages/code/dist. Existing-only checks miss
// the dangerous case (file present but stale): the wave-vscode@1.1.11
// pre-release shipped a CLI predating the contextUsagePercent fix while its
// extension host had it, so the getMessages replay silently did nothing. CI
// avoids this with an explicit `pnpm -F wave-code build`; local/matrix runs
// have nothing enforcing it. Compare against the sources instead of trusting
// the caller.
//
// wave-agent-sdk is inlined at bundle time (it resolves through
// node_modules/wave-agent-sdk to packages/agent-sdk/dist), so a stale SDK
// produces just as stale a CLI and has to be part of the check.
function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const { mtimeMs } = fs.statSync(path.join(entry.parentPath, entry.name));
    if (mtimeMs > newest) newest = mtimeMs;
  }
  return newest;
}

const sourceTrees = [
  path.join(codeRoot, "src"),
  path.resolve(codeRoot, "..", "agent-sdk", "src"),
];
const newestSourceMs = Math.max(...sourceTrees.map(newestMtimeMs));
const bundleMtimeMs = fs.statSync(sourceBundle).mtimeMs;
if (bundleMtimeMs < newestSourceMs) {
  console.error(
    `[bundleCli] wave CLI 构建产物比源码旧（bundle ${new Date(bundleMtimeMs).toISOString()} < src ${new Date(newestSourceMs).toISOString()}）。` +
      "请先重新构建 packages/code（pnpm -F wave-agent-sdk build && pnpm -F wave-code build）再打包，否则扩展会夹带旧 CLI。",
  );
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "dist", "bundle"), { recursive: true });
fs.mkdirSync(path.join(outDir, "bin"), { recursive: true });

fs.copyFileSync(sourceShim, path.join(outDir, "bin", "wave-code.js"));
fs.copyFileSync(sourcePackageJson, path.join(outDir, "package.json"));
fs.copyFileSync(sourceBundle, path.join(outDir, "dist", "bundle", "wave.mjs"));
console.log(`[bundleCli] wave CLI bundled → ${outDir}`);
