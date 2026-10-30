/**
 * Backoff + flap policy for reconnecting a dropped ssh host.
 *
 * Kept free of Electron and IO so the numbers can be unit-tested directly —
 * DesktopHost owns the pacing (timers, presence, sleep detection) and calls
 * these helpers to decide "how long until the next attempt" and "is this host
 * flapping too hard to keep dialing".
 *
 * Spec: desktop-remote.md「SSH 远程会话断线自动重连」.
 */

/** First retry delay when the host still has something to restore. */
export const RECONNECT_BASE_MS = 1_000;
/** Ceiling for the doubling backoff (spec: 间隔封顶约 1 分钟). */
export const RECONNECT_CAP_MS = 60_000;
/** After this many consecutive failures, fall back to a slow tick. */
export const RECONNECT_DECAY_AFTER = 30;
/** Slow tick once the failure streak is long (spec: 约 5 分钟一次的慢速重试). */
export const RECONNECT_SLOW_TICK_MS = 300_000;
/**
 * Nothing to restore (no pane binding left): try only these delays, then hand
 * the host back to the lazy path — the next access reconnects (scenario 4).
 */
export const IDLE_BACKOFF_MS = [1_000, 2_000, 5_000];
/** One reconnect round running this long tells the user it is still trying. */
export const RECONNECT_PROLONGED_MS = 600_000;

/** Window for counting unexpected closes (flapping). */
export const FLAP_WINDOW_MS = 300_000;
/** Past this many closes in the window, add a delay to the backoff. */
export const FLAP_BACKOFF_AFTER = 5;
/** Past this many closes, tell the user the host is unstable and slow right down. */
export const FLAP_PARK_AFTER = 10;
export const FLAP_BACKOFF_BASE_MS = 5_000;
export const FLAP_BACKOFF_CAP_MS = 60_000;

/** Sleep interruptions tolerated within one connection generation. */
export const MAX_SLEEP_INTERRUPTS = 5;
/**
 * An attempt that took this long was suspended mid-flight by the OS, not a
 * real failure — a sleep must not burn a retry (scenario 5).
 */
export const SLEEP_SPAN_MS = 90_000;
/** After a resume, give the network stack this long before dialing (scenario 6). */
export const POST_RESUME_SETTLE_MS = 8_000;
/** How often to re-check whether the user is back at the computer. */
export const PRESENCE_POLL_MS = 15_000;

/** Delay before the next attempt after `failStreak` consecutive failures. */
export function backoffForFailure(failStreak: number): number {
  if (failStreak >= RECONNECT_DECAY_AFTER) return RECONNECT_SLOW_TICK_MS;
  return Math.min(RECONNECT_BASE_MS * 2 ** failStreak, RECONNECT_CAP_MS);
}

/** Extra delay for a host that keeps dropping (0 until it starts flapping). */
export function flapDelayMs(closeCount: number): number {
  if (closeCount <= FLAP_BACKOFF_AFTER) return 0;
  return Math.min(
    FLAP_BACKOFF_BASE_MS * 2 ** (closeCount - FLAP_BACKOFF_AFTER - 1),
    FLAP_BACKOFF_CAP_MS,
  );
}

/** Unexpected closes of one host inside FLAP_WINDOW_MS. */
export class FlapTracker {
  private closes: number[] = [];

  /** Record a close; returns the count now inside the window. */
  recordClose(at: number): number {
    this.closes.push(at);
    return this.count(at);
  }

  /** Closes inside the window ending at `at`. */
  count(at: number): number {
    const floor = at - FLAP_WINDOW_MS;
    while (this.closes.length > 0 && this.closes[0] <= floor)
      this.closes.shift();
    return this.closes.length;
  }
}
