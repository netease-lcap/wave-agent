#!/usr/bin/env node

import { readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `wave -v` / `wave --version` must be fast: editors probe the installed CLI
// version on every launch (e.g. the desktop app's auto-update check). Loading
// the full app graph (wave-agent-sdk, ink, highlight.js, ...) just to print
// the version takes 2-3s+ on a warm machine and can exceed callers' probe
// timeouts on cold starts (AV scan of freshly installed files), which they
// misread as "CLI missing/corrupt" → spurious re-installs. Print the version
// straight from package.json and exit before touching the app graph.
const versionArgs = ["-v", "--version"];
if (process.argv.slice(2).some((a) => versionArgs.includes(a))) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
  );
  writeSync(1, `${packageJson.version}\n`);
  process.exit(0);
}

// Import and start the CLI (single-file esbuild bundle — avoids Node's
// per-import node_modules resolution at startup, ~5s -> ~0.6s module load).
// React's production build is selected at compile time (esbuild define
// replaces `process.env.NODE_ENV` with "production" — see scripts/bundle.mjs),
// so the runtime environment is left untouched: child processes spawned by the
// daemon inherit the user's original NODE_ENV (or none), keeping e.g.
// `npm install` from skipping devDependencies.
import("../dist/bundle/wave.mjs")
  .then(async ({ main }) => {
    try {
      await main();
    } catch (err) {
      console.error("Failed to start CLI:", err);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Failed to import CLI module:", err);
    process.exit(1);
  });
