export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];
  private readonly maxConcurrency: number;
  private activeSet = new Set<Promise<unknown>>();

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      this.running++;
      const next = this.queue.shift()!;
      next();
    }
  }

  track<T>(promise: Promise<T>): Promise<T> {
    this.activeSet.add(promise);
    promise.finally(() => this.activeSet.delete(promise));
    return promise;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.activeSet);
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}
