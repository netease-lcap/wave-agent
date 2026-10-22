/**
 * Periodic renderer-memory reading from `app.getAppMetrics()`.
 *
 * Why: the black-screen incident *might* be the V8 heap giving up under
 * "base64 images + the full message history" (the crash stack is a GC
 * write-barrier stall). We cannot prove or exclude that from a single snapshot —
 * what we need is a curve: does the renderer's working set climb for hours
 * before the crash? One line every minute is cheap and gives the next incident
 * a before/after.
 *
 * Units: Electron reports `workingSetSize` / `peakWorkingSetSize` in **KB**;
 * the log prints MB because that is the number a human compares to the
 * "2 GB heap" mental model.
 */

import { app } from "electron";
import { hostLog, type HostLogLevel } from "./hostLog";

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;

export type MemoryLog = {
  block: (level: HostLogLevel, lines: string[]) => void;
  warn: (...args: unknown[]) => void;
};

export type RendererMemory = {
  pid: number;
  workingSetMb: number;
  peakWorkingSetMb: number;
};

export type MemorySampler = {
  start: () => void;
  stop: () => void;
  /** Last reading, formatted; used by the crash log to correlate size ↔ crash. */
  lastLine: () => string | undefined;
};

/** KB → MB with one decimal: sub-MB precision is noise, 3-digit MB is not. */
export function kbToMb(kb: number): number {
  return Math.round((kb / 1024) * 10) / 10;
}

/**
 * Only `type === "Tab"` entries are renderers (the thing that went black);
 * Browser/GPU/Utility memory is a different story and would blur the curve.
 */
export function rendererMemoryFromMetrics(
  metrics: readonly Electron.ProcessMetric[],
): RendererMemory[] {
  return metrics
    .filter((metric) => metric.type === "Tab")
    .map((metric) => ({
      pid: metric.pid,
      workingSetMb: kbToMb(metric.memory.workingSetSize),
      peakWorkingSetMb: kbToMb(metric.memory.peakWorkingSetSize),
    }));
}

export function formatMemoryLine(sample: RendererMemory): string {
  return `renderer memory pid=${sample.pid} workingSet=${sample.workingSetMb}MB peak=${sample.peakWorkingSetMb}MB`;
}

export function createMemorySampler(
  options: {
    intervalMs?: number;
    log?: MemoryLog;
    getMetrics?: () => readonly Electron.ProcessMetric[];
  } = {},
): MemorySampler {
  const {
    intervalMs = MEMORY_SAMPLE_INTERVAL_MS,
    log = hostLog,
    getMetrics = () => app.getAppMetrics(),
  } = options;

  let timer: ReturnType<typeof setInterval> | undefined;
  let last: string | undefined;

  const sampleOnce = (): void => {
    let samples: RendererMemory[];
    try {
      samples = rendererMemoryFromMetrics(getMetrics());
    } catch (error) {
      log.warn("[desktop] renderer memory sample failed:", error);
      return;
    }
    // Before the window's renderer exists there is no Tab entry — say nothing
    // rather than logging an empty reading every minute.
    if (samples.length === 0) return;
    log.block("INFO", samples.map(formatMemoryLine));
    last = samples.map(formatMemoryLine).join("; ");
  };

  return {
    start: () => {
      if (timer) return;
      // First reading immediately: with a 60s interval, a crash inside the
      // first minute would otherwise have no memory evidence at all.
      sampleOnce();
      timer = setInterval(sampleOnce, intervalMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    lastLine: () => last,
  };
}
