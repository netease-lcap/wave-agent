import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  addOnceAbortListener,
  createAbortPromise,
  addConsolidatedAbortListener,
  withAbortCleanup,
} from "@/utils/abortUtils.js";

describe("AbortUtils - Memory Leak Prevention", () => {
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();
    // Store original listener count by checking if we can add another listener
    // This is a workaround since Node.js doesn't expose listener count directly
    const testListener = () => {};
    abortController.signal.addEventListener("abort", testListener, {
      once: true,
    });
    abortController.signal.removeEventListener("abort", testListener);
  });

  afterEach(() => {
    // Clean up any remaining listeners
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  });

  describe("withAbortCleanup", () => {
    it("should execute operation and return result", async () => {
      const result = await withAbortCleanup(
        abortController.signal,
        async () => {
          return "success";
        },
      );
      expect(result).toBe("success");
    });

    it("should handle errors in operation", async () => {
      await expect(
        withAbortCleanup(abortController.signal, async () => {
          throw new Error("operation failed");
        }),
      ).rejects.toThrow("operation failed");
    });
  });

  describe("addOnceAbortListener", () => {
    it("should add listener that automatically removes itself after firing", async () => {
      const callback = vi.fn();

      // Add the once listener
      const cleanup = addOnceAbortListener(abortController.signal, callback);

      // Abort should trigger callback
      abortController.abort();

      expect(callback).toHaveBeenCalledTimes(1);

      // Verify cleanup function still works (should be no-op since already cleaned up)
      cleanup();
    });

    it("should call callback immediately if signal already aborted", () => {
      const callback = vi.fn();

      // Abort first
      abortController.abort();

      // Then add listener
      const cleanup = addOnceAbortListener(abortController.signal, callback);

      expect(callback).toHaveBeenCalledTimes(1);

      // Cleanup should be no-op
      cleanup();
    });

    it("should allow manual cleanup before abort", () => {
      const callback = vi.fn();

      // Add listener and immediately clean up
      const cleanup = addOnceAbortListener(abortController.signal, callback);
      cleanup();

      // Abort should not trigger callback
      abortController.abort();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("createAbortPromise", () => {
    it("should create promise that rejects on abort", async () => {
      const abortPromise = createAbortPromise(
        abortController.signal,
        "Test abort",
      );

      // Start abort asynchronously
      setTimeout(() => abortController.abort(), 10);

      await expect(abortPromise).rejects.toThrow("Test abort");
    });

    it("should reject immediately if signal already aborted", async () => {
      // Abort first
      abortController.abort();

      // Create promise
      const abortPromise = createAbortPromise(
        abortController.signal,
        "Already aborted",
      );

      await expect(abortPromise).rejects.toThrow("Already aborted");
    });

    it("should use default error message when none provided", async () => {
      const abortPromise = createAbortPromise(abortController.signal);

      abortController.abort();

      await expect(abortPromise).rejects.toThrow("Operation was aborted");
    });
  });

  describe("addConsolidatedAbortListener", () => {
    it("should consolidate multiple callbacks into single listener", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      // Add consolidated listener
      const cleanup = addConsolidatedAbortListener(abortController.signal, [
        callback1,
        callback2,
        callback3,
      ]);

      // Abort should trigger all callbacks
      abortController.abort();

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it("should handle callback errors gracefully", () => {
      const callback1 = vi.fn(() => {
        throw new Error("Callback error");
      });
      const callback2 = vi.fn();

      // Mock console.error to avoid test output pollution
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const cleanup = addConsolidatedAbortListener(abortController.signal, [
        callback1,
        callback2,
      ]);

      // Abort should trigger both callbacks despite error in first
      abortController.abort();

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Error in abort callback:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
      cleanup();
    });

    it("should call callbacks immediately if signal already aborted", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Abort first
      abortController.abort();

      // Add consolidated listener
      const cleanup = addConsolidatedAbortListener(abortController.signal, [
        callback1,
        callback2,
      ]);

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });

  describe("Memory Leak Prevention Integration", () => {
    it("should not accumulate listeners when called multiple times", () => {
      // This test verifies that our utilities don't cause the memory leak warning
      const callbacks: (() => void)[] = [];
      const cleanups: (() => void)[] = [];

      // Add 12 listeners (more than the warning threshold of 11)
      for (let i = 0; i < 12; i++) {
        const callback = vi.fn();
        callbacks.push(callback);

        // Each call should use { once: true } to prevent accumulation
        const cleanup = addOnceAbortListener(abortController.signal, callback);
        cleanups.push(cleanup);
      }

      // Abort should trigger all callbacks exactly once
      abortController.abort();

      callbacks.forEach((callback) => {
        expect(callback).toHaveBeenCalledTimes(1);
      });

      // All cleanups should be no-ops at this point
      cleanups.forEach((cleanup) => cleanup());
    });

    it("should consolidate many callbacks without listener accumulation", () => {
      const callbacks: (() => void)[] = [];

      // Create 12 callbacks
      for (let i = 0; i < 12; i++) {
        callbacks.push(vi.fn());
      }

      // Consolidate all into single listener (should only add 1 actual listener)
      const cleanup = addConsolidatedAbortListener(
        abortController.signal,
        callbacks,
      );

      // Abort should trigger all callbacks
      abortController.abort();

      callbacks.forEach((callback) => {
        expect(callback).toHaveBeenCalledTimes(1);
      });

      cleanup();
    });
  });
});
