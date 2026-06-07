import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter } from "../../src/workflow/concurrencyLimiter.js";

describe("ConcurrencyLimiter", () => {
  it("acquire resolves when slots are available", async () => {
    const limiter = new ConcurrencyLimiter(2);
    await limiter.acquire();
    expect(limiter.activeCount).toBe(1);
    limiter.release();
  });

  it("exceeding max concurrency blocks until release", async () => {
    const limiter = new ConcurrencyLimiter(2);
    await limiter.acquire();
    await limiter.acquire();

    let acquired = false;
    const blocked = limiter.acquire().then(() => {
      acquired = true;
    });

    // Give microtask queue a chance to run
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(limiter.pendingCount).toBe(1);

    limiter.release();
    await blocked;
    expect(acquired).toBe(true);
    limiter.release();
    limiter.release();
  });

  it("resolves in FIFO order", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire();

    const order: number[] = [];
    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));

    limiter.release(); // resolves p1
    await p1;
    limiter.release(); // resolves p2
    await p2;
    limiter.release(); // resolves p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("drain waits for all in-flight promises to settle", async () => {
    const limiter = new ConcurrencyLimiter(3);
    let resolve1: () => void;
    let resolve2: () => void;

    const p1 = new Promise<void>((r) => {
      resolve1 = r;
    });
    const p2 = new Promise<void>((r) => {
      resolve2 = r;
    });

    limiter.track(p1);
    limiter.track(p2);

    let drained = false;
    const drainPromise = limiter.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    resolve1!();
    await Promise.resolve();
    expect(drained).toBe(false);

    resolve2!();
    await drainPromise;
    expect(drained).toBe(true);
  });

  it("maxConcurrency=1 enforces serial execution", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: string[] = [];

    const runSerial = async (id: number) => {
      await limiter.acquire();
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${id}`);
      limiter.release();
    };

    // Run two concurrently, but they should execute serially
    await Promise.all([runSerial(1), runSerial(2)]);

    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("constructor enforces minimum maxConcurrency of 1", async () => {
    const limiter = new ConcurrencyLimiter(0);
    // Should still allow acquire
    await limiter.acquire();
    expect(limiter.activeCount).toBe(1);
    limiter.release();
  });
});
