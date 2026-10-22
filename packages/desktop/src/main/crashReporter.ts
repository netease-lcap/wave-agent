/**
 * Local-only crash reporting (minidumps) + the startup evidence line.
 *
 * Why: a user ran CodeWave IDE for ~53h, then the whole UI went black while her
 * tasks kept running. macOS left a crash report (`EXC_BREAKPOINT` / `SIGTRAP`,
 * Thread 0 = CrRendererMain, top frames in
 * `cppgc::internal::WriteBarrier::…MarkingBarrierRangeSlow`) — a native V8
 * GC/heap crash. Without a dump we can only guess; with one, the native stack
 * says whether it was heap/GC pressure (the "base64 images + full message
 * history" suspect) or something unrelated.
 *
 * Deliberately `uploadToServer: false`: this product has no crash-collection
 * backend, and silently shipping dumps would be a privacy decision we have not
 * made. Dumps stay on the user's disk and travel only when the user picks
 * 「导出日志」 in the recovery dialog.
 */

import { app, crashReporter } from "electron";
import { hostLog, LOG_DIR } from "./hostLog";

/**
 * Must run before `app.whenReady()` — Crashpad has to be up before the first
 * renderer exists, otherwise a launch-time renderer crash produces no dump.
 */
export function startLocalCrashReporter(): void {
  crashReporter.start({ uploadToServer: false, compress: true });

  // Logged at startup on purpose: support/ops ask the user "send me the
  // files", and both locations differ per platform (crashDumps follows
  // userData; the text logs follow WAVE_LOGS_DIR). One line in desktop.log
  // saves a round of guessing.
  hostLog.info(
    `[desktop] crash evidence dirs dumps=${crashDumpsDir()} logs=${LOG_DIR}`,
  );

  logLastCrashReport();
}

/**
 * Crashpad keeps the reports of *previous* runs until it uploads (here:
 * forever, since we never upload), so `getLastCrashReport()` answers "did the
 * last run die of a native crash?" — the difference between a real crash and
 * the user force-killing a black window.
 */
function logLastCrashReport(): void {
  let report: Electron.CrashReport | null = null;
  try {
    report = crashReporter.getLastCrashReport();
  } catch (error) {
    hostLog.warn("[desktop] failed to read last crash report:", error);
    return;
  }
  if (!report) {
    hostLog.info("[desktop] no crash dump from a previous run");
    return;
  }
  // CrashReport carries only date + id: the termination reason (SIGTRAP,
  // EXC_BREAKPOINT, OOM, …) lives inside the .dmp file, so point at the
  // directory instead of inventing a field the API does not expose.
  hostLog.warn(
    `[desktop] previous run left a crash dump id=${report.id} date=${new Date(report.date).toISOString()} dir=${crashDumpsDir()}`,
  );
}

/** Minidump directory (Crashpad's own path), also what 「导出日志」 packs. */
export function crashDumpsDir(): string {
  return app.getPath("crashDumps");
}
