import { createRequire } from "node:module";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyToolImageBudget } from "../../src/utils/toolImageIngest.js";
import {
  __resetImageRewriteCacheForTesting,
  planOutboundImage,
} from "../../src/utils/imageRewrite.js";
import { getImageDimensions } from "../../src/utils/imageDimensions.js";
import { resolveSharp } from "../../src/utils/imageProcessor.js";
import type {
  SharpFactory,
  SharpImage,
} from "../../src/utils/imageProcessor.js";

/**
 * The fake-planner suite (`toolImageIngest.test.ts`) pins what the ingest step
 * does with each verdict; this one proves the whole path against the real codec
 * — one oversized tool image in, a smaller in-budget copy in the block, the
 * original on disk, and nothing left to resize on the way out.
 */
const sharp: SharpFactory | undefined = resolveSharp(
  createRequire(import.meta.url),
);

const sharpRaw = sharp as unknown as (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 3 } },
) => SharpImage;

/** High-entropy pixels: nothing lossless can squeeze them. */
function noisyRaw(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  let state = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    raw[i] = state & 0xff;
  }
  return raw;
}

async function pngDataUrlOf(
  source: Buffer,
  width: number,
  height: number,
): Promise<string> {
  const encoded = await sharpRaw(source, {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${encoded.toString("base64")}`;
}

/** Photo-like payload: expensive at full size, cheap enough to encode here. */
async function jpegDataUrlOf(
  source: Buffer,
  width: number,
  height: number,
  quality = 95,
): Promise<string> {
  const encoded = await sharpRaw(source, {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality })
    .toBuffer();
  return `data:image/jpeg;base64,${encoded.toString("base64")}`;
}

const createdPaths: string[] = [];

describe.skipIf(!sharp)("applyToolImageBudget with the real codec", () => {
  beforeEach(() => {
    __resetImageRewriteCacheForTesting();
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

  it("shrinks an oversized tool image into the block and keeps the original on disk", async () => {
    const dataUrl = await jpegDataUrlOf(noisyRaw(2400, 1800), 2400, 1800);
    const originalBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const originalBytes = Buffer.from(originalBase64, "base64");

    const [image] = await applyToolImageBudget([
      { data: originalBase64, mediaType: "image/jpeg" },
    ]);
    createdPaths.push(image.path!);

    const storedBytes = Buffer.from(image.data, "base64");
    // The block holds the small copy, not the original.
    expect(storedBytes.length).toBeLessThan(originalBytes.length * 0.8);
    const stored = getImageDimensions(storedBytes)!;
    expect(stored.width).toBeLessThanOrEqual(2000);
    expect(stored.height).toBeLessThanOrEqual(2000);
    // Container label follows the bytes the ladder actually produced.
    expect(image.mediaType).toBe(
      storedBytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))
        ? "image/jpeg"
        : "image/png",
    );
    // The model can still map its coordinates back to the full-size original.
    expect(image.note).toContain("original 2400x1800");
    expect(image.note).toContain(
      `displayed at ${stored.width}x${stored.height}`,
    );
    // ...and the original itself is reachable from the path on the block.
    expect(fs.readFileSync(image.path!).equals(originalBytes)).toBe(true);
  });

  it("leaves the shrunk image alone on the way out", async () => {
    // Second half of the contract: once the block holds an in-budget image, the
    // outbound pass must send it verbatim — no second encode, stable bytes.
    const dataUrl = await jpegDataUrlOf(noisyRaw(2400, 1800), 2400, 1800);
    const [image] = await applyToolImageBudget([
      {
        data: dataUrl.slice(dataUrl.indexOf(",") + 1),
        mediaType: "image/jpeg",
      },
    ]);
    createdPaths.push(image.path!);

    const storedDataUrl = `data:${image.mediaType};base64,${image.data}`;
    const plan = await planOutboundImage({
      dataUrl: storedDataUrl,
      cacheKey: storedDataUrl,
    });

    expect(plan).toEqual({ kind: "send", dataUrl: storedDataUrl });
  });

  it("leaves a budget-internal image byte-identical and writes nothing", async () => {
    const dataUrl = await pngDataUrlOf(
      Buffer.alloc(800 * 600 * 3, 128),
      800,
      600,
    );
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

    const [image] = await applyToolImageBudget([
      { data: base64, mediaType: "image/png" },
    ]);

    expect(image).toEqual({ data: base64, mediaType: "image/png" });
  });
});
