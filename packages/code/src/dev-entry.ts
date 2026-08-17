// Dev bootstrap for `pnpm run wave` (tsx).
//
// React/ink (via react-reconciler) load their development build when NODE_ENV
// is not "production"; that build records a performance.measure() entry for
// every component render into Node's global perf buffer (never cleared), which
// after 1M entries triggers MaxPerformanceEntryBufferExceededWarning and leaks
// ~150MB per million entries. The production build has no such instrumentation.
//
// This must run BEFORE importing ./index.js: ESM static imports are hoisted, so
// setting NODE_ENV inside index.ts itself would be too late (react-reconciler
// is already evaluated). An explicit NODE_ENV (e.g. NODE_ENV=development) is
// respected, to allow debugging with React dev-only diagnostics when needed.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

const { main } = await import("./index.js");

main().catch((error) => {
  console.error("Failed to start WAVE Code:", error);
  process.exit(1);
});
