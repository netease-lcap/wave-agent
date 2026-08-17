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

// Force React's production build. react-reconciler picks its development build
// unless NODE_ENV === "production"; the dev build records a performance.measure()
// entry for every component render into Node's global perf buffer (never
// cleared), so long CLI sessions accumulate ~150MB per million entries and
// eventually trigger MaxPerformanceEntryBufferExceededWarning. Must be set
// before the dynamic import below evaluates the app graph.
process.env.NODE_ENV ||= "production";

// Import and start the CLI
import("../dist/index.js")
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
