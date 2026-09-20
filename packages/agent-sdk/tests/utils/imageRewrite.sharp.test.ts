import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OUTBOUND_IMAGE_TARGET_RAW_BYTES,
  rawBytesFromDataUrl,
} from "../../src/utils/imageBudget.js";
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
 * End-to-end checks against the real codec — the fake-codec suite in
 * `imageRewrite.test.ts` pins the ladder's decisions, this one proves the
 * decisions actually work with sharp (option shapes accepted, containers and
 * alpha real). Skipped only where sharp cannot load at all (unsupported libc, a
 * stripped platform package).
 *
 * Images are generated here through sharp itself, so no binary fixtures.
 */
const sharp: SharpFactory | undefined = resolveSharp(
  createRequire(import.meta.url),
);

/**
 * The rest of sharp's surface this suite needs — constructing from raw pixels
 * and reading pixels back. Production code never uses either, so they stay out
 * of the SDK's structural type.
 */
const sharpRaw = sharp as unknown as (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 3 | 4 } },
) => SharpImage;

interface SharpDecode {
  ensureAlpha(): SharpDecode;
  raw(): SharpDecode;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
}

function solidGradient(width: number, height: number, channels: 3 | 4): Buffer {
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      raw[at] = x % 256;
      raw[at + 1] = y % 256;
      raw[at + 2] = (x + y) % 256;
      // Left half transparent, right half opaque — enough to see whether
      // transparency survived the rewrite.
      if (channels === 4) raw[at + 3] = x < width / 2 ? 0 : 255;
    }
  }
  return raw;
}

/** High-entropy pixels: nothing lossless can squeeze them. */
function noisyRaw(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  // xorshift32 — deterministic, but genuinely random-looking.
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
  channels: 3 | 4,
): Promise<string> {
  const encoded = await sharpRaw(source, { raw: { width, height, channels } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${encoded.toString("base64")}`;
}

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

function payloadOf(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** Container the bytes actually are, read from their magic numbers. */
function containerMime(bytes: Buffer): string {
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) {
    return "image/jpeg";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "unknown";
}

async function pixelsOf(dataUrl: string): Promise<{
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}> {
  const decoded = sharp!(payloadOf(dataUrl)) as unknown as SharpDecode;
  const { data, info } = await decoded
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    data,
  };
}

describe.skipIf(!sharp)("planOutboundImage with the real codec", () => {
  beforeEach(() => {
    __resetImageRewriteCacheForTesting();
  });

  it("shrinks an oversized image to the budget and labels the real container", async () => {
    const dataUrl = await pngDataUrlOf(
      solidGradient(3000, 2000, 3),
      3000,
      2000,
      3,
    );

    const plan = await planOutboundImage({ dataUrl, cacheKey: "photo" });
    expect(plan.kind).toBe("send");
    if (plan.kind !== "send") return;

    const bytes = payloadOf(plan.dataUrl);
    const displayed = getImageDimensions(bytes);
    expect(displayed!.width).toBeLessThanOrEqual(2000);
    expect(displayed!.height).toBeLessThanOrEqual(2000);
    expect(displayed!.width / displayed!.height).toBeCloseTo(1.5, 1);

    // The data URL's mime must be the container the bytes actually are.
    expect(
      plan.dataUrl.startsWith(`data:${containerMime(bytes)};base64,`),
    ).toBe(true);
    expect(plan.note).toContain("original 3000x2000");
    expect(plan.note).toContain(
      `displayed at ${displayed!.width}x${displayed!.height}`,
    );
  });

  it("keeps a JPEG source in JPEG rather than inflating it to PNG", async () => {
    const dataUrl = await jpegDataUrlOf(
      solidGradient(3000, 2000, 3),
      3000,
      2000,
    );

    const plan = await planOutboundImage({ dataUrl, cacheKey: "jpeg" });
    expect(plan.kind).toBe("send");
    if (plan.kind !== "send") return;

    const bytes = payloadOf(plan.dataUrl);
    expect(containerMime(bytes)).toBe("image/jpeg");
    expect(plan.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("preserves transparency when shrinking an alpha image", async () => {
    const dataUrl = await pngDataUrlOf(
      solidGradient(3000, 2000, 4),
      3000,
      2000,
      4,
    );

    const plan = await planOutboundImage({ dataUrl, cacheKey: "alpha" });
    expect(plan.kind).toBe("send");
    if (plan.kind !== "send") return;

    const bytes = payloadOf(plan.dataUrl);
    // A transparency-preserving container, not JPEG.
    expect(containerMime(bytes)).not.toBe("image/jpeg");

    const pixels = await pixelsOf(plan.dataUrl);
    const alphaAt = (x: number, y: number) =>
      pixels.data[(y * pixels.width + x) * pixels.channels + 3];
    // Left half was fully transparent, right half fully opaque.
    expect(alphaAt(10, 10)).toBe(0);
    expect(alphaAt(pixels.width - 10, 10)).toBe(255);
  });

  it("recompresses an over-budget image without resizing it", async () => {
    // A quality-100 JPEG of noisy pixels: dimensions inside the budget, bytes
    // far outside it (the ladder still starts at scale 1).
    const dataUrl = await jpegDataUrlOf(noisyRaw(2000, 2000), 2000, 2000, 100);
    expect(rawBytesFromDataUrl(dataUrl)).toBeGreaterThan(
      OUTBOUND_IMAGE_TARGET_RAW_BYTES,
    );

    const plan = await planOutboundImage({ dataUrl, cacheKey: "heavy-jpeg" });
    expect(plan.kind).toBe("send");
    if (plan.kind !== "send") return;

    const bytes = payloadOf(plan.dataUrl);
    expect(bytes.length).toBeLessThanOrEqual(OUTBOUND_IMAGE_TARGET_RAW_BYTES);
    expect(bytes.toString("base64").length).toBeLessThanOrEqual(
      5 * 1024 * 1024,
    );
    expect(containerMime(bytes)).toBe("image/jpeg");
    // Nothing had to be resized, so there is no coordinate-mapping note.
    expect(getImageDimensions(bytes)).toEqual({ width: 2000, height: 2000 });
    expect(plan.note).toBeUndefined();
  });

  it("leaves an in-budget image byte-for-byte alone", async () => {
    const dataUrl = await pngDataUrlOf(
      solidGradient(1200, 800, 3),
      1200,
      800,
      3,
    );

    const plan = await planOutboundImage({ dataUrl, cacheKey: "small" });

    expect(plan).toEqual({ kind: "send", dataUrl });
  });
});
