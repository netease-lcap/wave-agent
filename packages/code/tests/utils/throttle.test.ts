import { describe, it, expect, vi, afterEach } from "vitest";
import { throttle } from "../../src/utils/throttle.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("throttle", () => {
  it("invokes on the leading edge and coalesces calls within the window", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 500);

    // Leading edge applies immediately
    throttled("first");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");

    // Calls inside the window are coalesced; only the last one fires on the
    // trailing edge
    throttled("second");
    throttled("third");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("third");
  });

  it("flush applies pending calls immediately and is a no-op when idle", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 500);

    // Pending trailing call is flushed before the window elapses
    throttled("first");
    throttled("second");
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("second");

    // Flush with nothing pending (lastArgs already consumed) is a no-op
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops pending calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 500);

    throttled("first");
    throttled("second");
    throttled.cancel();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");
  });

  it("respects leading: false by delaying the first invocation", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 500, { leading: false });

    throttled("first");
    expect(fn).not.toHaveBeenCalled();

    // With leading: false the first call only records the invocation time;
    // a subsequent call inside the window schedules the trailing timer
    throttled("first");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");
  });

  it("respects trailing: false by dropping in-window calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 500, { trailing: false });

    throttled("first");
    throttled("second");
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");
  });
});
