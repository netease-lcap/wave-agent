import { describe, expect, it } from "vitest";
import {
  FLAP_BACKOFF_AFTER,
  FLAP_WINDOW_MS,
  RECONNECT_CAP_MS,
  RECONNECT_DECAY_AFTER,
  RECONNECT_SLOW_TICK_MS,
  FlapTracker,
  backoffForFailure,
  flapDelayMs,
} from "../src/main/sshReconnect";

describe("backoffForFailure", () => {
  it("doubles from one second and caps at a minute", () => {
    expect(backoffForFailure(0)).toBe(1_000);
    expect(backoffForFailure(1)).toBe(2_000);
    expect(backoffForFailure(4)).toBe(16_000);
    expect(backoffForFailure(6)).toBe(RECONNECT_CAP_MS);
    expect(backoffForFailure(RECONNECT_DECAY_AFTER - 1)).toBe(RECONNECT_CAP_MS);
  });

  it("falls back to the slow tick once the streak is long", () => {
    expect(backoffForFailure(RECONNECT_DECAY_AFTER)).toBe(
      RECONNECT_SLOW_TICK_MS,
    );
    expect(backoffForFailure(500)).toBe(RECONNECT_SLOW_TICK_MS);
  });
});

describe("flapDelayMs", () => {
  it("stays out of the way until the host starts flapping", () => {
    expect(flapDelayMs(0)).toBe(0);
    expect(flapDelayMs(FLAP_BACKOFF_AFTER)).toBe(0);
  });

  it("adds a doubling delay and caps it at a minute", () => {
    expect(flapDelayMs(FLAP_BACKOFF_AFTER + 1)).toBe(5_000);
    expect(flapDelayMs(FLAP_BACKOFF_AFTER + 2)).toBe(10_000);
    expect(flapDelayMs(30)).toBe(60_000);
  });
});

describe("FlapTracker", () => {
  it("counts only the closes inside the window", () => {
    const tracker = new FlapTracker();
    expect(tracker.recordClose(1_000)).toBe(1);
    expect(tracker.recordClose(2_000)).toBe(2);
    // The first close has slid out of the window by then.
    expect(tracker.count(1_000 + FLAP_WINDOW_MS + 1)).toBe(1);
  });

  it("treats a long-lived connection as leaving the episode", () => {
    const tracker = new FlapTracker();
    tracker.recordClose(10_000);
    tracker.recordClose(11_000);
    // Once every close has slid out of the window the host counts as clean
    // again, which is what re-arms the "unstable" notice.
    expect(tracker.count(11_000 + FLAP_WINDOW_MS - 2_000)).toBe(2);
    expect(tracker.count(11_000 + FLAP_WINDOW_MS - 1_000)).toBe(1);
    expect(tracker.count(11_000 + FLAP_WINDOW_MS)).toBe(0);
  });
});
