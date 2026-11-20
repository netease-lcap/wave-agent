/**
 * `[process-memory]` snapshots of our own Electron process tree — the shape
 * Claude Code's desktop app uses, minus everything we cannot honestly produce.
 *
 * Why (incident 2026-11-20): a Windows user ran CodeWave IDE for 47h and the
 * renderer died of PartitionAlloc OOM (`0xE0000008`) while holding only 668 MB
 * — the machine was out of *commit*, not of our memory (4.8 MiB left of
 * 61.73 GiB). We could prove "we were starved" but not "how much of it was us",
 * because the old sampler only looked at `type === "Tab"` and never wrote a
 * time series (47h produced 4 log lines). This module answers the first half of
 * that question — **our whole Electron tree, next to what the system has left** —
 * and deliberately stops there: no other applications, no commit limit (CC has
 * neither, and the brief says not to invent them).
 *
 * Format (CC `[process-memory]`, fields we can fill):
 *
 *   [process-memory] trigger=interval tree_rss_sum=1432MB(electron-only)
 *     electron(9)=1432MB children=unavailable(not-enumerated)
 *     top=[Tab:41234:668MB …×5] sys_free=3124MB/32768MB [sys_free_raw=1880MB]
 *
 * Field-by-field honesty:
 * - `tree_rss_sum`: sum of every `app.getAppMetrics()` entry. The
 *   `(electron-only)` marker is CC's own suffix for "children were not
 *   enumerated" — ours never are: the `wave --stdio` node children are not
 *   Electron processes, so there is no API that lists them and we refuse to
 *   shell out to `tasklist`/`ps` to fake it.
 * - `children=unavailable(not-enumerated)`: CC's phrasing for exactly this.
 * - `top=`: Electron's own `ProcessMetric.type` verbatim (`Browser` / `Tab` /
 *   `GPU` / `Utility`), top 5 by working set — no invented categories.
 * - `sys_free`: `<available>/<total>`. On Linux `available` is `MemAvailable`
 *   (that is CC's `systemAvailableBytes`); elsewhere `os.freemem()`.
 * - `sys_free_raw`: only where a *distinct* raw-free figure exists — i.e. Linux
 *   `/proc/meminfo` `MemFree`. On Windows/macOS we omit the field rather than
 *   print the same number under a second name (CC only has the split on Linux
 *   too: it reads `/proc/meminfo` there).
 * - `messages=` / `blocks=` trailer: **ours, not CC's.** Spec
 *   `desktop-crash-recovery.md` 验收场景 3 requires the memory reading to carry
 *   the conversation volume so a MB number can be read as "driven by session
 *   length?"; it rides on the same line so one reading still answers both.
 *
 * Silence policy: a snapshot is *always* taken and always updates `lastLine()`
 * (the crash log reads it, whatever the level), but it is only **written** to
 * desktop.log when our own tree crosses a share-of-installed-RAM bucket
 * (CC's `[100,110,125,150]`%) and that bucket has not been written in the last
 * 30 minutes. A per-minute line in the log was pure noise once the display-side
 * rewrite landed — but "never write anything" is what left us with no curve at
 * all, so the bucket is the middle ground CC picked.
 */

import * as fs from "fs";
import * as os from "os";
import { app } from "electron";
import { hostLog } from "./hostLog";

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
/** ±5s jitter, so instances started together do not sample in lockstep (CC: `mYa=5e3`). */
export const MEMORY_SAMPLE_JITTER_MS = 5_000;
/** A freeze may fire `unresponsive` repeatedly; one extra snapshot per 10s (CC: `hYa=1e4`). */
export const STALL_SNAPSHOT_THROTTLE_MS = 10_000;
/** Our own tree as a share of installed RAM, the only buckets CC logs on (`eYa`). */
export const PROCESS_MEMORY_BUCKETS_PCT = [100, 110, 125, 150] as const;
/** One write per bucket per 30 minutes (CC: `SYa=18e5`). */
export const PROCESS_MEMORY_LOG_DEDUPE_MS = 30 * 60_000;

const BYTES_PER_MB = 1024 * 1024;

/** `interval` is the timer; `stall` is a freeze-triggered extra reading. */
export type MemoryTrigger = "interval" | "stall";

export type MemoryLog = {
  warn: (...args: unknown[]) => void;
  block: (level: "WARN", lines: string[]) => void;
};

