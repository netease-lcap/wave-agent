/**
 * Registry of live async work that must drain before the agent is destroyed.
 *
 * Fire-and-forget work (dispatch, background subagents, fork subagents)
 * registers its promise here so destroy() can wait deterministically instead
 * of silently abandoning it (the "ghost work" class of #1808). The registry
 * swallows rejections so an unregistered fire-and-forget caller can't turn a
 * settled-then-removed promise into an unhandled rejection.
 */
export class AsyncWorkRegistry {
  private work = new Set<Promise<unknown>>();
  private waiters: Array<() => void> = [];

  constructor(private readonly drainTimeoutMs: number = 10_000) {}

  get size(): number {
    return this.work.size;
  }

  isEmpty(): boolean {
    return this.work.size === 0;
  }

  /**
   * Register a promise as live work. The promise is removed when it settles
   * (fulfilled or rejected); rejections are consumed here so tracking never
   * produces an unhandled rejection. Returns the original promise unchanged
   * so the caller can still await it.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    this.work.add(promise);
    promise.then(
      () => this.remove(promise),
      () => this.remove(promise),
    );
    return promise;
  }

  private remove(promise: Promise<unknown>): void {
    this.work.delete(promise);
    if (this.work.size === 0) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) {
        resolve();
      }
    }
  }

  /**
   * Wait until the registry is empty, or until the timeout elapses. Loops
   * until empty: work registered after an await point is still drained.
   * Returns true if drained, false on timeout (leftover work is no longer
   * lifecycle-managed).
   */
  async drain(timeoutMs: number = this.drainTimeoutMs): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.work.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      // Wait for the registry to empty, or for the timeout — whichever comes
      // first (a tracked promise may never settle).
      let waiter: (() => void) | undefined;
      const notified = new Promise<void>((resolve) => {
        waiter = resolve;
        this.waiters.push(resolve);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remaining);
      });
      await Promise.race([notified, timedOut]);
      if (timer) clearTimeout(timer);
      // If the timer won, the work set is still non-empty: drop our waiter so
      // a later drain isn't woken by a stale notification. If notified won,
      // remove() already cleared the waiters array.
      if (waiter && this.work.size > 0) {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
      }
    }
    return true;
  }
}
