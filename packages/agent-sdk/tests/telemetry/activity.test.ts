import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The metric side is stubbed: this file is about *when* a segment is recorded
 * and how long it is, not about the instrument (`tests/telemetry/metrics.test.ts`
 * covers that).
 */
const { recordActiveTime } = vi.hoisted(() => ({ recordActiveTime: vi.fn() }));

vi.mock("@/telemetry/metrics.js", () => ({ recordActiveTime }));

describe("activity", () => {
  let activityModule: typeof import("@/telemetry/activity.js");
  let now: number;

  const clock = () => now;
  const advance = (ms: number) => {
    now += ms;
  };

  const SESSION = { sessionId: "session-1", workdir: "/repo" };
  const OTHER = { sessionId: "session-2", workdir: "/repo" };

  beforeEach(async () => {
    vi.resetModules();
    recordActiveTime.mockClear();
    now = 1_000_000;
    activityModule = await import("@/telemetry/activity.js");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** One session's tracker, driven by the fake clock. */
  function tracker() {
    return new activityModule.ActivityTracker(clock);
  }

  describe("cli active time", () => {
    it("should record the wall clock a single operation was in flight", () => {
      const activity = tracker();
      activity.startOperation("op-1", SESSION);
      advance(3_000);
      activity.endOperation("op-1", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([
        [3, "cli", { sessionId: "session-1", workdir: "/repo" }],
      ]);
    });

    it("should count overlapping operations once, not once per operation", () => {
      const activity = tracker();
      activity.startOperation("op-1", SESSION);
      advance(2_000);
      activity.startOperation("op-2", SESSION);
      advance(2_000);
      activity.endOperation("op-1", SESSION);
      // The set is not empty yet: the interval stays open and nothing is
      // recorded in between.
      expect(recordActiveTime).not.toHaveBeenCalled();
      advance(2_000);
      activity.endOperation("op-2", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([[6, "cli", SESSION]]);
    });

    it("should collapse a nested operation into its parent's interval", () => {
      const activity = tracker();
      activity.startOperation("llm", SESSION);
      advance(1_000);
      activity.startOperation("tool", SESSION);
      advance(1_000);
      activity.endOperation("tool", SESSION);
      advance(1_000);
      activity.endOperation("llm", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([[3, "cli", SESSION]]);
    });

    it("should close the previous interval when the same operation starts twice", () => {
      // A caller that died without ending leaves the id in the set. Rewinding
      // it undercounts the crashed stretch; letting it run on would fold all
      // the idle time that follows into one segment.
      const activity = tracker();
      activity.startOperation("op-1", SESSION);
      advance(4_000);
      activity.startOperation("op-1", SESSION);
      advance(2_000);
      activity.endOperation("op-1", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([
        [4, "cli", SESSION],
        [2, "cli", SESSION],
      ]);
    });

    it("should ignore an end for an operation it never saw start", () => {
      const activity = tracker();
      activity.endOperation("never-started", SESSION);

      expect(recordActiveTime).not.toHaveBeenCalled();
    });
  });

  describe("per-session buckets", () => {
    it("should record each session's own time under its own session id", () => {
      const activity = tracker();
      activity.startOperation("a", SESSION);
      activity.startOperation("b", OTHER);
      advance(1_000);
      activity.endOperation("a", SESSION);
      advance(1_000);
      activity.endOperation("b", OTHER);

      expect(recordActiveTime.mock.calls).toEqual([
        [1, "cli", SESSION],
        [2, "cli", OTHER],
      ]);
    });

    it("should let concurrent sessions add up past the process wall clock", () => {
      // Two sessions each ran for 10s during the same 10s of wall-clock time:
      // 20s of session time. That is the documented口径 — this metric is not
      // process uptime.
      const activity = tracker();
      activity.startOperation("a", SESSION);
      activity.startOperation("b", OTHER);
      advance(10_000);
      activity.endOperation("a", SESSION);
      activity.endOperation("b", OTHER);

      const total = recordActiveTime.mock.calls.reduce(
        (sum, call) => sum + (call[0] as number),
        0,
      );
      expect(total).toBe(20);
    });
  });

  describe("waiting on the user", () => {
    it("should not count the dialog's time as the agent working", () => {
      const activity = tracker();
      activity.startOperation("tool", SESSION);
      advance(2_000);
      activity.beginUserWait(SESSION);
      // The prompt sits unanswered for a minute.
      advance(60_000);
      activity.endUserWait(SESSION);
      advance(5_000);
      activity.endOperation("tool", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([
        [2, "cli", SESSION],
        [5, "cli", SESSION],
      ]);
    });

    it("should reopen the interval only while the operation is still running", () => {
      const activity = tracker();
      activity.startOperation("tool", SESSION);
      advance(1_000);
      activity.beginUserWait(SESSION);
      // The operation finished while the prompt was up (e.g. it was aborted).
      activity.endOperation("tool", SESSION);
      advance(30_000);
      activity.endUserWait(SESSION);

      expect(recordActiveTime.mock.calls).toEqual([[1, "cli", SESSION]]);
    });

    it("should ignore an unmatched end of a wait", () => {
      const activity = tracker();
      activity.endUserWait(SESSION);

      expect(recordActiveTime).not.toHaveBeenCalled();
    });
  });

  describe("user active time", () => {
    it("should record the gap between two interactions under five seconds", () => {
      const activity = tracker();
      activity.recordUserActivity(SESSION);
      advance(4_000);
      activity.recordUserActivity(SESSION);

      expect(recordActiveTime.mock.calls).toEqual([[4, "user", SESSION]]);
    });

    it("should treat a gap of five seconds or more as idle", () => {
      const activity = tracker();
      activity.recordUserActivity(SESSION);
      advance(activityModule.USER_ACTIVITY_TIMEOUT_MS);
      activity.recordUserActivity(SESSION);

      expect(recordActiveTime).not.toHaveBeenCalled();
    });

    it("should not record anything for the first interaction of a session", () => {
      const activity = tracker();
      activity.recordUserActivity(SESSION);

      expect(recordActiveTime).not.toHaveBeenCalled();
    });

    it("should stay silent while the agent is working, but keep the timestamp", () => {
      const activity = tracker();
      activity.startOperation("llm", SESSION);
      activity.recordUserActivity(SESSION);
      advance(4_000);
      activity.recordUserActivity(SESSION);
      expect(recordActiveTime).not.toHaveBeenCalled();

      // The second interaction did move the timestamp: the next gap is measured
      // from it, so the same wall clock is never counted as both.
      activity.endOperation("llm", SESSION);
      advance(1_000);
      activity.recordUserActivity(SESSION);

      expect(recordActiveTime.mock.calls).toEqual([
        [4, "cli", SESSION],
        [1, "user", SESSION],
      ]);
    });
  });

  describe("flush", () => {
    it("should record the still-open interval and forget the session", () => {
      const activity = tracker();
      activity.startOperation("op-1", SESSION);
      advance(7_000);
      activity.flush("session-1");

      expect(recordActiveTime.mock.calls).toEqual([[7, "cli", SESSION]]);

      // The bucket is gone: a later operation starts a fresh interval instead
      // of continuing the flushed one.
      activity.startOperation("op-2", SESSION);
      advance(1_000);
      activity.endOperation("op-2", SESSION);

      expect(recordActiveTime.mock.calls).toEqual([
        [7, "cli", SESSION],
        [1, "cli", SESSION],
      ]);
    });

    it("should ignore a session it never saw", () => {
      const activity = tracker();
      activity.flush("nobody");

      expect(recordActiveTime).not.toHaveBeenCalled();
    });

    it("should leave other sessions alone", () => {
      const activity = tracker();
      activity.startOperation("a", SESSION);
      activity.startOperation("b", OTHER);
      advance(3_000);
      activity.flush("session-1");
      advance(2_000);
      activity.endOperation("b", OTHER);

      expect(recordActiveTime.mock.calls).toEqual([
        [3, "cli", SESSION],
        [5, "cli", OTHER],
      ]);
    });

    it("should drop everything on reset", () => {
      const activity = tracker();
      activity.startOperation("op-1", SESSION);
      activity.reset();
      advance(5_000);
      activity.endOperation("op-1", SESSION);

      expect(recordActiveTime).not.toHaveBeenCalled();
    });
  });

  describe("trackCliOperation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
    });

    it("should record the time a successful call took", async () => {
      const result = await activityModule.trackCliOperation(
        "llm",
        SESSION,
        async () => {
          vi.setSystemTime(1_002_500);
          return "done";
        },
      );

      expect(result).toBe("done");
      expect(recordActiveTime.mock.calls).toEqual([[2.5, "cli", SESSION]]);
    });

    it("should close the interval when the call throws", async () => {
      await expect(
        activityModule.trackCliOperation("tool", SESSION, async () => {
          vi.setSystemTime(1_001_000);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(recordActiveTime.mock.calls).toEqual([[1, "cli", SESSION]]);
    });

    it("should give each call its own id, so siblings are not deduped", async () => {
      await Promise.all([
        activityModule.trackCliOperation("tool", SESSION, async () => {
          vi.setSystemTime(1_003_000);
        }),
        activityModule.trackCliOperation("tool", SESSION, async () => {
          vi.setSystemTime(1_003_000);
        }),
      ]);

      // Two overlapping calls, one wall-clock interval — not a restart that
      // would have recorded a first segment and started over.
      expect(recordActiveTime.mock.calls).toEqual([[3, "cli", SESSION]]);
    });
  });
});
