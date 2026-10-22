import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrowserWindow } from "electron";
import {
  createUnresponsiveSampler,
  formatSampleBlock,
  truncateStack,
  MAX_STACK_LINES,
  SAMPLE_INTERVAL_MS,
  SAMPLE_PERIOD_MS,
} from "../src/main/unresponsiveSampler.js";

type FakeWindow = {
  win: BrowserWindow;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
    isDevToolsOpened: ReturnType<typeof vi.fn>;
    getURL: ReturnType<typeof vi.fn>;
    mainFrame: { collectJavaScriptCallStack: ReturnType<typeof vi.fn> };
  };
  emit: (event: string) => void;
};

/**
 * Electron's BrowserWindow/WebContents are EventEmitters; the sampler only
 * touches `on`, `isDestroyed`, `webContents.*`, so a hand-rolled fake is enough
 * (and keeps the assertions on the log payloads, which is what matters).
 */
const createFakeWindow = (): FakeWindow => {
  const listeners = new Map<string, Array<() => void>>();
  const webContents = {
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    getURL: vi.fn(() => "file:///app/webview/index.html"),
    mainFrame: {
      collectJavaScriptCallStack: vi.fn(
        async () => "\n    at spin (chat.js:1:2)",
      ),
    },
  };
  const win = {
    isDestroyed: vi.fn(() => false),
    webContents,
    on: vi.fn((event: string, cb: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return win;
    }),
  };
  return {
    win: win as unknown as BrowserWindow,
    webContents,
    emit: (event: string) => {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
};

const createLog = () => ({
  block: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const blockText = (log: ReturnType<typeof createLog>, call = 0) =>
  (log.block.mock.calls[call][1] as string[]).join("\n");

describe("unresponsiveSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("samples every interval and counts identical stacks", async () => {
    const { win } = createFakeWindow();
    const log = createLog();
    const collect = vi.fn(async () => "\n    at spin (chat.js:1:2)");
    const sampler = createUnresponsiveSampler(win, {
      log,
      collect,
      currentUrl: () => "file:///app/webview/index.html",
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);

    expect(collect).toHaveBeenCalledTimes(3);

    sampler.stopAndFlush();

    expect(log.block).toHaveBeenCalledTimes(1);
    const text = blockText(log);
    // Leading newline trimmed, count prefix + top frame on one line.
    expect(text).toContain("<3> at spin (chat.js:1:2)");
    expect(text).toContain("window=main");
    expect(text).toContain("url=file:///app/webview/index.html");
    expect(text.trim().endsWith("Total Samples: 3")).toBe(true);
  });

  it("keeps the window name and the top stack separate when the stack changes", async () => {
    const { win } = createFakeWindow();
    const log = createLog();
    const stacks = [
      "at renderMessageList (chat.js:9:9)",
      "at renderMessageList (chat.js:9:9)",
      "at commitHookEffectList (chat.js:2:2)",
    ];
    let index = 0;
    const sampler = createUnresponsiveSampler(win, {
      windowName: "pane-1",
      log,
      collect: async () => stacks[index++],
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);
    sampler.stopAndFlush();

    const lines = log.block.mock.calls[0][1] as string[];
    // Sorted by count: the twice-seen stack comes first.
    expect(lines[1]).toBe("<2> at renderMessageList (chat.js:9:9)");
    expect(lines[2]).toBe("<1> at commitHookEffectList (chat.js:2:2)");
    expect(lines[0]).toContain("window=pane-1");
  });

  it("stops by itself after the sampling period", async () => {
    const { win } = createFakeWindow();
    const log = createLog();
    const collect = vi.fn(async () => "at spin (chat.js:1:2)");
    const sampler = createUnresponsiveSampler(win, { log, collect });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_PERIOD_MS);

    expect(log.block).toHaveBeenCalledTimes(1);
    expect(sampler.isSampling()).toBe(false);

    const collectedInPeriod = collect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SAMPLE_PERIOD_MS * 2);
    // Nothing more is collected or flushed after the window closes.
    expect(collect).toHaveBeenCalledTimes(collectedInPeriod);
    expect(log.block).toHaveBeenCalledTimes(1);
  });

  it("logs a zero-sample block naming why collection failed", async () => {
    const { win } = createFakeWindow();
    const log = createLog();
    const sampler = createUnresponsiveSampler(win, {
      log,
      collect: async () => {
        throw new Error(
          "Website owner has not opted in for JS call stacks in crash reports.",
        );
      },
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    sampler.stopAndFlush();

    const text = blockText(log);
    expect(text).toContain(
      "no stack samples collected: Website owner has not opted in",
    );
    expect(text).toContain("Total Samples: 0");
  });

  it("does not stall when the collector never resolves", async () => {
    const { win } = createFakeWindow();
    const log = createLog();
    // Real behaviour without Document-Policy + idle frame: the promise simply
    // never settles, so the sampler has to time out and carry on.
    const collect = vi.fn(() => new Promise<string>(() => {}));
    const sampler = createUnresponsiveSampler(win, { log, collect });

    sampler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    sampler.stopAndFlush();

    expect(collect.mock.calls.length).toBeGreaterThan(1);
    expect(blockText(log)).toContain(
      "no stack samples collected: collectJavaScriptCallStack returned nothing",
    );
  });

  it("flushes partial samples when the window closes mid-freeze", async () => {
    const { win, emit } = createFakeWindow();
    const log = createLog();
    const sampler = createUnresponsiveSampler(win, {
      log,
      collect: async () => "at spin (chat.js:1:2)",
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    emit("closed");

    expect(blockText(log)).toContain("<2> at spin (chat.js:1:2)");
    expect(sampler.isSampling()).toBe(false);
  });

  it("does not sample while DevTools is attached", async () => {
    const { win, webContents } = createFakeWindow();
    webContents.isDevToolsOpened.mockReturnValue(true);
    const log = createLog();
    const collect = vi.fn(async () => "at spin (chat.js:1:2)");
    const sampler = createUnresponsiveSampler(win, { log, collect });

    sampler.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_PERIOD_MS);

    expect(collect).not.toHaveBeenCalled();
    expect(sampler.stopAndFlush()).toBe(false);
    expect(log.block).not.toHaveBeenCalled();
  });

  it("truncates very long stacks but keeps the top frames", () => {
    const stack = Array.from(
      { length: 100 },
      (_, i) => `at frame${i} (x.js:1:1)`,
    );
    const truncated = truncateStack(stack.join("\n"));

    const lines = truncated.split("\n");
    expect(lines).toHaveLength(MAX_STACK_LINES + 1);
    expect(lines[0]).toBe("at frame0 (x.js:1:1)");
    expect(lines[MAX_STACK_LINES - 1]).toBe(
      `at frame${MAX_STACK_LINES - 1} (x.js:1:1)`,
    );
    expect(lines[MAX_STACK_LINES]).toBe(
      `… ${100 - MAX_STACK_LINES} more frames truncated`,
    );
  });

  it("formats a map of samples into one block with a total", () => {
    const lines = formatSampleBlock(
      new Map([
        ["at a (x.js:1:1)", 7],
        ["at b (x.js:2:2)", 2],
      ]),
      {
        windowName: "main",
        url: "file:///index.html",
        intervalMs: 1000,
        periodMs: 15000,
      },
    );

    expect(lines.slice(1)).toEqual([
      "<7> at a (x.js:1:1)",
      "<2> at b (x.js:2:2)",
      "Total Samples: 9",
    ]);
  });
});
