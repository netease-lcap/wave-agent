import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_DIMENSION_PX,
  exceedsMaxDimension,
  getImageDimensions,
  getImageDimensionsFromDataUrl,
  omittedImageNote,
} from "../../src/utils/imageDimensions.js";

/** Build a PNG header (signature + IHDR) with the given dimensions. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes.set(
    [
      (width >>> 24) & 0xff,
      (width >>> 16) & 0xff,
      (width >>> 8) & 0xff,
      width & 0xff,
    ],
    16,
  );
  bytes.set(
    [
      (height >>> 24) & 0xff,
      (height >>> 16) & 0xff,
      (height >>> 8) & 0xff,
      height & 0xff,
    ],
    20,
  );
  return bytes;
}

/** SOI + APP0 + SOF0 + EOI — enough for a marker walk to reach the frame. */
function jpegWithFrame(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00, // APP0 (length 16)
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // 3 components
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9, // EOI
  ]);
}

function riffWebp(fourcc: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(20 + payload.length);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set(
    [...fourcc].map((c) => c.charCodeAt(0)),
    12,
  );
  const chunkSize = payload.length;
  bytes.set(
    [
      chunkSize & 0xff,
      (chunkSize >> 8) & 0xff,
      (chunkSize >> 16) & 0xff,
      (chunkSize >> 24) & 0xff,
    ],
    16,
  );
  bytes.set(payload, 20);
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riffWebp("VP8X", [
    0x00,
    0x00,
    0x00,
    0x00,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function webpVp8l(width: number, height: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14);
  return riffWebp("VP8L", [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >> 24) & 0xff,
  ]);
}

function webpVp8(width: number, height: number): Uint8Array {
  return riffWebp("VP8 ", [
    0x00,
    0x00,
    0x00, // frame tag
    0x9d,
    0x01,
    0x2a, // start code
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
}

function gifHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0x00,
    0x00,
    0x00,
    0x3b,
  ]);
}

const TINY_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("MAX_IMAGE_DIMENSION_PX", () => {
  it("is the empirically measured gateway bound", () => {
    expect(MAX_IMAGE_DIMENSION_PX).toBe(8192);
  });
});

describe("getImageDimensions", () => {
  it("reads PNG dimensions from IHDR", () => {
    expect(getImageDimensions(pngHeader(2250, 15474))).toEqual({
      width: 2250,
      height: 15474,
    });
    expect(getImageDimensions(TINY_PNG_BYTES)).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("reads JPEG dimensions from the SOF segment", () => {
    expect(getImageDimensions(jpegWithFrame(8193, 1500))).toEqual({
      width: 8193,
      height: 1500,
    });
    expect(getImageDimensions(jpegWithFrame(1200, 800))).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("reads all three WebP variants", () => {
    expect(getImageDimensions(webpVp8x(8192, 8193))).toEqual({
      width: 8192,
      height: 8193,
    });
    expect(getImageDimensions(webpVp8l(3000, 9000))).toEqual({
      width: 3000,
      height: 9000,
    });
    expect(getImageDimensions(webpVp8(15474, 2250))).toEqual({
      width: 15474,
      height: 2250,
    });
  });

  it("reads GIF dimensions from the screen descriptor", () => {
    expect(getImageDimensions(gifHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("returns undefined for unknown or truncated headers", () => {
    expect(getImageDimensions(new Uint8Array())).toBeUndefined();
    expect(
      getImageDimensions(new TextEncoder().encode("not an image at all")),
    ).toBeUndefined();
    // PNG signature only — no IHDR yet.
    expect(getImageDimensions(pngHeader(1, 1).slice(0, 16))).toBeUndefined();
    // RIFF/WEBP container with an unknown chunk type.
    expect(getImageDimensions(riffWebp("XXXX", [0, 0, 0, 0]))).toBeUndefined();
  });
});

describe("getImageDimensionsFromDataUrl", () => {
  it("decodes the header from a data URL", () => {
    const dataUrl = `data:image/png;base64,${Buffer.from(pngHeader(2250, 15474)).toString("base64")}`;
    expect(getImageDimensionsFromDataUrl(dataUrl)).toEqual({
      width: 2250,
      height: 15474,
    });
  });

  it("returns undefined for non-data-urls and empty payloads", () => {
    expect(
      getImageDimensionsFromDataUrl("/tmp/screenshot.png"),
    ).toBeUndefined();
    expect(
      getImageDimensionsFromDataUrl("data:image/png;base64,"),
    ).toBeUndefined();
    expect(
      getImageDimensionsFromDataUrl("data:text/plain;base64,aGk="),
    ).toBeUndefined();
  });
});

describe("exceedsMaxDimension", () => {
  it("uses a strict bound on each side", () => {
    expect(exceedsMaxDimension({ width: 8192, height: 8192 })).toBe(false);
    expect(exceedsMaxDimension({ width: 8193, height: 1500 })).toBe(true);
    expect(exceedsMaxDimension({ width: 1500, height: 8193 })).toBe(true);
    // Pixel count is irrelevant — the gateway accepts 28 MP at 7000x4000 and
    // rejects 16.5 MP at 11000x1500.
    expect(exceedsMaxDimension({ width: 7000, height: 4000 })).toBe(false);
  });
});

describe("omittedImageNote", () => {
  it("states the real size, the bound and what to do next", () => {
    const note = omittedImageNote({ width: 2250, height: 15474 });
    expect(note).toContain("2250x15474");
    expect(note).toContain("8192");
    expect(note).toContain("Crop");
    expect(note).not.toContain("Path:");
  });

  it("carries the local path so the model can act on it", () => {
    const note = omittedImageNote(
      { width: 1500, height: 8193 },
      "/tmp/wave-image-long.png",
    );
    expect(note).toContain("Path: /tmp/wave-image-long.png");
  });
});
