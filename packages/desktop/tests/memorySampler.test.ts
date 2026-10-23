import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "electron";
import type { Message } from "wave-agent-sdk/types";
import {
  createMemorySampler,
  countMessageStats,
  formatMemoryBlock,
  kbToMb,
  rendererMemoryFromMetrics,
  MEMORY_SAMPLE_INTERVAL_MS,
  type SessionMessageStat,
} from "../src/main/memorySampler.js";

const processMetric = (
  type: Electron.ProcessMetric["type"],
  pid: number,
  workingSetSize: number,
  peakWorkingSetSize: number,
): Electron.ProcessMetric =>
  ({
    type,
    pid,
    memory: { workingSetSize, peakWorkingSetSize },
  }) as unknown as Electron.ProcessMetric;

const message = (id: string, blocks: number): Message =>
  ({
    id,
    role: "assistant",
    timestamp: "2026-10-22T00:00:00.000Z",
    blocks: Array.from({ length: blocks }, () => ({
      type: "text",
      content: "x",
    })),
  }) as unknown as Message;

const paneStat = (
  paneId: string,
  messages: number,
  blocks: number,
  extra: Partial<SessionMessageStat> = {},
): SessionMessageStat => ({ paneId, messages, blocks, ...extra });

describe("memorySampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts Electron's KB to MB with one decimal", () => {
    expect(kbToMb(1024)).toBe(1);
    expect(kbToMb(1024 * 512)).toBe(512);
    expect(kbToMb(1024 * 1.55)).toBe(1.6);
    expect(kbToMb(0)).toBe(0);
  });

  it("keeps only renderer (Tab) processes", () => {
    const samples = rendererMemoryFromMetrics([
      processMetric("Tab", 111, 1024 * 300, 1024 * 400),
      processMetric("Browser", 222, 1024 * 100, 1024 * 120),
      processMetric("GPU", 333, 1024 * 50, 1024 * 60),
      processMetric("Tab", 444, 1024 * 900, 1024 * 950),
    ]);

    expect(samples).toEqual([
      { pid: 111, workingSetMb: 300, peakWorkingSetMb: 400 },
      { pid: 444, workingSetMb: 900, peakWorkingSetMb: 950 },
    ]);
  });

  it("samples immediately, then every interval, and stops on demand", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const getMetrics = vi.fn(() => [
      processMetric("Tab", 111, 1024 * 300, 1024 * 512),
    ]);
    const sampler = createMemorySampler({ log, getMetrics });

    sampler.start();
    // First reading right away: a crash in the first minute must still have a
    // memory number next to it.
    expect(getMetrics).toHaveBeenCalledTimes(1);
    expect(log.block).toHaveBeenCalledTimes(1);
    expect(log.block.mock.calls[0][1]).toEqual([
      "renderer memory pid=111 workingSet=300MB peak=512MB",
    ]);
    expect(sampler.lastLine()).toBe(
      "renderer memory pid=111 workingSet=300MB peak=512MB",
    );

    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
    expect(getMetrics).toHaveBeenCalledTimes(2);

    sampler.stop();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
    expect(getMetrics).toHaveBeenCalledTimes(2);
  });

  it("says nothing when there is no renderer process yet", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Browser", 222, 1024, 1024)],
    });

    sampler.start();
    sampler.stop();

    expect(log.block).not.toHaveBeenCalled();
    expect(sampler.lastLine()).toBeUndefined();
  });

  it("reads the real app metrics by default", () => {
    vi.mocked(app.getAppMetrics).mockReturnValue([
      processMetric("Tab", 999, 1024 * 700, 1024 * 800),
    ]);
    const log = { block: vi.fn(), warn: vi.fn() };

    createMemorySampler({ log }).start();

    expect(app.getAppMetrics).toHaveBeenCalled();
    expect(log.block.mock.calls[0][1]).toEqual([
      "renderer memory pid=999 workingSet=700MB peak=800MB",
    ]);
  });

  it("keeps running when getAppMetrics throws", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const getMetrics = vi.fn(() => {
      throw new Error("metrics unavailable");
    });
    const sampler = createMemorySampler({ log, getMetrics });

    sampler.start();
    vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);

    expect(log.warn).toHaveBeenCalledWith(
      "[desktop] renderer memory sample failed:",
      expect.any(Error),
    );
    // The timer chain survives a failed reading.
    expect(getMetrics).toHaveBeenCalledTimes(2);
    sampler.stop();
  });

  it("counts messages and every block inside them", () => {
    // A single assistant turn can carry dozens of blocks (one per tool call +
    // its full output) — the block total is the sharper growth signal.
    expect(
      countMessageStats([
        message("m1", 12),
        message("m2", 3),
        message("m3", 0),
      ]),
    ).toEqual({ messages: 3, blocks: 15 });
    expect(countMessageStats([])).toEqual({ messages: 0, blocks: 0 });
  });

  it("carries the message volume on the memory line", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Tab", 111, 1024 * 2048, 1024 * 4096)],
      getMessageStats: () => [
        paneStat("pane-1", 1842, 9310, { sessionId: "s1", tokens: 152000 }),
        paneStat("pane-2", 500, 2800, { sessionId: "s2", tokens: 98000 }),
      ],
    });

    sampler.start();
    sampler.stop();

    expect(log.block.mock.calls[0][1]).toEqual([
      "renderer memory pid=111 workingSet=2048MB peak=4096MB messages=2342 blocks=12110",
      "session messages pane=pane-1 session=s1 messages=1842 blocks=9310 tokens=152000",
      "session messages pane=pane-2 session=s2 messages=500 blocks=2800 tokens=98000",
    ]);
    // The crash log's lastMemory must carry the same correlation.
    expect(sampler.lastLine()).toContain("messages=2342 blocks=12110");
  });

  it("omits counts when no pane is bound yet", () => {
    expect(
      formatMemoryBlock([{ pid: 1, workingSetMb: 10, peakWorkingSetMb: 20 }]),
    ).toEqual(["renderer memory pid=1 workingSet=10MB peak=20MB"]);
  });

  it("reports off-screen conversations next to the pane totals, never inside them", () => {
    // 屏外副本永远到不了渲染进程：并进 messages= 就会让曲线回答
    // 「堆是不是随会话长度涨」时用一个堆里根本没有的数（spec
    // ui/message-rendering-system.md「宿主只留下被 pane 显示的会话副本」）。
    const lines = formatMemoryBlock(
      [{ pid: 1, workingSetMb: 10, peakWorkingSetMb: 20 }],
      [paneStat("pane-1", 20, 40)],
      { sessions: 3, messages: 0, blocks: 0 },
    );

    expect(lines).toEqual([
      "renderer memory pid=1 workingSet=10MB peak=20MB messages=20 blocks=40 offscreenSessions=3 offscreenMessages=0",
      "session messages pane=pane-1 messages=20 blocks=40",
    ]);
  });

  it("says nothing about off-screen conversations when there are none", () => {
    expect(
      formatMemoryBlock(
        [{ pid: 1, workingSetMb: 10, peakWorkingSetMb: 20 }],
        [paneStat("pane-1", 20, 40)],
        { sessions: 0, messages: 0, blocks: 0 },
      )[0],
    ).toBe(
      "renderer memory pid=1 workingSet=10MB peak=20MB messages=20 blocks=40",
    );
  });

  it("still logs the memory reading when the off-screen getter throws", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Tab", 111, 1024, 1024)],
      getOffscreenVolume: () => {
        throw new Error("host disposed");
      },
    });

    sampler.start();
    sampler.stop();

    expect(log.warn).toHaveBeenCalledWith(
      "[desktop] off-screen volume sample failed:",
      expect.any(Error),
    );
    expect(log.block.mock.calls[0][1]).toEqual([
      "renderer memory pid=111 workingSet=1MB peak=1MB",
    ]);
  });

  it("still logs the memory reading when the volume getter throws", () => {
    const log = { block: vi.fn(), warn: vi.fn() };
    const sampler = createMemorySampler({
      log,
      getMetrics: () => [processMetric("Tab", 111, 1024, 1024)],
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
    expect(log.block.mock.calls[0][1]).toEqual([
      "renderer memory pid=111 workingSet=1MB peak=1MB",
    ]);
  });
});
