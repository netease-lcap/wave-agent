/**
 * JS call-stack sampling for a frozen renderer.
 *
 * Why: when the UI hangs we know *nothing* about where it is stuck — the main
 * process only sees "no response". `mainFrame.collectJavaScriptCallStack()`
 * asks the renderer for its current JS stack; sampling it once a second and
 * de-duplicating turns a 15-second freeze into "this stack was on top 12 of 15
 * times", which is usually enough to name the culprit.
 *
 * Constraints that shaped this file:
 * - The collector needs `Document-Policy: include-js-call-stacks-in-crash-reports`
 *   on the document (installed for `file://` in index.ts) and, per the Electron
 *   docs, **never resolves** when the frame runs no JS at all. Both are guarded:
 *   every sample has a timeout, and a failed sample is logged — once — instead
 *   of stalling the whole sampling window.
 * - Sampling must never block the main process: it is a `setTimeout` chain, not
 *   a loop, and it stops itself after `SAMPLE_PERIOD_MS` so a permanently
 *   frozen app cannot grow the map forever.
 */

import type { BrowserWindow } from "electron";
import { hostLog, type HostLogLevel } from "./hostLog";

export const SAMPLE_INTERVAL_MS = 1000;
export const SAMPLE_PERIOD_MS = 15_000;
/** A collect that has not answered by now will not answer at all. */
export const SAMPLE_TIMEOUT_MS = 2000;

/**
 * Chromium only hands out JS call stacks to documents that opt in — without
 * this the collector rejects with "Website owner has not opted in for JS call
 * stacks in crash reports." (verified against Electron 43). The header is
 * installed for the `file://` webview in index.ts.
 */
export const JS_CALL_STACKS_DOCUMENT_POLICY =
  "include-js-call-stacks-in-crash-reports";

/**
 * Long stacks are truncated to this many lines. V8 stacks for runaway React /
 * GC work can be thousands of frames; keeping the top (where the work is
 * happening) plus an explicit truncation marker keeps the log readable without
 * silently dropping the whole stack.
 */
export const MAX_STACK_LINES = 40;

export type SamplerLog = {
  block: (level: HostLogLevel, lines: string[]) => void;
  warn: (...args: unknown[]) => void;
};

export type UnresponsiveSamplerOptions = {
  /** Label for the log line; this app has a single window, tests pass one. */
  windowName?: string;
  intervalMs?: number;
  periodMs?: number;
  sampleTimeoutMs?: number;
  log?: SamplerLog;
  /** Injected in tests; defaults to the renderer's own collector. */
  collect?: () => Promise<string | void>;
  /** Injected in tests so the URL in the flush line is deterministic. */
  currentUrl?: () => string;
};

export type UnresponsiveSampler = {
  start: () => void;
  stopAndFlush: () => boolean;
  isSampling: () => boolean;
};

export function truncateStack(
  stack: string,
  maxLines: number = MAX_STACK_LINES,
): string {
  // `collectJavaScriptCallStack` answers with a leading newline; trimming keeps
  // the first log line meaningful (`<12> at window.spin (…)`).
  const lines = stack.trim().split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return [
    ...lines.slice(0, maxLines),
    `… ${lines.length - maxLines} more frames truncated`,
  ].join("\n");
}

/**
 * Flush payload. Count first (`<12> <stack>`) because the count is the signal —
 * a stack seen 12 of 15 times is the freeze, one seen once is noise.
 *
 * Zero samples is still worth writing: it says "the window was frozen for 15
 * seconds and we could not read a stack" — very different from "nothing
 * happened", and the failed-collect reason goes on the line.
 */
