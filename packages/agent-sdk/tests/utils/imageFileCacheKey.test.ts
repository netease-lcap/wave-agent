import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cache identity for images that live in a file. The point of folding size and
 * mtime into the key is that re-reading a *changed* file must not be served the
 * previous rewrite from the LRU cache — a bare path key would silently send a
 * stale, wrongly-sized image for the rest of the session.
 */
const statSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  statSync,
}));

import { imageFileCacheKey } from "../../src/utils/imageRewrite.js";

const statOf = (size: number, mtimeMs: number) =>
  ({ size, mtimeMs }) as unknown as ReturnType<typeof statSync>;

afterEach(() => {
  statSync.mockReset();
});

describe("imageFileCacheKey", () => {
  it("keys a file by path, size and mtime", () => {
    statSync.mockReturnValue(statOf(4096, 1111));

    expect(imageFileCacheKey("/tmp/shot.png")).toBe("/tmp/shot.png:4096:1111");
  });

  it("gives a rewritten file a new key without changing its path", () => {
    statSync.mockReturnValue(statOf(4096, 1111));
    const before = imageFileCacheKey("/tmp/shot.png");

    // Same path, new bytes (and so new size + mtime).
    statSync.mockReturnValue(statOf(9000, 2222));

    expect(imageFileCacheKey("/tmp/shot.png")).not.toBe(before);
  });

  it("falls back to the bare path when the file cannot be stat'ed", () => {
    statSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(imageFileCacheKey("/tmp/gone.png")).toBe("/tmp/gone.png");
  });
});
