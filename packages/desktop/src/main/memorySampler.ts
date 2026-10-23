/**
 * Periodic renderer-memory reading from `app.getAppMetrics()`, correlated with
 * how much conversation the renderer is holding.
 *
 * Why: the black-screen incident *might* be the V8 heap giving up under the
 * full message history (the crash stack is a GC write-barrier stall). A single
 * snapshot cannot prove or exclude that — what we need is a curve: does the
 * renderer's working set climb for hours before the crash?
 *
 * A MB number alone does not name a cause, so every reading carries the
 * message volume next to it. Two things can make that count grow: the agent's
 * own list grows until the next compaction folds it, and the renderer's copy
 * only ever grows — compaction appends a summary block and never replaces the
 * table on screen, so one long-running session accumulates messages there even
 * after the fold. Memory rising *with* message count is evidence for that
 * candidate; memory flat while messages grow is evidence against it.
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

/**
 * Volume held by conversations no pane displays. Their message copies are
 * exactly what the host drops when they go off-screen (spec
 * ui/message-rendering-system.md「宿主只留下被 pane 显示的会话副本」), so this
 * sits next to the renderer curve as the "残留还有多少" reading — it is NOT part
 * of the renderer's heap and must never be added to the per-pane totals.
 */
export type OffscreenVolume = {
  sessions: number;
  messages: number;
  blocks: number;
};

/**
 * The minimum a message must expose to be counted. Deliberately structural:
 * the desktop package may only import `wave-agent-sdk/host`, and a counter needs
 * nothing beyond "how many, and how many blocks each" — so a real
 * `wave-agent-sdk` `Message` fits without dragging the SDK's bulk into this
 * file's imports.
 */
export type CountableMessage = { blocks?: readonly unknown[] };

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

/**
 * One assistant turn can carry dozens of blocks (text + every tool call/output
 * in full), so the block total is the sharper growth signal of the two. Blocks
 * are read defensively: the list is a JSON-RPC mirror, and a missing array must
 * not take the whole sample down.
 */
export function countMessageStats(
  messages: readonly CountableMessage[],
): MessageStats {
  let blocks = 0;
  for (const message of messages) {
    blocks += Array.isArray(message.blocks) ? message.blocks.length : 0;
  }
  return { messages: messages.length, blocks };
}

export function formatMemoryLine(sample: RendererMemory): string {
  return `renderer memory pid=${sample.pid} workingSet=${sample.workingSetMb}MB peak=${sample.peakWorkingSetMb}MB`;
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

/**
 * One log entry per sample: memory lines carry the pane totals (= what a single
 * "is the heap driven by conversation length?" read needs), then one line per
 * pane attributes the volume when several panes are open.
 */
export function formatMemoryBlock(
  samples: readonly RendererMemory[],
  stats: readonly SessionMessageStat[] = [],
  offscreen?: OffscreenVolume,
): string[] {
  const totals = stats.reduce(
    (sum, stat) => ({
      messages: sum.messages + stat.messages,
      blocks: sum.blocks + stat.blocks,
    }),
    { messages: 0, blocks: 0 },
  );
  // Off-screen conversations are reported separately and only when there are
  // some: they never reach the renderer, and folding them into the pane totals
  // would make the curve answer "is the heap driven by conversation length?"
  // with a number the heap never held.
  const extra = [
    ...(stats.length === 0
      ? []
      : [`messages=${totals.messages}`, `blocks=${totals.blocks}`]),
    ...(offscreen && offscreen.sessions > 0
      ? [
          `offscreenSessions=${offscreen.sessions}`,
          `offscreenMessages=${offscreen.messages}`,
        ]
      : []),
  ];
  return [
    ...samples.map((sample) =>
      extra.length === 0
        ? formatMemoryLine(sample)
        : `${formatMemoryLine(sample)} ${extra.join(" ")}`,
    ),
    ...stats.map(formatSessionLine),
  ];
}

export function createMemorySampler(
  options: {
    intervalMs?: number;
    log?: MemoryLog;
    getMetrics?: () => readonly Electron.ProcessMetric[];
    /**
     * Message volume per pane, owned by the desktop host (it holds the agent
     * cache the renderer was seeded from). Kept as an injected getter so this
     * module stays free of host/agent wiring and is testable with plain data.
     */
    getMessageStats?: () => readonly SessionMessageStat[];
    /**
     * Volume held by conversations no pane displays (the copies the host drops
     * when they leave the screen). Reported on the memory line, never merged
     * into the per-pane totals.
     */
    getOffscreenVolume?: () => OffscreenVolume;
  } = {},
): MemorySampler {
  const {
    intervalMs = MEMORY_SAMPLE_INTERVAL_MS,
    log = hostLog,
    getMetrics = () => app.getAppMetrics(),
    getMessageStats = () => [],
    getOffscreenVolume,
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
    let stats: readonly SessionMessageStat[] = [];
    try {
      stats = getMessageStats();
    } catch (error) {
      // A memory reading without counts still beats no reading at all.
      log.warn("[desktop] message volume sample failed:", error);
    }
    let offscreen: OffscreenVolume | undefined;
    try {
      offscreen = getOffscreenVolume?.();
    } catch (error) {
      log.warn("[desktop] off-screen volume sample failed:", error);
    }
    const lines = formatMemoryBlock(samples, stats, offscreen);
    log.block("INFO", lines);
    last = lines.join("; ");
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
