import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { transcodeBmpToPng } from "../../src/utils/bmpTranscode.js";
import {
  resetImageProcessor,
  resolveSharp,
} from "../../src/utils/imageProcessor.js";
import type { SharpFactory } from "../../src/utils/imageProcessor.js";

/**
 * The real codec, end to end. The fake-codec suite next door pins the decoder's
 * decisions; this one proves those decisions compose with sharp — that raw RGB
 * submitted through `{ raw }` really is accepted, that the container written is
 * PNG, and that the pixels survive the round trip.
 *
 * This matters because the prebuilt libvips has **no BMP loader**
 * (`sharp.format.bmp` is `undefined`), so the decode step cannot be skipped here:
 * if the header parsing or the channel count were wrong, `sharp()` would reject
 * or the colours would come out swapped and no other test would notice.
 *
 * Skipped only where sharp cannot load at all (unsupported libc, a stripped
 * platform package) — same gate as `imageRewrite.sharp.test.ts`.
 */
const sharp: SharpFactory | undefined = resolveSharp(
  createRequire(import.meta.url),
);

/** The extra sharp calls this suite needs; production code never uses them. */
interface SharpDecode {
  raw(): SharpDecode;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Buffer;
    info: { width: number; height: number; channels: number };
  }>;
}

const decode = sharp as unknown as (input: Buffer) => SharpDecode;

/**
 * A bottom-up, 4-byte-row-padded BMP. `rows` holds BGR triples in display order
 * so the expected RGB values can be read straight off the fixture; 32-bit output
 * gets a zero alpha byte, which is what real BI_RGB sources write.
 */
function makeBmp(rows: number[][], bitCount: 24 | 32): Buffer {
  const height = rows.length;
  const width = rows[0].length / 3;
  const bytesPerPixel = bitCount / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const imageBytes = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      const pixel = rowOffset + x * bytesPerPixel;
      imageBytes[pixel] = rows[y][x * 3];
      imageBytes[pixel + 1] = rows[y][x * 3 + 1];
      imageBytes[pixel + 2] = rows[y][x * 3 + 2];
      if (bytesPerPixel === 4) imageBytes[pixel + 3] = 0;
    }
  }

  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54 + imageBytes.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(bitCount, 28);
  header.writeUInt32LE(imageBytes.length, 34);
  return Buffer.concat([header, imageBytes]);
}

/** BGR triples, top row first: red, green / blue, white. */
const ROWS = [
  [0, 0, 255, 0, 255, 0],
  [255, 0, 0, 255, 255, 255],
];
const EXPECTED_RGB = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];

describe.skipIf(!sharp)("transcodeBmpToPng with the real codec", () => {
  beforeAll(() => {
    // The loader memoises per process; make sure this suite gets its own resolve.
    resetImageProcessor();
  });

  it("writes a decodable PNG with the BMP's dimensions and pixels", async () => {
    const png = await transcodeBmpToPng(makeBmp(ROWS, 24));

    expect(png).toBeDefined();
    const bytes = png as Buffer;
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const metadata = await (sharp as SharpFactory)(bytes).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(2);

    const { data, info } = await decode(bytes).raw().toBuffer({
      resolveWithObject: true,
    });
    expect(info).toMatchObject({ width: 2, height: 2, channels: 3 });
    expect(Array.from(data)).toEqual(EXPECTED_RGB);
  });

  it("keeps a 32-bit BI_RGB image opaque", async () => {
    // The fourth byte is unused (0 here); read as alpha the PNG below would come
    // out fully transparent.
    const png = await transcodeBmpToPng(makeBmp(ROWS, 32));

    expect(png).toBeDefined();
    const bytes = png as Buffer;
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const metadata = await (sharp as SharpFactory)(bytes).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 2, height: 2 });
    expect(metadata.hasAlpha).toBeFalsy();

    const { data } = await decode(bytes).raw().toBuffer({
      resolveWithObject: true,
    });
    expect(Array.from(data)).toEqual(EXPECTED_RGB);
  });
});