/** One `app.getAppMetrics()` entry, in the units the log line prints. */
export type ProcessSample = {
  pid: number;
  /** Electron's own type, kept verbatim — `Browser` / `Tab` / `GPU` / `Utility`. */
  type: string;
  rssMb: number;
  /**
   * Electron's `creationTime` (ms since epoch). The pid alone is not an
   * identity: it is reused after a process dies, and this app runs for days.
   */
  creationTime?: number;
};

/**
 * What the OS says about memory. `rawFreeBytes` stays undefined unless the
 * platform has a figure that is genuinely distinct from `availableBytes`.
 */
export type SystemMemoryReading = {
  availableBytes: number;
  totalBytes: number;
  rawFreeBytes?: number;
};

/**
 * Conversation volume a pane is holding in the renderer. `tokens` is the CLI's
 * latest context usage for that session: the API context folds on compaction,
 * so `tokens` staying bounded while `messages`/`blocks` climb is exactly the
 * "display stream unbounded" signature.
 */
export type SessionMessageStat = {
  paneId: string;
  sessionId?: string;
  messages: number;
  blocks: number;
  tokens?: number;
};

export type MessageStats = { messages: number; blocks: number };

export type ProcessMemorySnapshot = {
  trigger: MemoryTrigger;
  /** Sum of every Electron process — children are never included. */
  treeRssMb: number;
  electronCount: number;
  /** Our own tree as a share of installed RAM; `undefined` if total is 0. */
  treePctOfRam?: number;
  top: readonly ProcessSample[];
  system: SystemMemoryReading;
};

export type MemorySampler = {
  start: () => void;
  stop: () => void;
  /**
   * Take one extra snapshot now (freeze-triggered), throttled to
   * `STALL_SNAPSHOT_THROTTLE_MS`.
   */
  snapshotOnStall: () => void;
  /** Last reading, formatted; used by the crash log to correlate size ↔ crash. */
  lastLine: () => string | undefined;
};

/** KB → MB with one decimal: sub-MB precision is noise, 3-digit MB is not. */
export function kbToMb(kb: number): number {
  return Math.round((kb / 1024) * 10) / 10;
}

function bytesToMb(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MB);
}

/**
 * Every Electron process, unfiltered: the incident was about the *tree* next to
 * a starved system, and a renderer-only reading cannot say whether the main
 * process or a utility process was the one growing.
 */
export function processMemorySamples(
  metrics: readonly Electron.ProcessMetric[],
): ProcessSample[] {
  return metrics.map((metric) => ({
    pid: metric.pid,
    type: String(metric.type),
    rssMb: kbToMb(metric.memory.workingSetSize),
    creationTime: metric.creationTime,
  }));
}

/** Top N by working set, stable enough for a log line (`N` = 5, as CC). */
export function topProcesses(
  samples: readonly ProcessSample[],
  count = 5,
): ProcessSample[] {
  return [...samples].sort((a, b) => b.rssMb - a.rssMb).slice(0, count);
}

export function buildProcessMemorySnapshot(
  samples: readonly ProcessSample[],
  system: SystemMemoryReading,
  trigger: MemoryTrigger,
): ProcessMemorySnapshot {
  const treeRssMb =
    Math.round(samples.reduce((sum, sample) => sum + sample.rssMb, 0) * 10) /
    10;
  return {
    trigger,
    treeRssMb,
    electronCount: samples.length,
    treePctOfRam:
      system.totalBytes > 0
        ? Math.round((treeRssMb * BYTES_PER_MB * 100) / system.totalBytes)
        : undefined,
    top: topProcesses(samples),
    system,
  };
}

export function formatSessionLine(stat: SessionMessageStat): string {
  return [
    "session messages",
    `pane=${stat.paneId}`,
    ...(stat.sessionId ? [`session=${stat.sessionId}`] : []),
    `messages=${stat.messages}`,
    `blocks=${stat.blocks}`,
    ...(stat.tokens === undefined ? [] : [`tokens=${stat.tokens}`]),
  ].join(" ");
}

export function totalMessageStats(
  stats: readonly SessionMessageStat[],
): MessageStats | undefined {
  if (stats.length === 0) return undefined;
  return stats.reduce(
    (sum, stat) => ({
      messages: sum.messages + stat.messages,
      blocks: sum.blocks + stat.blocks,
    }),
    { messages: 0, blocks: 0 },
  );
}

