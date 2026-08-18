import { describe, expect, it } from "vitest";
import { AsyncWorkRegistry } from "@/utils/asyncWorkRegistry.js";

describe("AsyncWorkRegistry", () => {
  it("drains immediately when no work is registered", async () => {
    const registry = new AsyncWorkRegistry(1_000);
    expect(registry.size).toBe(0);
    const started = Date.now();
    const drained = await registry.drain();
    expect(drained).toBe(true);
    // No extra delay when empty: drain returns without waiting
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("waits for tracked work to settle before draining", async () => {
    const registry = new AsyncWorkRegistry(1_000);
    let resolveWork!: () => void;
    const work = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });
    registry.track(work);

    let drained = false;
    const drainPromise = registry.drain().then((result) => {
      drained = result;
    });
    // Drain must not resolve while the work is pending
    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);

    resolveWork();
    await drainPromise;
    expect(drained).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.isEmpty()).toBe(true);
  });

  it("removes work when the tracked promise rejects (no unhandled rejection)", async () => {
    const registry = new AsyncWorkRegistry(1_000);
    // Track a rejecting promise fire-and-forget: vitest fails the test if an
    // unhandled rejection escapes, so passing here proves track() swallows it.
    registry.track(Promise.reject(new Error("boom")));
    await registry.drain();
    expect(registry.size).toBe(0);
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("keeps draining work registered after an await point", async () => {
    const registry = new AsyncWorkRegistry(1_000);
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    registry.track(first);

    let resolveSecond!: () => void;
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    let drained = false;
    const drainPromise = registry.drain().then((result) => {
      drained = result;
    });

    // New work starts at an await point inside the first tracked task — i.e.
    // in the same synchronous flow that settles it, before the registry can
    // observe an empty set. The drain loop must keep waiting for it.
    resolveFirst();
    registry.track(second);

    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false); // drain must keep waiting for the new work
    expect(registry.size).toBe(1);

    resolveSecond();
    await drainPromise;
    expect(drained).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("times out with false when work never settles", async () => {
    const registry = new AsyncWorkRegistry(30);
    // Never-resolving promise: drain must fall back to the timeout
    registry.track(new Promise<void>(() => {}));
    const drained = await registry.drain();
    expect(drained).toBe(false);
    expect(registry.size).toBe(1);
  });

  it("track returns the original promise unchanged", async () => {
    const registry = new AsyncWorkRegistry(1_000);
    const work = Promise.resolve("result");
    const tracked = registry.track(work);
    expect(tracked).toBe(work);
    await tracked;
    expect(registry.size).toBe(0);
  });
});
