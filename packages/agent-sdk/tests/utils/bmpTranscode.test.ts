import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The codec is faked here on purpose: this suite pins the decisions the decoder
 * makes (magic gate, row order, channel count, every "keep the BMP" outcome)
 * without a native module in the loop. The real codec is exercised in
 * `bmpTranscode.sharp.test.ts`.
 *
 * `createRequire` is the mount point `getImageProcessor` resolves through, so
 * replacing it is also what lets `probe.calls` see whether the codec was touched
 * at all.
 */
const probe = vi.hoisted(() => {
  const state: {
    pngBytes: Buffer;
    calls: { input: Buffer; options?: { raw?: unknown } }[];
    failResolution: boolean;
    failEncode: boolean;
    fakeSharp: unknown;
  } = {
    pngBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    calls: [],
    failResolution: false,
    failEncode: false,
    fakeSharp: undefined,
  };

  state.fakeSharp = Object.assign(
    (input: Buffer, options?: { raw?: unknown }) => {
      state.calls.push({ input, options });
      return {
        png: () => ({
          toBuffer: async () => {
            if (state.failEncode) throw new Error("encode exploded");
            return state.pngBytes;
          },
        }),
      };
    },
    { versions: { vips: "8.18.6" } },
  );

  return state;
});

vi.mock("node:module", () => ({
  createRequire: () => (id: string) => {
    if (probe.failResolution) throw new Error(`Cannot find module '${id}'`);
    return probe.fakeSharp;
  },
}));

import { transcodeBmpToPng } from "../../src/utils/bmpTranscode.js";
import { resetImageProcessor } from "../../src/utils/imageProcessor.js";

afterEach(() => {
  resetImageProcessor();
  probe.calls.length = 0;
  probe.failResolution = false;
  probe.failEncode = false;
});

interface BmpOptions {
  width: number;
  height: number;
  bitCount: 24 | 32;
  /** Rows stored top-down (`false`) instead of the default bottom-up. */
  bottomUp?: boolean;
  /**
   * Per-row BGR(A) bytes in *display* order (row 0 = top), `width * bytesPerPixel`
   * entries per row. Defaults to a per-column gradient.
   */
  pixels?: number[][];
  /** Overrides the `BI_RGB` compression field, so unsupported variants can be built. */
  compression?: number;
}

/**
 * Build a real BITMAPFILEHEADER + BITMAPINFOHEADER + pixel rows (including the
 * 4-byte row padding), so the decoder is tested against the on-disk layout rather
 * than against a fixture that already agrees with it.
 */
