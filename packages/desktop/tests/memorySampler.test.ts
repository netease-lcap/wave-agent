import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "electron";
import {
  createMemorySampler,
  kbToMb,
  rendererMemoryFromMetrics,
  MEMORY_SAMPLE_INTERVAL_MS,
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
});
