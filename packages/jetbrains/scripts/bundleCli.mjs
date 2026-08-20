#!/usr/bin/env node
/**
 * bundleCli — copy the wave CLI into src/main/resources/wave-cli/ so the
 * JetBrains plugin can run local sessions. The plugin has no host Node runtime
 * (JVM), so it executes the bundled CLI with the customer's system Node.js
 * (>= 22) — no npm-global `wave-code` package needed. Ships the version-probe
 * shim (bin/wave-code.js), the self-contained CLI bundle
 * (dist/bundle/wave.mjs) and the package.json the shim reads for `wave -v`.
 * The grep tool's rg binary is NOT bundled — it is downloaded to ~/.wave/cli
 * on first use. Invoked from build.gradle.kts (bundleCli task).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jbRoot = path.resolve(__dirname, "..");
const codeRoot = path.resolve(jbRoot, "../code");
const outDir = path.join(jbRoot, "src", "main", "resources", "wave-cli");

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

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "dist", "bundle"), { recursive: true });
fs.mkdirSync(path.join(outDir, "bin"), { recursive: true });

fs.copyFileSync(sourceShim, path.join(outDir, "bin", "wave-code.js"));
fs.copyFileSync(sourcePackageJson, path.join(outDir, "package.json"));
fs.copyFileSync(sourceBundle, path.join(outDir, "dist", "bundle", "wave.mjs"));
console.log(`[bundleCli] wave CLI bundled → ${outDir}`);
