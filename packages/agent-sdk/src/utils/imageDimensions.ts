/**
 * Image dimensions probed from the container header, plus the gateway's
 * per-side dimension limit.
 *
 * ## Why this exists
 *
 * The model gateway (codechat → vision model) rejects any image whose width
 * **or** height exceeds `MAX_IMAGE_DIMENSION_PX`, answering with a misleading
 * generic message:
 *
 *     HTTP 400 upstream_error:
 *     .messages[N].image[0]: You have uploaded an unsupported image. Please
 *     make sure your image is valid and has one of the following formats:
 *     webp, png, jpeg, and gif.
 *
 * Live probes against `https://codechat.codewave.163.com/api/v1/chat/completions`
 * (model `deepseek-flash`, single user message, `stream: true`, 2026-09-20)
 * pinned the trigger down to that single dimension — everything else is
 * irrelevant:
 *
 * | image            | px       | per-side | bytes    | result |
 * |------------------|----------|----------|----------|--------|
 * | 8192x1500        | 12.3 MP  | 8192     | 2.5 MB   | 200    |
 * | 8193x1500        | 12.3 MP  | 8193     | 2.5 MB   | **400** |
 * | 2250x8192        | 18.4 MP  | 8192     | 4.3 MB   | 200    |
 * | 1500x8193        | 12.3 MP  | 8193     | 3.5 MB   | **400** |
 * | 2250x9500        | 21.4 MP  | 9500     | 4.8 MB   | **400** |
 * | 2250x15474       | 34.8 MP  | 15474    | 6.0 MB   | **400** |
 * | 7000x4000        | 28.0 MP  | 7000     | 5.3 MB   | 200    |
 * | 11000x1500       | 16.5 MP  | 11000    | 2.9 MB   | **400** |
 * | 1500x1500 noise  | 2.3 MP   | 1500     | 6.8 MB (9.0 MB base64) | 200 |
 * | 2250x12000 JPEG  | 27.0 MP  | 12000    | 2.1 MB   | **400** |
 * | 2250x12000 WebP  | 27.0 MP  | 12000    | 1.3 MB   | **400** |
 *
 * So: pixel count does **not** matter (28 MP passes, 16.5 MP fails), byte
 * size / request body size does **not** matter (a 6.8 MB PNG passes, a 1.3 MB
 * WebP fails), and the container format does **not** matter (PNG/JPEG/WebP at
 * the same dimensions all fail). The bound is a hard integer comparison on
 * each side: exactly 8192 passes, 8193 fails.
 *
 * One caveat to keep in mind when re-testing: the probes above used
 * `stream: true`, which is the path wave itself uses (`createParams.stream`).
 * The identical body sent with `stream: false` returned 200 — the two gateway
 * paths do not behave the same, so a non-streaming probe reproduces nothing.
 *
 * ## Why the client has to handle it
 *
 * Neither wave nor the proxy rejects oversized images: the request reaches the
 * model and the whole turn fails with that 400. Outbound images come from
 * paths that cannot all be downsampled (e.g. the model itself reading a long
 * screenshot with the Read tool), so this module is the *detection* half:
 * callers skip the image and tell the model what to do instead.
 *
 * The paste path in `packages/webview/src/utils/imageValidation.ts` keeps its
 * own copy of `MAX_IMAGE_DIMENSION_PX` (a browser bundle cannot import this
 * module) and *downsamples* oversized pastes rather than skipping them. Update
 * both when the upstream bound changes.
 */
export const MAX_IMAGE_DIMENSION_PX = 8192;

export interface ImageDimensions {
  width: number;
  height: number;
}

/** JPEG frame headers (SOF0-SOF15) — the only segments carrying pixel size. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function startsWith(
  bytes: Uint8Array,
  signature: number[],
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4)
  if (bytes.length < 24) return undefined;
  if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return undefined; // "IHDR"
  const width =
    (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height =
    (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/** Walk the JPEG marker segments until the frame header (SOFn). */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2; // skip SOI
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // Padding fill bytes and standalone markers carry no length.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2) return undefined;
    if (SOF_MARKERS.has(marker)) {
      if (offset + 9 >= bytes.length) return undefined;
      const height = u16be(bytes, offset + 5);
      const width = u16be(bytes, offset + 7);
      if (width <= 0 || height <= 0) return undefined;
      return { width, height };
    }
    offset += 2 + length;
  }
  return undefined;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // "RIFF" <size> "WEBP" <fourcc> <chunk size> <chunk payload...>
  if (bytes.length < 20) return undefined;
  const fourcc = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );
  if (fourcc === "VP8X") {
    // Extended: 24-bit little-endian (value - 1) for each side.
    if (bytes.length < 30) return undefined;
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (fourcc === "VP8L") {
    if (bytes.length < 25) return undefined;
    if (bytes[20] !== 0x2f) return undefined;
    // 14 bits width-1, then 14 bits height-1, little-endian bit packing.
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (fourcc === "VP8 ") {
    if (bytes.length < 30) return undefined;
    // Lossy: 3-byte frame tag, then the 0x9d012a start code.
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
      return undefined;
    }
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  return undefined;
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // "GIF87a"/"GIF89a", then the logical screen descriptor.
  if (bytes.length < 10) return undefined;
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * Read the pixel dimensions straight out of the header. Supports the four
 * formats the gateway accepts (png / jpeg / gif / webp).
 *
 * Returns `undefined` when the format is unknown or the header is truncated —
 * callers must treat that as "unknown", never as "oversized".
 */
export function getImageDimensions(
  bytes: Uint8Array,
): ImageDimensions | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return pngDimensions(bytes);
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return jpegDimensions(bytes);
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return gifDimensions(bytes);
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return webpDimensions(bytes);
  }
  return undefined;
}

/**
 * Enough base64 to cover a header of any of the supported formats: PNG/WebP/GIF
 * live in the first ~30 bytes, JPEG's SOF segment follows the app segments —
 * a few KB at most (large EXIF/ICC blocks occasionally reach ~64 KB).
 */
const DATA_URL_PREFIX_B64_CHARS = Math.ceil((96 * 1024 * 4) / 3);

export function getImageDimensionsFromDataUrl(
  dataUrl: string,
): ImageDimensions | undefined {
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.startsWith("data:image/")) return undefined;
  const prefix = dataUrl.slice(
    comma + 1,
    comma + 1 + DATA_URL_PREFIX_B64_CHARS,
  );
  if (prefix.length === 0) return undefined;
  try {
    return getImageDimensions(Buffer.from(prefix, "base64"));
  } catch {
    return undefined;
  }
}

export function exceedsMaxDimension(
  dimensions: ImageDimensions,
  max: number = MAX_IMAGE_DIMENSION_PX,
): boolean {
  return dimensions.width > max || dimensions.height > max;
}

/**
 * One-line, actionable note that replaces an image the gateway would reject.
 * Modelled on opencode's `[N image omitted: ...]` placeholder: the model (and
 * anyone reading the transcript) gets the real size, the bound, and the way
 * out.
 */
export function omittedImageNote(
  dimensions: ImageDimensions,
  sourcePath?: string,
): string {
  const where = sourcePath ? ` Path: ${sourcePath}` : "";
  return (
    `[Image omitted: ${dimensions.width}x${dimensions.height} exceeds the ` +
    `${MAX_IMAGE_DIMENSION_PX}px per-side limit of the vision model gateway, ` +
    `which would reject the whole request. Crop it, split it into smaller ` +
    `images, or downscale it before sending again.${where}]`
  );
}