export function formatSampleBlock(
  samples: Map<string, number>,
  meta: {
    windowName: string;
    url: string;
    intervalMs: number;
    periodMs: number;
    failure?: string;
  },
): string[] {
  const entries = [...samples.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const header = `renderer unresponsive: JS stack samples (every ${meta.intervalMs}ms, up to ${meta.periodMs}ms) window=${meta.windowName} url=${meta.url}`;
  if (entries.length === 0) {
    return [
      header,
      `no stack samples collected${meta.failure ? `: ${meta.failure}` : ""}`,
      "Total Samples: 0",
    ];
  }
  return [
    header,
    ...entries.flatMap(([stack, count]) => {
      const [top, ...rest] = truncateStack(stack).split("\n");
      return [`<${count}> ${top}`, ...rest];
    }),
    `Total Samples: ${total}`,
  ];
}

export function createUnresponsiveSampler(
  win: BrowserWindow,
  options: UnresponsiveSamplerOptions = {},
): UnresponsiveSampler {
  const {
    windowName = "main",
    intervalMs = SAMPLE_INTERVAL_MS,
    periodMs = SAMPLE_PERIOD_MS,
    sampleTimeoutMs = SAMPLE_TIMEOUT_MS,
    log = hostLog,
    currentUrl = () => safeUrl(win),
  } = options;
  const collect =
    options.collect ??
    (() => win.webContents.mainFrame.collectJavaScriptCallStack());

  let sampleTimer: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let sampling = false;
  // Why the last collect produced nothing — reported once, in the flush line.
  let failure: string | undefined;
  // Keyed by the full stack string: identical top-of-stack across seconds is
  // exactly what identifies "stuck here" rather than "busy here".
  const samples = new Map<string, number>();

  const alive = (): boolean =>
    !win.isDestroyed() && !win.webContents.isDestroyed();

  const clearTimers = (): void => {
    if (sampleTimer) clearTimeout(sampleTimer);
    if (stopTimer) clearTimeout(stopTimer);
    sampleTimer = undefined;
    stopTimer = undefined;
  };

  const schedule = (): void => {
    sampleTimer = setTimeout(() => {
      void sampleOnce();
    }, intervalMs);
  };

  /**
   * The collector can hang forever (no JS running in the frame, or the renderer
   * is wedged below V8). Without a race, one hang would silently end the whole
   * sampling window.
   */
  const collectWithTimeout = async (): Promise<string | void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        collect(),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), sampleTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const sampleOnce = async (): Promise<void> => {
    if (!sampling || !alive()) return;
    let stack: string | void = undefined;
    try {
      stack = await collectWithTimeout();
      if (!stack) failure ??= "collectJavaScriptCallStack returned nothing";
    } catch (error) {
      // Expected once the renderer is gone; keep the message (a missing
      // Document-Policy surfaces here too — once per episode).
      failure ??= error instanceof Error ? error.message : String(error);
    }
    if (!sampling || !alive()) return;
    if (stack) samples.set(stack, (samples.get(stack) ?? 0) + 1);
    schedule();
  };

  const stopAndFlush = (): boolean => {
    const wasSampling = sampling;
    sampling = false;
    clearTimers();
    if (wasSampling) {
      // Flushed even with zero samples: "frozen for 15s, stack unavailable" is
      // evidence, and the reason is what tells us why the sampler was blind.
      log.block(
        "WARN",
        formatSampleBlock(samples, {
          windowName,
          url: currentUrl(),
          intervalMs,
          periodMs,
          failure,
        }),
      );
    }
    samples.clear();
    failure = undefined;
    return wasSampling;
  };

  const start = (): void => {
    // No point asking a DevTools-attached renderer (debugging already pauses
    // it) or a destroyed one.
    if (sampling || !alive() || win.webContents.isDevToolsOpened()) return;
    sampling = true;
    samples.clear();
    failure = undefined;
    schedule();
    stopTimer = setTimeout(() => {
      stopAndFlush();
    }, periodMs);
  };

  // Window closed mid-episode: flush what we have instead of losing it.
  win.on("closed", () => {
    stopAndFlush();
  });

  return { start, stopAndFlush, isSampling: () => sampling };
}

function safeUrl(win: BrowserWindow): string {
  try {
    return win.isDestroyed() ? "destroyed" : win.webContents.getURL();
  } catch {
    return "unknown";
  }
}
