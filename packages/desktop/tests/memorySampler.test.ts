import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "electron";
import {
  buildProcessMemorySnapshot,
  createMemorySampler,
  formatProcessMemoryLine,
  formatSessionLine,
  highestBucketPct,
  kbToMb,
  parseLinuxMeminfo,
  processMemorySamples,
  MEMORY_SAMPLE_INTERVAL_MS,
  PROCESS_MEMORY_LOG_DEDUPE_MS,
  STALL_SNAPSHOT_THROTTLE_MS,
  type SessionMessageStat,
  type SystemMemoryReading,
} from "../src/main/memorySampler.js";

const MB = 1024 * 1024;

const processMetric = (
  type: Electron.ProcessMetric["type"],
  pid: number,
  workingSetSize: number,
  creationTime = 1_000,
): Electron.ProcessMetric =>
  ({
    type,
    pid,
    creationTime,
    memory: { workingSetSize, peakWorkingSetSize: workingSetSize },
  }) as unknown as Electron.ProcessMetric;

const systemMemory = (
  availableMb: number,
  totalMb: number,
  rawFreeMb?: number,
): SystemMemoryReading => ({
  availableBytes: availableMb * MB,
  totalBytes: totalMb * MB,
  ...(rawFreeMb === undefined ? {} : { rawFreeBytes: rawFreeMb * MB }),
});

const paneStat = (
  paneId: string,
  messages: number,
  blocks: number,
  extra: Partial<SessionMessageStat> = {},
): SessionMessageStat => ({ paneId, messages, blocks, ...extra });

/** ±0s jitter: every timer test would otherwise depend on Math.random(). */
const fixedJitter = (random = 0.5) =>
  vi.spyOn(Math, "random").mockReturnValue(random);

