/**
 * Send-time validation for pasted images (spec:
 * docs/specs/ui/image-pasting.md「发送前校验图片有效性」).
 *
 * Neither the clipboard pipeline nor the SDK inspects image bytes on the way
 * out: a clipboard `PNG` registration format holding garbage (Chromium passes
 * it through byte-for-byte) or a 0-byte/truncated file copied in the file
 * manager used to reach the model gateway as garbage — or as an empty
 * `data:image/png;base64,` payload — which the gateway answers with
 * `HTTP 400 ... You have uploaded an unsupported image`.
 *
 * The check is deliberately cheap and dependency-free:
 *   1. non-empty,
 *   2. magic-byte whitelist (png / jpeg / gif / webp),
 *   3. tail marker for the formats that carry one (catches truncation),
 *   4. a real decode by the host's own decoder (`createImageBitmap`), which is
 *      the only check that catches structurally-valid-looking garbage,
 *   5. a per-side dimension budget: anything longer than
 *      `MAX_IMAGE_DIMENSION_PX` on either side is downsampled here (canvas
 *      re-encode), so the paste enters the message already inside the budget —
 *      see the constant.
 *
 * Steps 4-5 need a Chromium-family host (desktop Electron / VS Code webview /
 * JetBrains JCEF all qualify). Hosts without the API (e.g. jsdom in unit
 * tests) fall back to the byte-level checks instead of rejecting everything —
 * an oversized image then takes the long way round and reaches the SDK, whose
 * outbound rewrite pass (packages/agent-sdk/src/utils/imageRewrite.ts, via
 * sharp) resizes it, or drops it with a note when no codec is available.
 */
import { OUTBOUND_IMAGE_MAX_DIMENSION_PX } from "wave-agent-sdk/constants";

export type SupportedImageFormat = "png" | "jpeg" | "gif" | "webp";

export type ImageRejectionReason =
  | "empty"
  | "unsupported-format"
  | "invalid-data";

export type ImageValidationResult =
  | {
      ok: true;
      /**
       * The image to send. Byte-identical to the pasted file when it is within
       * the dimension budget; a re-encoded copy when it was downsampled.
       */
      file: File;
      /** True only when the paste was re-encoded to fit the dimension budget. */
      downsampled: boolean;
    }
  | { ok: false; reason: ImageRejectionReason; message: string };

/**
 * Per-side pixel budget for a pasted image: anything longer on either side is
 * downsampled in the browser before it becomes part of a message.
 *
 * This is the very same number the SDK enforces on the way out
 * (`OUTBOUND_IMAGE_MAX_DIMENSION_PX`, Claude Code's `IMAGE_MAX_WIDTH` /
 * `IMAGE_MAX_HEIGHT`) and it is *imported*, not copied, so the paste gate and
 * the outbound gate cannot drift apart (the value lives in
 * packages/agent-sdk/src/constants/images.ts). Shrinking here buys three
 * things: the request path carries no re-encode work, no oversized image can
 * depend on the codec sharp installs on demand, and the paste is already
 * compliant when the user hits Enter.
 *
 * Do not confuse it with the gateway's *hard* bound —
 * `MAX_IMAGE_DIMENSION_PX` in packages/agent-sdk/src/utils/imageDimensions.ts
 * (8192px per side). That one is external and immovable: crossing it fails the
 * whole turn with `HTTP 400 ... You have uploaded an unsupported image`, which
 * is exactly why we stay far away from it. The probe table behind both numbers
 * lives in that same file.
 */
export const MAX_IMAGE_DIMENSION_PX = OUTBOUND_IMAGE_MAX_DIMENSION_PX;

/** JPEG quality used when a downsampled image is re-encoded as JPEG. */
const DOWNSAMPLE_JPEG_QUALITY = 0.92;

/**
 * A downsampled PNG larger than this is re-encoded as JPEG instead: PNG is
 * lossless but bulky, and a noisy screenshot can easily exceed this at 2000px.
 * Aligned with Claude Code's 5 MB base64 budget.
 */