function makeBmp({
  width,
  height,
  bitCount,
  bottomUp = true,
  pixels,
  compression = 0,
}: BmpOptions): Buffer {
  const bytesPerPixel = bitCount / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const imageBytes = Buffer.alloc(rowStride * height);

  for (let y = 0; y < height; y++) {
    const sourceRow = pixels?.[y];
    const rowOffset = (bottomUp ? height - 1 - y : y) * rowStride;
    for (let x = 0; x < width; x++) {
      const valueAt = (index: number): number =>
        sourceRow === undefined
          ? // Column/row-dependent gradient: a transposed or flipped image shows.
            ([0x10 + x * 8, 0x40 + y * 8, 0x90][index] ?? 0)
          : (sourceRow[x * bytesPerPixel + index] ?? 0);
      for (let index = 0; index < bytesPerPixel; index++) {
        imageBytes[rowOffset + x * bytesPerPixel + index] = valueAt(index);
      }
    }
  }

  const pixelOffset = 14 + 40;
  const header = Buffer.alloc(pixelOffset);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(pixelOffset + imageBytes.length, 2);
  header.writeUInt32LE(pixelOffset, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(bottomUp ? height : -height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(bitCount, 28);
  header.writeUInt32LE(compression, 30);
  header.writeUInt32LE(imageBytes.length, 34);

  return Buffer.concat([header, imageBytes]);
}

describe("transcodeBmpToPng", () => {
  it("feeds the decoded pixels to the codec and returns its PNG", async () => {
    const bmp = makeBmp({ width: 3, height: 2, bitCount: 24 });

    const png = await transcodeBmpToPng(bmp);

    expect(png).toBe(probe.pngBytes);
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0].options).toEqual({
      raw: { width: 3, height: 2, channels: 3 },
    });
    // Row padding is dropped: 3x2 pixels arrive as tightly packed RGB.
    expect(probe.calls[0].input).toHaveLength(3 * 2 * 3);
  });

  it("reverses bottom-up rows and swaps BGR back to RGB", async () => {
    const bmp = makeBmp({
      width: 2,
      height: 2,
      bitCount: 24,
      pixels: [
        // Top row: pure red then pure green, stored BGR on disk.
        [0, 0, 255, 0, 255, 0],
        // Bottom row: pure blue then white.
        [255, 0, 0, 255, 255, 255],
      ],
    });

    await transcodeBmpToPng(bmp);

    expect(Array.from(probe.calls[0].input)).toEqual([
      // Display order, RGB: red, green, blue, white.
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
  });

  it("honours a negative height (top-down rows)", async () => {
    const bmp = makeBmp({
      width: 1,
      height: 2,
      bitCount: 24,
      bottomUp: false,
      pixels: [
        [0, 0, 255],
        [255, 0, 0],
      ],
    });

    await transcodeBmpToPng(bmp);

    expect(Array.from(probe.calls[0].input)).toEqual([255, 0, 0, 0, 0, 255]);
  });

  it("drops the unused fourth byte of a 32-bit pixel instead of reading it as alpha", async () => {
    // A BI_RGB 32-bit pixel leaves the high byte unused, and it is 0 in practice;
    // read as alpha it would make every such image fully transparent.
    const bmp = makeBmp({
      width: 1,
      height: 1,
      bitCount: 32,
      pixels: [[0x30, 0x20, 0x10, 0x00]],
    });

    await transcodeBmpToPng(bmp);

    expect(probe.calls[0].options).toEqual({
      raw: { width: 1, height: 1, channels: 3 },
    });
    expect(Array.from(probe.calls[0].input)).toEqual([0x10, 0x20, 0x30]);
  });

  it("leaves a non-BMP buffer alone", async () => {
    // A real PNG, and — the case that actually pins the magic gate — a buffer
    // with a BMP-shaped body and a foreign two-byte header. Without the gate the
    // second one decodes and encodes happily, so "not a BMP" has to be more than
    // "the header parse happened to fail".
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const foreignMagic = makeBmp({ width: 2, height: 2, bitCount: 24 });
    foreignMagic[0] = 0x89;
    foreignMagic[1] = 0x50;

    expect(await transcodeBmpToPng(png)).toBeUndefined();
    expect(await transcodeBmpToPng(foreignMagic)).toBeUndefined();
    // Not even the codec is touched: the magic gate comes first.
    expect(probe.calls).toHaveLength(0);
  });

  it("returns undefined for a BMP variant it does not decode", async () => {
    // A palette-indexed (8-bit) BMP needs the colour table, RLE needs a decoder.
    const eightBit = makeBmp({ width: 2, height: 2, bitCount: 24 });
    eightBit.writeUInt16LE(8, 28);
    const rle = makeBmp({ width: 2, height: 2, bitCount: 24, compression: 1 });

    expect(await transcodeBmpToPng(eightBit)).toBeUndefined();
    expect(await transcodeBmpToPng(rle)).toBeUndefined();
    expect(probe.calls).toHaveLength(0);
  });

  it("returns undefined for a truncated BMP", async () => {
    const bmp = makeBmp({ width: 4, height: 4, bitCount: 24 });

    // Shorter than both headers.
    expect(await transcodeBmpToPng(bmp.subarray(0, 40))).toBeUndefined();
    // Headers intact, pixel rows cut short.
    expect(await transcodeBmpToPng(bmp.subarray(0, 60))).toBeUndefined();
    expect(probe.calls).toHaveLength(0);
  });

  it("returns undefined when no image codec is installed", async () => {
    probe.failResolution = true;

    expect(
      await transcodeBmpToPng(makeBmp({ width: 2, height: 2, bitCount: 24 })),
    ).toBeUndefined();
    expect(probe.calls).toHaveLength(0);
  });

  it("returns undefined instead of throwing when the encode fails", async () => {
    probe.failEncode = true;

    expect(
      await transcodeBmpToPng(makeBmp({ width: 2, height: 2, bitCount: 24 })),
    ).toBeUndefined();
    expect(probe.calls).toHaveLength(1);
  });
});
