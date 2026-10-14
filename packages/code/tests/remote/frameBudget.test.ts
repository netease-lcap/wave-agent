import { describe, it, expect } from "vitest";
import {
  frameBytes,
  REMOTE_MAX_FRAME_BYTES,
  trailingCountThatFits,
} from "../../src/remote/frameBudget.js";

describe("frameBytes", () => {
  it("should measure bytes rather than characters", () => {
    expect(frameBytes({ a: "x" })).toBe(
      Buffer.byteLength(JSON.stringify({ a: "x" }), "utf8"),
    );
    // The point of measuring on the wire: a page of Chinese text is three times
    // the size the string length suggests, and it is bytes the relay counts.
    expect(frameBytes({ a: "汉" })).toBeGreaterThan("汉".length);
  });

  it("should report nothing for values JSON.stringify drops", () => {
    expect(frameBytes(undefined)).toBe(0);
    expect(frameBytes(() => undefined)).toBe(0);
  });
});

describe("trailingCountThatFits", () => {
  it("should keep everything when everything fits", () => {
    expect(trailingCountThatFits(5, () => true)).toBe(5);
  });

  it("should keep nothing when not even one item fits", () => {
    expect(trailingCountThatFits(5, () => false)).toBe(0);
  });

  it("should find the largest fitting count without scanning every candidate", () => {
    const tried: number[] = [];
    const kept = trailingCountThatFits(1000, (count) => {
      tried.push(count);
      return count <= 137;
    });

    expect(kept).toBe(137);
    // A scan would stringify a page per candidate length — 1000 of them here.
    expect(tried.length).toBeLessThan(20);
  });

  it("should answer zero for an empty page", () => {
    expect(trailingCountThatFits(0, () => true)).toBe(0);
  });
});

describe("REMOTE_MAX_FRAME_BYTES", () => {
  it("should stay clear of the relay's per-subscriber buffer", () => {
    // The relay drops any single frame that does not fit a 1 MiB buffer, and it
    // does it silently. Half of that leaves room for the frames already in
    // flight; raising this without raising the relay's buffer reintroduces the
    // dropped page.
    expect(REMOTE_MAX_FRAME_BYTES).toBe(512 * 1024);
  });
});