const DOWNSAMPLE_PNG_MAX_BYTES = 5 * 1024 * 1024;

/** Only these four reach the model (the gateway rejects everything else). */
export const SUPPORTED_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export const IMAGE_REJECT_MESSAGES = {
  empty: "这张图片的数据为空（0 字节），请重新截图，或另存为 PNG / JPEG 后再试",
  invalidData:
    "这张图片的数据不完整或不是有效图片，请重新截图，或另存为 PNG / JPEG 后再试",
  unsupportedFormat:
    "只支持 PNG / JPEG / GIF / WebP 格式的图片，请转成这几种格式后再试",
} as const;

const HEAD_BYTES = 32;
/** Marker window: tolerates a few trailing bytes after the closing marker. */
const TAIL_BYTES = 32;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8
const PNG_END_MARKER = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
const JPEG_END_MARKER = [0xff, 0xd9]; // EOI

/** Known image formats we intentionally do not forward to the model. */
const KNOWN_UNSUPPORTED_SIGNATURES: number[][] = [
  [0x42, 0x4d], // BMP "BM"
  [0x49, 0x49, 0x2a, 0x00], // TIFF little-endian
  [0x4d, 0x4d, 0x00, 0x2a], // TIFF big-endian
];

function matchesAt(
  bytes: Uint8Array,
  signature: number[],
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function contains(bytes: Uint8Array, signature: number[]): boolean {
  for (let i = 0; i + signature.length <= bytes.length; i++) {
    if (matchesAt(bytes, signature, i)) return true;
  }
  return false;
}

/** HEIF/HEIC/AVIF share the ISO-BMFF box header ("ftyp" at offset 4). */
function isIsoBmffImage(bytes: Uint8Array): boolean {
  return matchesAt(
    bytes,
    [0x66, 0x74, 0x79, 0x70], // "ftyp"
    4,
  );
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes)
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

/**
 * Sniff the leading bytes. Returns a whitelisted format, `"other"` for a
 * positively-identified format we do not forward, or `null` when the bytes are
 * not recognizably an image at all.
 */
export function detectImageFormat(
  bytes: Uint8Array,
): SupportedImageFormat | "other" | null {
  if (matchesAt(bytes, PNG_SIGNATURE)) return "png";
  if (matchesAt(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (matchesAt(bytes, GIF_SIGNATURE)) return "gif";
  if (matchesAt(bytes, RIFF_SIGNATURE) && matchesAt(bytes, WEBP_SIGNATURE, 8)) {
    return "webp";
  }
  if (
    KNOWN_UNSUPPORTED_SIGNATURES.some((signature) =>
      matchesAt(bytes, signature),
    )
  ) {
    return "other";
  }
  if (isIsoBmffImage(bytes) || looksLikeSvg(bytes)) return "other";
  return null;
}

function reject(reason: ImageRejectionReason): ImageValidationResult {
  const message =
    reason === "empty"
      ? IMAGE_REJECT_MESSAGES.empty
      : reason === "unsupported-format"
        ? IMAGE_REJECT_MESSAGES.unsupportedFormat
        : IMAGE_REJECT_MESSAGES.invalidData;
  return { ok: false, reason, message };
}

/** Declared an image type the model cannot take (svg / bmp / avif / heic…). */
function declaresUnsupportedImageType(file: File): boolean {
  return (
    file.type.startsWith("image/") &&
    !SUPPORTED_IMAGE_MIME_TYPES.includes(file.type)
  );
}

async function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

interface DecodedImage {
  width: number;
  height: number;
  close?: () => void;
}

/**
 * Target size for an image longer than the budget, or `null` when it already
 * fits. Pure math so the boundary (2000 fits, 2001 does not) is testable
 * without a real decoder. `Math.floor` plus the clamp keep the result on the
 * safe side of the budget — rounding up would put the copy back over it — and
 * no extra margin is subtracted: the budget is a plain integer comparison and
 * 2000 itself is inside it on both axes.
 */
export function computeDownscaleTarget(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION_PX,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= max) return null;
  const scale = max / longest;
  return {
    width: Math.max(1, Math.min(max, Math.floor(width * scale))),
    height: Math.max(1, Math.min(max, Math.floor(height * scale))),
  };
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Canvas re-encode of an oversized image at `target` size. Returns `null` on
 * any failure (no 2d context, `toBlob` refused) — the caller then treats the
 * paste as invalid instead of sending something the gateway will reject.
 *
 * Transparency decides the container: only JPEG cannot carry an alpha channel,
 * so JPEG stays JPEG and everything else (png / gif / webp) is written as PNG.
 * Pixel-by-pixel transparency detection is deliberately not attempted — it
 * would mean touching every pixel of a 15k-tall screenshot for a format choice.
 */
async function downscaleImage(
  bitmap: DecodedImage,
  target: { width: number; height: number },
  sourceFormat: SupportedImageFormat,
): Promise<File | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(
      bitmap as unknown as CanvasImageSource,
      0,
      0,
      target.width,
      target.height,
    );

    const preferred = sourceFormat === "jpeg" ? "image/jpeg" : "image/png";
    let blob = await encodeCanvas(
      canvas,
      preferred,
      preferred === "image/jpeg" ? DOWNSAMPLE_JPEG_QUALITY : undefined,
    );
    if (
      preferred === "image/png" &&
      blob &&
      blob.size > DOWNSAMPLE_PNG_MAX_BYTES
    ) {
      const jpeg = await encodeCanvas(
        canvas,
        "image/jpeg",
        DOWNSAMPLE_JPEG_QUALITY,
      );
      if (jpeg) blob = jpeg;
    }
    if (!blob) return null;

    const extension = blob.type === "image/jpeg" ? "jpg" : "png";
    return new File([blob], `pasted-image.${extension}`, { type: blob.type });
  } catch {
    return null;
  }
}

/**
 * Validate one pasted image. Never throws: any failure is a rejection with a
 * user-facing Chinese message. An image inside the dimension budget is returned
 * byte-identical (`ok: true, downsampled: false`); a longer one is re-encoded
 * through canvas to fit the budget.
 */
export async function validateImageFile(
  file: File,
): Promise<ImageValidationResult> {
  if (file.size === 0) return reject("empty");

  const head = await readBytes(file.slice(0, HEAD_BYTES));
  const format = detectImageFormat(head);
  if (format === null || format === "other") {
    // Positively identified an unsupported format (or the file advertises one)
    // → tell the user to convert; otherwise the bytes are simply not an image.
    return reject(
      format === "other" || declaresUnsupportedImageType(file)
        ? "unsupported-format"
        : "invalid-data",
    );
  }

  const tail = await readBytes(file.slice(Math.max(0, file.size - TAIL_BYTES)));
  if (format === "png" && !contains(tail, PNG_END_MARKER)) {
    // Truncated PNG: header is real, the trailing IEND chunk is gone.
    return reject("invalid-data");
  }
  if (format === "jpeg" && !contains(tail, JPEG_END_MARKER)) {
    return reject("invalid-data");
  }

  const decode = (globalThis as { createImageBitmap?: unknown })
    .createImageBitmap;
  if (typeof decode === "function") {
    let bitmap: DecodedImage;
    try {
      bitmap = await (decode as (source: Blob) => Promise<DecodedImage>).call(
        globalThis,
        file,
      );
    } catch {
      return reject("invalid-data");
    }
    try {
      const target = computeDownscaleTarget(bitmap.width, bitmap.height);
      if (target) {
        const downsampled = await downscaleImage(bitmap, target, format);
        if (!downsampled) return reject("invalid-data");
        return { ok: true, file: downsampled, downsampled: true };
      }
    } finally {
      bitmap.close?.();
    }
  }

  return { ok: true, file, downsampled: false };
}