/**
 * The `[process-memory] …` line. Field order mirrors CC's so the two are
 * comparable line by line; our `messages`/`blocks` trailer comes last because
 * nothing in CC's line depends on it.
 */
export function formatProcessMemoryLine(
  snapshot: ProcessMemorySnapshot,
  totals?: MessageStats,
): string {
  const top = snapshot.top
    .map((sample) => `${sample.type}:${sample.pid}:${sample.rssMb}MB`)
    .join(" ");
  const { system } = snapshot;
  return [
    "[process-memory]",
    `trigger=${snapshot.trigger}`,
    `tree_rss_sum=${snapshot.treeRssMb}MB(electron-only)`,
    `electron(${snapshot.electronCount})=${snapshot.treeRssMb}MB`,
    "children=unavailable(not-enumerated)",
    `top=[${top}]`,
    `sys_free=${bytesToMb(system.availableBytes)}MB/${bytesToMb(system.totalBytes)}MB`,
    ...(system.rawFreeBytes === undefined
      ? []
      : [`sys_free_raw=${bytesToMb(system.rawFreeBytes)}MB`]),
    ...(totals === undefined
      ? []
      : [`messages=${totals.messages}`, `blocks=${totals.blocks}`]),
  ].join(" ");
}

/** `/proc/meminfo` → bytes; `MemAvailable` is "usable", `MemFree` is "raw". */
export function parseLinuxMeminfo(
  text: string,
): { availableBytes: number; rawFreeBytes?: number } | undefined {
  let memAvailableKb: number | undefined;
  let memFreeKb: number | undefined;
  for (const line of text.split("\n")) {
    const [name, rest] = line.split(":");
    if (!rest) continue;
    const kb = Number.parseInt(rest.trim(), 10);
    if (!Number.isFinite(kb)) continue;
    if (name === "MemAvailable") memAvailableKb = kb;
    else if (name === "MemFree") memFreeKb = kb;
  }
  const availableKb = memAvailableKb ?? memFreeKb;
  if (availableKb === undefined) return undefined;
  return {
    availableBytes: availableKb * 1024,
    // `rawFreeBytes` only when there are two *different* figures: falling back to
    // `MemFree` for `availableBytes` and printing it again as "raw" would invent
    // a distinction this kernel does not offer.
    ...(memAvailableKb === undefined || memFreeKb === undefined
      ? {}
      : { rawFreeBytes: memFreeKb * 1024 }),
  };
}

function readLinuxMeminfo():
  | { availableBytes: number; rawFreeBytes?: number }
  | undefined {
  try {
    return parseLinuxMeminfo(fs.readFileSync("/proc/meminfo", "utf8"));
  } catch {
    // No warning: the line itself says what happened — `sys_free_raw` disappears
    // when we could not read it, which is the honest signal (CC prints its own
    // `[linuxAvailableMemory]` warning for the same condition).
    return undefined;
  }
}

/**
 * Linux: `MemAvailable` + `MemFree`, because `os.freemem()` there is `MemFree`
 * and understates what can still be allocated (page cache counts as free in
 * practice). Windows/macOS: `os.freemem()`, and no raw field — we have no second,
 * genuinely different figure to print.
 */
export function readSystemMemory(): SystemMemoryReading {
  const totalBytes = os.totalmem();
  if (process.platform === "linux") {
    const meminfo = readLinuxMeminfo();
    if (meminfo) return { totalBytes, ...meminfo };
  }
  return { totalBytes, availableBytes: os.freemem() };
}

/** Highest bucket `pct` reaches, or undefined below the first one. */
export function highestBucketPct(pct: number | undefined): number | undefined {
  if (pct === undefined) return undefined;
  let reached: number | undefined;
  for (const bucket of PROCESS_MEMORY_BUCKETS_PCT) {
    if (pct >= bucket) reached = bucket;
  }
  return reached;
}

