import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";

/** The outbound planner is the only policy source; this test stubs its verdicts. */
const planner = vi.hoisted(() => ({ plan: vi.fn() }));

vi.mock("../../src/utils/imageRewrite.js", () => ({
  planOutboundImage: planner.plan,
}));

/**
 * Persistence stays real by default (the original has to actually land on disk),
 * with a switch for the "could not write it" branch.
 */
const persistence = vi.hoisted(() => ({ fail: false }));

vi.mock("../../src/utils/toolImagePersistence.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/utils/toolImagePersistence.js")
    >();
  return {
    persistToolImages: (images: Array<{ data: string; mediaType?: string }>) =>
      persistence.fail
        ? images.map((image) => ({ ...image }))
        : actual.persistToolImages(images),
  };
});

import { applyToolImageBudget } from "../../src/utils/toolImageIngest.js";

/** Small, recognisable payloads — the ladder itself is tested elsewhere. */
const ORIGINAL_BASE64 = Buffer.from("original-image-bytes").toString("base64");
const SHRUNK_BASE64 = Buffer.from("shrunk").toString("base64");
const ORIGINAL_URL = `data:image/png;base64,${ORIGINAL_BASE64}`;
const SHRUNK_URL = `data:image/jpeg;base64,${SHRUNK_BASE64}`;
const NOTE =
  "[Image: original 4000x3000, displayed at 2000x1500. Multiply coordinates by 2.00 to map to the original image.]";

const createdPaths: string[] = [];

function recordPath(path: string | undefined): void {
  if (path) createdPaths.push(path);
}

describe("applyToolImageBudget (ingest-time image budget)", () => {
  beforeEach(() => {
    planner.plan.mockReset();
    persistence.fail = false;
  });

  afterEach(() => {
    for (const path of createdPaths.splice(0)) {
      try {
        fs.unlinkSync(path);
      } catch {
        // already gone
      }
    }
  });

  it("hands a budget-internal image back byte for byte, without touching disk", async () => {
    planner.plan.mockResolvedValue({ kind: "send", dataUrl: ORIGINAL_URL });
    const image = { data: ORIGINAL_BASE64, mediaType: "image/png" };

    const [result] = await applyToolImageBudget([image]);

    // Same object: nothing was re-encoded, re-prefixed or persisted.
    expect(result).toBe(image);
    expect(result).toEqual({
      data: ORIGINAL_BASE64,
      mediaType: "image/png",
    });
  });

  it("stores the shrunk bytes in the block and keeps the original on disk", async () => {
    planner.plan.mockResolvedValue({
      kind: "send",
      dataUrl: SHRUNK_URL,
      note: NOTE,
    });

    const [result] = await applyToolImageBudget([
      { data: ORIGINAL_BASE64, mediaType: "image/png" },
    ]);

    expect(result.data).toBe(SHRUNK_BASE64);
    expect(result.mediaType).toBe("image/jpeg");
    expect(result.note).toBe(NOTE);
    expect(result.path).toBeTruthy();
    recordPath(result.path);
    // The full-size original is still reachable from that path.
    expect(fs.readFileSync(result.path!).toString()).toBe(
      "original-image-bytes",
    );
    // ...and it is no longer carried inline.
    expect(result.data).not.toBe(ORIGINAL_BASE64);
  });

  it("keeps a path the image already had instead of copying it again", async () => {
    planner.plan.mockResolvedValue({ kind: "send", dataUrl: SHRUNK_URL });
    const sourcePath = "/work/screenshot.png";

    const [result] = await applyToolImageBudget([
      { data: ORIGINAL_BASE64, mediaType: "image/png", path: sourcePath },
    ]);

    expect(result.path).toBe(sourcePath);
    expect(result.data).toBe(SHRUNK_BASE64);
    expect(planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath }),
    );
  });

  it("keeps the original bytes when the ladder degrades (omit)", async () => {
    planner.plan.mockResolvedValue({ kind: "omit", note: "too big" });
    const image = { data: ORIGINAL_BASE64, mediaType: "image/png" };

    const [result] = await applyToolImageBudget([image]);

    expect(result).toBe(image);
    expect(result.data).toBe(ORIGINAL_BASE64);
  });

  it("keeps the original inline when it cannot be persisted", async () => {
    persistence.fail = true;
    planner.plan.mockResolvedValue({
      kind: "send",
      dataUrl: SHRUNK_URL,
      note: NOTE,
    });
    const image = { data: ORIGINAL_BASE64, mediaType: "image/png" };

    const [result] = await applyToolImageBudget([image]);

    // Better an oversized image in memory than no image at all.
    expect(result).toBe(image);
    expect(result.data).toBe(ORIGINAL_BASE64);
  });

  it("keeps the rest of the turn alive when one image fails", async () => {
    planner.plan
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ kind: "send", dataUrl: SHRUNK_URL });
    const failing = { data: ORIGINAL_BASE64, mediaType: "image/png" };

    const results = await applyToolImageBudget([
      failing,
      { data: ORIGINAL_BASE64, mediaType: "image/png" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toBe(failing);
    expect(results[1].data).toBe(SHRUNK_BASE64);
    recordPath(results[1].path);
  });

  it("passes the block's data URL to the planner, prefixing raw base64 once", async () => {
    planner.plan.mockResolvedValue({ kind: "send", dataUrl: ORIGINAL_URL });

    await applyToolImageBudget([
      { data: ORIGINAL_BASE64, mediaType: "image/png" },
      { data: ORIGINAL_URL, mediaType: "image/png" },
    ]);

    expect(planner.plan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dataUrl: ORIGINAL_URL,
        cacheKey: ORIGINAL_URL,
      }),
    );
    expect(planner.plan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dataUrl: ORIGINAL_URL,
        cacheKey: ORIGINAL_URL,
      }),
    );
  });
});