describe("memorySampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("converts Electron's KB to MB with one decimal", () => {
    expect(kbToMb(1024)).toBe(1);
    expect(kbToMb(1024 * 512)).toBe(512);
    expect(kbToMb(1024 * 1.55)).toBe(1.6);
    expect(kbToMb(0)).toBe(0);
  });

  it("keeps every Electron process type, verbatim", () => {
    expect(
      processMemorySamples([
        processMetric("Tab", 111, 1024 * 300),
        processMetric("Browser", 222, 1024 * 100),
        processMetric("GPU", 333, 1024 * 50),
        processMetric("Utility", 444, 1024 * 20),
      ]),
    ).toEqual([
      { pid: 111, type: "Tab", rssMb: 300, creationTime: 1_000 },
      { pid: 222, type: "Browser", rssMb: 100, creationTime: 1_000 },
      { pid: 333, type: "GPU", rssMb: 50, creationTime: 1_000 },
      { pid: 444, type: "Utility", rssMb: 20, creationTime: 1_000 },
    ]);
  });

  it("formats the CC [process-memory] line with the fields we can fill", () => {
    const samples = processMemorySamples([
      processMetric("Tab", 11, 1024 * 600),
      processMetric("Browser", 22, 1024 * 300),
      processMetric("GPU", 33, 1024 * 100),
    ]);
    expect(
      formatProcessMemoryLine(
        buildProcessMemorySnapshot(
          samples,
          systemMemory(8192, 32768, 4096),
          "interval",
        ),
      ),
    ).toBe(
      "[process-memory] trigger=interval tree_rss_sum=1000MB(electron-only) electron(3)=1000MB children=unavailable(not-enumerated) top=[Tab:11:600MB Browser:22:300MB GPU:33:100MB] sys_free=8192MB/32768MB sys_free_raw=4096MB",
    );
  });

  it("omits sys_free_raw where the platform has no distinct raw free figure", () => {
    const line = formatProcessMemoryLine(
      buildProcessMemorySnapshot(
        processMemorySamples([processMetric("Tab", 11, 1024 * 600)]),
        systemMemory(8192, 32768),
        "interval",
      ),
    );

    // Printing os.freemem() twice under two names would fake a distinction the
    // platform does not have.
    expect(line).not.toContain("sys_free_raw");
    expect(line).toContain("sys_free=8192MB/32768MB");
  });

  it("keeps only the top five processes by working set", () => {
    const samples = processMemorySamples(
      [700, 600, 500, 400, 300, 200, 100].map((mb, index) =>
        processMetric("Tab", 100 + index, 1024 * mb),
      ),
    );

    expect(
      buildProcessMemorySnapshot(samples, systemMemory(1, 1000), "interval")
        .top,
    ).toEqual([
      { pid: 100, type: "Tab", rssMb: 700, creationTime: 1_000 },
      { pid: 101, type: "Tab", rssMb: 600, creationTime: 1_000 },
      { pid: 102, type: "Tab", rssMb: 500, creationTime: 1_000 },
      { pid: 103, type: "Tab", rssMb: 400, creationTime: 1_000 },
      { pid: 104, type: "Tab", rssMb: 300, creationTime: 1_000 },
    ]);
  });

  it("parses /proc/meminfo into usable vs raw free", () => {
    expect(
      parseLinuxMeminfo(
        [
          "MemTotal:       32768 kB",
          "MemFree:         1880 kB",
          "MemAvailable:    3124 kB",
          "",
        ].join("\n"),
      ),
    ).toEqual({ availableBytes: 3124 * 1024, rawFreeBytes: 1880 * 1024 });

    // MemAvailable missing (old kernels): raw is all we have, and we do not
    // pretend it is the available figure.
    expect(parseLinuxMeminfo("MemFree: 1880 kB\n")).toEqual({
      availableBytes: 1880 * 1024,
    });
    expect(parseLinuxMeminfo("MemTotal: 1 kB\n")).toBeUndefined();
  });

  it("buckets our own tree against installed RAM", () => {
    expect(highestBucketPct(undefined)).toBeUndefined();
    expect(highestBucketPct(4)).toBeUndefined();
    expect(highestBucketPct(100)).toBe(100);
    expect(highestBucketPct(109)).toBe(100);
    expect(highestBucketPct(117)).toBe(110);
    expect(highestBucketPct(130)).toBe(125);
    expect(highestBucketPct(400)).toBe(150);
  });

  it("samples immediately, then every interval, and stops on demand", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const getMetrics = vi.fn(() => [processMetric("Tab", 111, 1024 * 300)]);
    const sampler = createMemorySampler({
      log,
      getMetrics,
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    // First reading right away: a crash in the first minute must still have a
    // memory number next to it.
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(sampler.lastLine()).toBe(
      "[process-memory] trigger=interval tree_rss_sum=300MB(electron-only) electron(1)=300MB children=unavailable(not-enumerated) top=[Tab:111:300MB] sys_free=8192MB/32768MB",
    );

    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(getMetrics).toHaveBeenCalledTimes(2);

    sampler.stop();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
    expect(getMetrics).toHaveBeenCalledTimes(2);
  });

  it("jitters the interval by up to ±5s", () => {
    fixedJitter(0); // -5000ms
    const getMetrics = vi.fn(() => [processMetric("Tab", 111, 1024)]);
    const sampler = createMemorySampler({
      log: { warn: vi.fn(), block: vi.fn() },
      getMetrics,
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS - 5_001);
    expect(getMetrics).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(getMetrics).toHaveBeenCalledTimes(2);
    sampler.stop();

    fixedJitter(1); // +5000ms
    const later = vi.fn(() => [processMetric("Tab", 222, 1024)]);
    const slow = createMemorySampler({
      log: { warn: vi.fn(), block: vi.fn() },
      getMetrics: later,
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    slow.start();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(later).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(later).toHaveBeenCalledTimes(2);
    slow.stop();
  });

  it("takes a stall snapshot at most once per 10s", () => {
    const log = { warn: vi.fn(), block: vi.fn() };
    const getMetrics = vi.fn(() => [processMetric("Tab", 111, 1024 * 300)]);
    const sampler = createMemorySampler({
      log,
      getMetrics,
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.snapshotOnStall();
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(sampler.lastLine()).toContain("trigger=stall");

    // A freeze emits `unresponsive` repeatedly; the extra readings would all
    // carry the same numbers.
    sampler.snapshotOnStall();
    vi.advanceTimersByTime(STALL_SNAPSHOT_THROTTLE_MS - 1);
    sampler.snapshotOnStall();
    expect(getMetrics).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    sampler.snapshotOnStall();
    expect(getMetrics).toHaveBeenCalledTimes(2);
  });

  it("writes a line once our own tree crosses a bucket, then stays quiet for 30min", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const sampler = createMemorySampler({
      log,
      // 1200MB of Electron against a 1024MB machine: 117% → bucket 110.
      getMetrics: () => [processMetric("Tab", 111, 1024 * 1200)],
      getSystemMemory: () => systemMemory(64, 1024),
    });

    sampler.start();
    expect(log.block).toHaveBeenCalledTimes(1);
    expect(log.block.mock.calls[0][0]).toBe("WARN");
    expect(log.block.mock.calls[0][1][0]).toContain(
      "[process-memory] trigger=interval",
    );

    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 10);
    expect(log.block).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PROCESS_MEMORY_LOG_DEDUPE_MS);
    expect(log.block).toHaveBeenCalledTimes(2);
    sampler.stop();
  });

  it("stays silent at normal levels but still refreshes lastLine", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const sampler = createMemorySampler({
      log,
      // 700MB of a 32GB machine: nowhere near CC's first bucket (100%).
      getMetrics: () => [processMetric("Tab", 999, 1024 * 700)],
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
    sampler.stop();

    // A per-minute line in desktop.log is noise; the curve stays in `lastLine()`
    // (the crash path) unless we ourselves approach RAM.
    expect(log.block).not.toHaveBeenCalled();
    expect(sampler.lastLine()).toContain("tree_rss_sum=700MB(electron-only)");
  });

  it("keeps no reading when there is no renderer process yet", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Browser", 222, 1024)],
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    sampler.stop();

    // Only the Browser process exists → nothing worth correlating with a crash.
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.block).not.toHaveBeenCalled();
    expect(sampler.lastLine()).toBeUndefined();
  });

  it("reads the real app metrics by default", () => {
    fixedJitter();
    vi.mocked(app.getAppMetrics).mockReturnValue([
      processMetric("Tab", 999, 1024 * 700),
    ]);
    const log = { warn: vi.fn(), block: vi.fn() };

    const sampler = createMemorySampler({
      log,
      getSystemMemory: () => systemMemory(8192, 32768),
    });
    sampler.start();
    sampler.stop();

    expect(app.getAppMetrics).toHaveBeenCalled();
    expect(sampler.lastLine()).toContain("top=[Tab:999:700MB]");
  });

  it("writes a line when the snapshot itself fails, and keeps the timer chain", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const getMetrics = vi.fn(() => {
      throw new Error("metrics unavailable");
    });
    const sampler = createMemorySampler({
      log,
      getMetrics,
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);

    // A failed reading is an event: the evidence chain must not go silent.
    expect(log.warn).toHaveBeenCalledWith(
      "[process-memory] snapshot failed:",
      expect.any(Error),
    );
    expect(getMetrics).toHaveBeenCalledTimes(2);
    sampler.stop();
  });

  it("carries the message volume on the memory line", () => {
    fixedJitter();
    const getMetrics = vi.fn(() => [processMetric("Tab", 111, 1024 * 2048)]);
    const sampler = createMemorySampler({
      log: { warn: vi.fn(), block: vi.fn() },
      getMetrics,
      getSystemMemory: () => systemMemory(8192, 32768),
      getMessageStats: () => [
        paneStat("pane-1", 1842, 9310, { sessionId: "s1", tokens: 152000 }),
        paneStat("pane-2", 500, 2800, { sessionId: "s2", tokens: 98000 }),
      ],
    });

    sampler.start();
    sampler.stop();

    // The crash log's lastMemory must carry the memory ↔ volume correlation.
    expect(sampler.lastLine()).toBe(
      [
        "[process-memory] trigger=interval tree_rss_sum=2048MB(electron-only) electron(1)=2048MB children=unavailable(not-enumerated) top=[Tab:111:2048MB] sys_free=8192MB/32768MB messages=2342 blocks=12110",
        "session messages pane=pane-1 session=s1 messages=1842 blocks=9310 tokens=152000",
        "session messages pane=pane-2 session=s2 messages=500 blocks=2800 tokens=98000",
      ].join("; "),
    );
  });

  it("omits counts when no pane is bound yet", () => {
    expect(
      formatProcessMemoryLine(
        buildProcessMemorySnapshot(
          processMemorySamples([processMetric("Tab", 1, 1024 * 10)]),
          systemMemory(8192, 32768),
          "interval",
        ),
      ),
    ).not.toContain("messages=");
  });

  it("keeps the memory reading when the volume getter throws", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Tab", 111, 1024)],
      getSystemMemory: () => systemMemory(8192, 32768),
      getMessageStats: () => {
        throw new Error("host disposed");
      },
    });

    sampler.start();
    sampler.stop();

    expect(log.warn).toHaveBeenCalledWith(
      "[desktop] message volume sample failed:",
      expect.any(Error),
    );
    expect(sampler.lastLine()).toContain("tree_rss_sum=1MB(electron-only)");
  });

  it("reports a pid that now names another process exactly once", () => {
    fixedJitter();
    const log = { warn: vi.fn(), block: vi.fn() };
    let creationTime = 1_000;
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Tab", 111, 1024, creationTime)],
      getSystemMemory: () => systemMemory(8192, 32768),
    });

    sampler.start();
    // Same pid, new creation time: the renderer died and the OS reused the pid.
    creationTime = 2_000;
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);

    const reuseWarnings = log.warn.mock.calls.filter(
      ([message]) =>
        typeof message === "string" &&
        message.includes("now names another process"),
    );
    expect(reuseWarnings).toEqual([
      [
        "[process-memory] pid 111 (Tab) now names another process; its readings are not carried across samples",
      ],
    ]);
    sampler.stop();
  });

  it("formats per-pane lines the same way as before", () => {
    expect(
      formatSessionLine(paneStat("pane-1", 5, 9, { sessionId: "s1" })),
    ).toBe("session messages pane=pane-1 session=s1 messages=5 blocks=9");
  });
});