export function createMemorySampler(
  options: {
    intervalMs?: number;
    jitterMs?: number;
    log?: MemoryLog;
    getMetrics?: () => readonly Electron.ProcessMetric[];
    /**
     * Message volume per pane *as reported by the renderer*. Kept as an
     * injected getter so this module stays free of host/agent wiring and is
     * testable with plain data.
     */
    getMessageStats?: () => readonly SessionMessageStat[];
    getSystemMemory?: () => SystemMemoryReading;
    now?: () => number;
  } = {},
): MemorySampler {
  const {
    intervalMs = MEMORY_SAMPLE_INTERVAL_MS,
    jitterMs = MEMORY_SAMPLE_JITTER_MS,
    log = hostLog,
    getMetrics = () => app.getAppMetrics(),
    getMessageStats = () => [],
    getSystemMemory = readSystemMemory,
    now = () => Date.now(),
  } = options;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | undefined;
  let lastStallAt = Number.NEGATIVE_INFINITY;
  /** Bucket → when it was last written; one write per bucket per 30min. */
  const bucketWrittenAt = new Map<number, number>();
  /** `<type>:<pid>` → creationTime of the process that held it last sample. */
  let creationByKey = new Map<string, number>();
  const reuseReported = new Set<string>();

  /**
   * Same pid, different creation time = the process died and the OS handed the
   * pid to someone else. Only worth a line once: the reading is a point-in-time
   * snapshot with no per-pid history to invalidate, so this is evidence about
   * the environment ("something is being respawned under us"), not a correction.
   */
  const reportReusedPids = (samples: readonly ProcessSample[]): void => {
    const next = new Map<string, number>();
    for (const sample of samples) {
      if (typeof sample.creationTime !== "number") continue;
      const key = `${sample.type}:${sample.pid}`;
      const previous = creationByKey.get(key);
      if (
        previous !== undefined &&
        previous !== sample.creationTime &&
        !reuseReported.has(key)
      ) {
        reuseReported.add(key);
        log.warn(
          `[process-memory] pid ${sample.pid} (${sample.type}) now names another process; its readings are not carried across samples`,
        );
      }
      next.set(key, sample.creationTime);
    }
    creationByKey = next;
  };

  const readMessageStats = (): readonly SessionMessageStat[] => {
    try {
      return getMessageStats();
    } catch (error) {
      // A memory reading without counts still beats no reading at all.
      log.warn("[desktop] message volume sample failed:", error);
      return [];
    }
  };

  const capture = (trigger: MemoryTrigger): void => {
    let samples: ProcessSample[];
    let system: SystemMemoryReading;
    try {
      samples = processMemorySamples(getMetrics());
      // Before the window's renderer exists there is no `Tab` entry and nothing
      // worth recording; keeping the previous reading beats inventing a curve
      // for a window that has never rendered (spec 验收场景 5).
      if (!samples.some((sample) => sample.type === "Tab")) return;
      system = getSystemMemory();
    } catch (error) {
      // A failed reading is an event: say so, once, and keep the timer chain.
      log.warn("[process-memory] snapshot failed:", error);
      return;
    }

    reportReusedPids(samples);

    const snapshot = buildProcessMemorySnapshot(samples, system, trigger);
    const stats = readMessageStats();
    const lines = [
      formatProcessMemoryLine(snapshot, totalMessageStats(stats)),
      ...stats.map(formatSessionLine),
    ];
    // Always refresh: the crash path reads this even at levels we never log.
    last = lines.join("; ");

    const bucket = highestBucketPct(snapshot.treePctOfRam);
    if (bucket === undefined) return;
    const at = now();
    const writtenAt = bucketWrittenAt.get(bucket) ?? Number.NEGATIVE_INFINITY;
    if (at - writtenAt < PROCESS_MEMORY_LOG_DEDUPE_MS) return;
    bucketWrittenAt.set(bucket, at);
    log.block("WARN", lines);
  };

  const scheduleNext = (): void => {
    const jitter = Math.round((Math.random() * 2 - 1) * jitterMs);
    timer = setTimeout(
      () => {
        timer = undefined;
        capture("interval");
        scheduleNext();
      },
      Math.max(0, intervalMs + jitter),
    );
    // unref: a pending reading must never hold the process open.
    timer.unref?.();
  };

  return {
    start: () => {
      if (timer) return;
      // First reading immediately: with a 60s interval, a crash inside the
      // first minute would otherwise have no memory evidence at all.
      capture("interval");
      scheduleNext();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    snapshotOnStall: () => {
      const at = now();
      if (at - lastStallAt < STALL_SNAPSHOT_THROTTLE_MS) return;
      lastStallAt = at;
      capture("stall");
    },
    lastLine: () => last,
  };
}
