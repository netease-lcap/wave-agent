import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_REJECT_MESSAGES,
  detectImageFormat,
  validateImageFile,
} from "../../src/utils/imageValidation";

/** 1x1 transparent PNG (valid, ends with the IEND chunk). */
const TINY_PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Minimal JPEG: SOI + APP0 + ... + EOI (tail check only looks at the markers). */
const TINY_JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xd9,
]);
const TINY_GIF_BYTES = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x3b,
]);
/** RIFF....WEBP — WebP needs no tail marker check. */
const TINY_WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);
const BMP_BYTES = Uint8Array.from([
  0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
);
/** A 40-byte text file renamed to .png — the shape of the reported 400. */
const TEXT_RENAMED_PNG = new TextEncoder().encode(
  "this is not an image at all, just text",
);

/** PNG whose IEND chunk was cut off (头部合法、内容被截断). */
const TRUNCATED_PNG_BYTES = TINY_PNG_BYTES.slice(0, 40);

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

describe("detectImageFormat", () => {
  it("recognizes the four whitelisted formats by magic bytes", () => {
    expect(detectImageFormat(TINY_PNG_BYTES)).toBe("png");
    expect(detectImageFormat(TINY_JPEG_BYTES)).toBe("jpeg");
    expect(detectImageFormat(TINY_GIF_BYTES)).toBe("gif");
    expect(detectImageFormat(TINY_WEBP_BYTES)).toBe("webp");
  });

  it("flags known-but-unsupported image formats distinctly from garbage", () => {
    expect(detectImageFormat(BMP_BYTES)).toBe("other");
    expect(detectImageFormat(SVG_BYTES)).toBe("other");
    expect(detectImageFormat(TEXT_RENAMED_PNG)).toBe(null);
    expect(detectImageFormat(new Uint8Array())).toBe(null);
  });

  it("does not mistake a PNG header alone for a PNG file", () => {
    // Only the 8-byte signature: still reported as png by the sniffer (the
    // truncation is caught by the tail check in validateImageFile).
    expect(detectImageFormat(Uint8Array.from(PNG_SIGNATURE))).toBe("png");
  });
});

describe("validateImageFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts valid PNG / JPEG / GIF / WebP files", async () => {
    await expect(
      validateImageFile(makeFile(TINY_PNG_BYTES, "a.png", "image/png")),
    ).resolves.toEqual({ ok: true });
    await expect(
      validateImageFile(makeFile(TINY_JPEG_BYTES, "a.jpg", "image/jpeg")),
    ).resolves.toEqual({ ok: true });
    await expect(
      validateImageFile(makeFile(TINY_GIF_BYTES, "a.gif", "image/gif")),
    ).resolves.toEqual({ ok: true });
    await expect(
      validateImageFile(makeFile(TINY_WEBP_BYTES, "a.webp", "image/webp")),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a zero-byte image (the empty-payload path)", async () => {
    const result = await validateImageFile(
      makeFile(new Uint8Array(), "0.png", "image/png"),
    );
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: IMAGE_REJECT_MESSAGES.empty,
    });
  });

  it("rejects non-image bytes renamed to an image type", async () => {
    const result = await validateImageFile(
      makeFile(TEXT_RENAMED_PNG, "fake.png", "image/png"),
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid-data",
      message: IMAGE_REJECT_MESSAGES.invalidData,
    });
  });

  it("rejects image formats outside the whitelist (bmp / svg)", async () => {
    await expect(
      validateImageFile(makeFile(BMP_BYTES, "a.bmp", "image/bmp")),
    ).resolves.toEqual({
      ok: false,
      reason: "unsupported-format",
      message: IMAGE_REJECT_MESSAGES.unsupportedFormat,
    });
    await expect(
      validateImageFile(makeFile(SVG_BYTES, "a.svg", "image/svg+xml")),
    ).resolves.toEqual({
      ok: false,
      reason: "unsupported-format",
      message: IMAGE_REJECT_MESSAGES.unsupportedFormat,
    });
  });

  it("rejects a truncated PNG (valid header, missing IEND)", async () => {
    await expect(
      validateImageFile(makeFile(TRUNCATED_PNG_BYTES, "cut.png", "image/png")),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid-data",
      message: IMAGE_REJECT_MESSAGES.invalidData,
    });
  });

  it("rejects a JPEG whose EOI marker is missing", async () => {
    const cutJpeg = TINY_JPEG_BYTES.slice(0, TINY_JPEG_BYTES.length - 2);
    await expect(
      validateImageFile(makeFile(cutJpeg, "cut.jpg", "image/jpeg")),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid-data",
      message: IMAGE_REJECT_MESSAGES.invalidData,
    });
  });

  it("rejects when the browser decoder cannot decode the bytes", async () => {
    // The reported 400 path: a PNG-looking payload Chromium itself refuses to
    // decode (no magic/tail check can catch it).
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("Invalid image")),
    );

    await expect(
      validateImageFile(makeFile(TINY_PNG_BYTES, "bad.png", "image/png")),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid-data",
      message: IMAGE_REJECT_MESSAGES.invalidData,
    });
  });

  it("accepts when the browser decoder succeeds", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ close, width: 1, height: 1 }),
    );

    await expect(
      validateImageFile(makeFile(TINY_PNG_BYTES, "a.png", "image/png")),
    ).resolves.toEqual({ ok: true });
    expect(close).toHaveBeenCalled();
  });

  it("falls back to byte checks when the host has no image decoder", async () => {
    expect(
      (globalThis as Record<string, unknown>).createImageBitmap,
    ).toBeUndefined();

    await expect(
      validateImageFile(makeFile(TINY_PNG_BYTES, "a.png", "image/png")),
    ).resolves.toEqual({ ok: true });
  });
});
