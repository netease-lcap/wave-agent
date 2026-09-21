/**
 * Outbound image budget: the size we deliberately keep every image under before
 * it goes into a request body, and the arithmetic / wording around it.
 *
 * ## Why a budget on top of the gateway bound
 *
 * `imageDimensions.ts` documents the gateway's *hard* bound (8192px per side):
 * exceeding it fails the whole request, so it must never be crossed. This module
 * is a second, tighter bound we impose on ourselves, aligned with Claude Code —
 * 2000px per side and 5 MB of base64 payload ({@link OUTBOUND_IMAGE_MAX_BASE64_BYTES},
 * their `API_IMAGE_MAX_BASE64_SIZE`). Images inside the budget are sent
 * byte-for-byte; images outside it are re-encoded by `imageRewrite.ts` (via
 * sharp) and only fall back to the "omitted" note when no codec is available.
 *
 * Two consequences worth keeping in mind:
 *
 * - The budget is ours, not the gateway's — it is deliberately conservative and
 *   may make a 3000px screenshot slightly softer. Raise it whenever we want
 *   more fidelity; nothing upstream depends on the exact value.
 * - The byte budget is expressed twice, in the two units that matter: base64
 *   characters (what the request actually carries) and raw bytes (what an
 *   encoder produces). Base64 inflates by 4/3, so bytes-on-the-wire = raw * 4/3,
 *   i.e. raw = base64 * 3/4 — see {@link OUTBOUND_IMAGE_TARGET_RAW_BYTES}.
 *
 * ## Why raw bytes, not the whole data URL
 *
 * A data URL is `data:<mime>;base64,<payload>` — the prefix is metadata and is
 * not part of the encoded image. Measuring the whole string would make the
 * budget depend on the mime string's length and would reject images that are
 * actually within budget; {@link rawBytesFromDataUrl} measures the payload only.
 *
 * This module holds no image codec and must stay dependency-free so it can be
 * imported from anywhere in the SDK.
 */
import { OUTBOUND_IMAGE_MAX_DIMENSION_PX } from "../constants/images.js";
import { exceedsMaxDimension } from "./imageDimensions.js";
import type { ImageDimensions } from "./imageDimensions.js";

/**
 * Client-side per-side dimension budget (Claude Code's `IMAGE_MAX_WIDTH` /
 * `IMAGE_MAX_HEIGHT`). Distinct from — and much tighter than — the gateway's
 * hard bound in `imageDimensions.ts`. The value itself lives in
 * `constants/images.ts` so the webview paste path can share it instead of
 * keeping a copy that could drift; re-exported here because this is the module
 * every outbound-image caller already imports.
 */
export { OUTBOUND_IMAGE_MAX_DIMENSION_PX };

/**
 * Maximum base64 payload we are willing to put in a request, counting only the
 * characters after the `,` in the data URL. Aligned with Claude Code's
 * `API_IMAGE_MAX_BASE64_SIZE`.
 */
export const OUTBOUND_IMAGE_MAX_BASE64_BYTES = 5 * 1024 * 1024;

/**
 * The same budget in raw bytes: `5 MiB * 3 / 4`. Encoders produce raw bytes, so
 * comparing their output against this number is equivalent to comparing the
 * resulting base64 against {@link OUTBOUND_IMAGE_MAX_BASE64_BYTES} — it keeps
 * the input side and the output side of the ladder on one scale.
 */
export const OUTBOUND_IMAGE_TARGET_RAW_BYTES =
  (OUTBOUND_IMAGE_MAX_BASE64_BYTES * 3) / 4;

/**
 * Length of the base64 payload of a data URL, ignoring the `data:<mime>;base64,`
 * prefix. A string without a comma is treated as bare payload.
 */
function base64PayloadLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl.length : dataUrl.length - comma - 1;
}

/**
 * Raw (decoded) byte count implied by a data URL's base64 payload — the inverse
 * of the 4/3 base64 inflation. Padding makes this overstate the real payload by
 * at most 2 bytes, which errs toward rewriting an image slightly before it
 * actually has to.
 */
export function rawBytesFromDataUrl(dataUrl: string): number {
  return Math.floor((base64PayloadLength(dataUrl) * 3) / 4);
}

/**
 * Whether an image must be rewritten before it can be sent: it carries more
 * base64 than the byte budget, or (when the container header gave us
 * dimensions) exceeds the per-side budget.
 *
 * Unknown dimensions never count as oversized — see `imageDimensions.ts`; a
 * header we cannot parse means "unknown", not "too big".
 */
export function exceedsOutboundBudget(
  dataUrl: string,
  dimensions?: ImageDimensions,
): boolean {
  if (rawBytesFromDataUrl(dataUrl) > OUTBOUND_IMAGE_TARGET_RAW_BYTES) {
    return true;
  }
  if (
    dimensions &&
    exceedsMaxDimension(dimensions, OUTBOUND_IMAGE_MAX_DIMENSION_PX)
  ) {
    return true;
  }
  return false;
}

/**
 * Note appended after a rewritten image so the model can map what it sees back
 * to the original pixels — the same contract as Claude Code's
 * `createImageMetadataText` (`src/utils/imageResizer.ts`). Kept verbatim in
 * shape: original size, displayed size, and the factor to multiply by.
 *
 * `fit: "inside"` scales both sides by one factor, so a single ratio (taken
 * from whichever side shrank more, to stay correct under rounding) applies.
 * Callers only append it when the dimensions actually changed.
 */
export function resizedImageNote(
  original: ImageDimensions,
  displayed: ImageDimensions,
): string {
  const ratio = Math.max(
    original.width / displayed.width,
    original.height / displayed.height,
  );
  return (
    `[Image: original ${original.width}x${original.height}, displayed at ` +
    `${displayed.width}x${displayed.height}. Multiply coordinates by ` +
    `${ratio.toFixed(2)} to map to the original image.]`
  );
}
