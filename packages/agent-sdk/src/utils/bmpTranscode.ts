/**
 * BMP → PNG for images that came off the clipboard.
 *
 * ## Why this exists
 *
 * The Linux clipboard reader can fetch an image as PNG or BMP (`image/bmp` is one
 * of the two types Claude Code saves), but the model APIs take jpeg / png / gif /
 * webp only — so a BMP-only clipboard is read "successfully" and then rejected
 * downstream. Claude Code rewrites the bytes it just read (`bin@323223290`):
 *
 * ```js
 * let l = await se().readFileBytes(m);
 * if (l.length >= 2 && l[0] === 66 && l[1] === 77)
 *   l = await (await UX())(l).png().toBuffer();
 * ```
 *
 * `UX` there is **not** sharp: it resolves to `Ne`, which builds a `Bun.Image`
 * (`typeof Bun.Image !== "function"` → "This runtime has no Bun.Image"). That is
 * how BMP gets decoded on their side — Bun's own codec, not libvips.
 *
 * ## Why the header is parsed here
 *
 * sharp 0.35.4's prebuilt libvips 8.18.6 has **no BMP loader**:
 * `sharp.format.bmp` is `undefined`, `sharp.format.magick.input.buffer` is
 * `false`, and `sharp(bmpBytes)` rejects with "Input buffer contains unsupported
 * image format" — verified against both a hand-built and a PIL-produced BMP. It
 * can still *encode*: raw pixels in, PNG out. So this module does the smallest
 * amount of work that opens that door — read the two headers, un-stride the
 * rows, hand sharp `{ raw: { width, height, channels } }`.
 *
 * ## Failure means "keep the BMP", not "fail the paste"
 *
 * {@link transcodeBmpToPng} answers `undefined` for a non-BMP buffer, an
 * unsupported BMP variant, a missing codec, or a failed encode. Callers then keep
 * the file they already have, so a missing sharp (normal in a host process) costs
 * a BMP that the API layer rejects loudly instead of a paste that silently
 * reports "no image in clipboard".
 *
 * Coverage is uncompressed (`BI_RGB`) 24- and 32-bit input — what clipboard
 * sources actually produce (GIMP, LibreOffice, screenshot tools). Palette, RLE
 * and bitfield variants fall into the "keep the BMP" path.
 */
import { logger } from "./globalLogger.js";
import { getImageProcessor } from "./imageProcessor.js";

/** First two bytes of every BMP: `"BM"` (0x42 0x4d). */
const BMP_MAGIC_BYTE_0 = 0x42;
const BMP_MAGIC_BYTE_1 = 0x4d;

/** BITMAPFILEHEADER that precedes the info header. */
const FILE_HEADER_BYTES = 14;
/** BITMAPINFOHEADER (40-byte variant) — the shortest one that carries
 *  width / height / bit count / compression at fixed offsets. */
const INFO_HEADER_MIN_BYTES = 40;
/** `BI_RGB`: uncompressed, pixels stored as BGR rows. */
const COMPRESSION_BI_RGB = 0;

interface DecodedBmp {
  width: number;
  height: number;
  /** Tightly packed RGB, `width * height * 3` bytes. */
  pixels: Buffer;
}

/** `"BM"` — the two-byte magic every BMP starts with. */
function isBmpBuffer(input: Buffer): boolean {
  return (
    input.length >= 2 &&
    input[0] === BMP_MAGIC_BYTE_0 &&
    input[1] === BMP_MAGIC_BYTE_1
  );
}

/**
 * Decode an uncompressed BMP into tightly-packed RGB pixels, or `undefined` when
 * the variant is not one this decoder handles.
 *
 * Rows are stored bottom-up by default and padded to a 4-byte boundary; both are
 * undone here so the caller only ever sees `width * height * 3` bytes.
 */
function decodeBmpToRgb(input: Buffer): DecodedBmp | undefined {
  if (input.length < FILE_HEADER_BYTES + INFO_HEADER_MIN_BYTES)
    return undefined;

  const pixelOffset = input.readUInt32LE(10);
  const infoHeaderBytes = input.readUInt32LE(14);
  if (infoHeaderBytes < INFO_HEADER_MIN_BYTES) return undefined;

  const width = input.readInt32LE(18);
  const signedHeight = input.readInt32LE(22);
  const bottomUp = signedHeight > 0;
  const height = Math.abs(signedHeight);
  const bitCount = input.readUInt16LE(28);
  const compression = input.readUInt32LE(30);

  if (width <= 0 || height <= 0) return undefined;
  // 24 and 32 bits per pixel are the only depths clipboard sources emit. Narrower
  // depths are palette-indexed (they need the colour table) and RLE / bitfield
  // variants change the pixel layout, so all of those stay "keep the BMP".
  if (bitCount !== 24 && bitCount !== 32) return undefined;
  if (compression !== COMPRESSION_BI_RGB) return undefined;

  const bytesPerPixel = bitCount / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (pixelOffset + rowStride * height > input.length) return undefined;

  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const sourceRow = bottomUp ? height - 1 - y : y;
    let source = pixelOffset + sourceRow * rowStride;
    let target = y * width * 3;
    for (let x = 0; x < width; x++) {
      // BGR(A) on disk, RGB in memory. The fourth byte of a 32-bit BI_RGB pixel
      // is documented as unused and is 0 in practice, so reading it as alpha
      // would turn every such image fully transparent — it is dropped instead.
      pixels[target] = input[source + 2];
      pixels[target + 1] = input[source + 1];
      pixels[target + 2] = input[source];
      source += bytesPerPixel;
      target += 3;
    }
  }

  return { width, height, pixels };
}

/**
 * Rewrite a BMP buffer as PNG, or `undefined` when that cannot be done here:
 * not a BMP, an unsupported BMP variant, no usable image codec, or an encode
 * failure. Never throws — a paste, and the turn behind it, must keep going.
 */
export async function transcodeBmpToPng(
  input: Buffer,
): Promise<Buffer | undefined> {
  if (!isBmpBuffer(input)) return undefined;

  const decoded = decodeBmpToRgb(input);
  if (decoded === undefined) return undefined;

  const sharp = getImageProcessor();
  if (sharp === undefined) return undefined;

  const { width, height, pixels } = decoded;
  try {
    return await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
  } catch (error) {
    logger.warn("Failed to transcode a BMP image to PNG:", error);
    return undefined;
  }
}
