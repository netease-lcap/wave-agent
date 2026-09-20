/**
 * Outbound image rewriting: decide whether an image can go into a request body
 * as it is, or must be re-encoded first.
 *
 * ## Where this sits
 *
 * `convertMessagesForAPI` is the single choke point every image passes through
 * on its way out (user attachments, tool results, Read-tool screenshots). This
 * module answers one question per image: send it (untouched, or rewritten) or
 * omit it with an explanatory note. The caller only wires the answer into the
 * message.
 *
 * ## The ladder
 *
 * Only images outside the budget (`imageBudget.ts`) touch the codec, which keeps
 * the common case — the model reads a normal-sized screenshot — free of any
 * native work and byte-identical.
 *
 * An over-budget image is re-encoded by walking two nested loops: the source is
 * first clamped to the dimension budget, then downscaled in steps (1 → 0.75 →
 * 0.5 → 0.25) and, at each step, encoded at several qualities. The first output
 * inside the raw-byte budget wins. Transparency drives the encoder order: alpha
 * sources try PNG/WebP first and only fall back to JPEG after flattening onto
 * white — a naive JPEG would turn transparent pixels black. JPEG sources skip
 * PNG entirely (re-encoding a photo as PNG would inflate it).
 *
 * An image that is only over the *byte* budget keeps its dimensions: scale 1
 * with the clamp being a no-op means "compress at full resolution", which is
 * what Claude Code does too, and the model's coordinates stay valid.
 *
 * A **fresh `sharp(buffer)` instance per rung** is mandatory, not stylistic:
 * sharp is chainable and a reused instance keeps returning the previous rung's
 * bytes (documented sharp behaviour, and the reason Claude Code's implementation
 * does the same).
 *
 * The output mime always comes from the rung that produced the bytes, never from
 * a hardcoded string — mislabelling a container is exactly the 400 root cause
 * fixed in `#2273`.
 *
 * ## Omission, not failure
 *
 * `planOutboundImage` never rejects and never throws: a turn must keep going.
 * Outcomes are `send` (possibly with a size note the model can use to map
 * coordinates back) or `omit` (with a note stating the real size and what to do
 * instead).
 */
import { statSync } from "node:fs";
import { LRUCache } from "lru-cache";
import { logger } from "./globalLogger.js";
import {
  OUTBOUND_IMAGE_MAX_DIMENSION_PX,
  OUTBOUND_IMAGE_TARGET_RAW_BYTES,
  exceedsOutboundBudget,
  resizedImageNote,
} from "./imageBudget.js";
import {
  exceedsMaxDimension,
  getImageDimensions,
  getImageDimensionsFromDataUrl,
  omittedImageNote,
} from "./imageDimensions.js";
import type { ImageDimensions } from "./imageDimensions.js";
import { getImageProcessor } from "./imageProcessor.js";
import type { SharpFactory, SharpImage } from "./imageProcessor.js";
import { ensureRuntimeDeps } from "./runtimeDeps.js";

export type OutboundImagePlan =
  | { kind: "send"; dataUrl: string; note?: string }
  | { kind: "omit"; note: string };

/**
 * Downscale steps tried in order. The floor keeps a pathological aspect ratio
 * (e.g. 20000x40) from collapsing to a zero-pixel edge.
 */
const SCALES = [1, 0.75, 0.5, 0.25];
const MIN_DIMENSION_PX = 64;
const JPEG_QUALITIES = [80, 60, 40, 20];
const WEBP_QUALITIES = [80, 60];
const PNG_COMPRESSION_LEVEL = 9;
const OPAQUE_BACKGROUND = { r: 255, g: 255, b: 255 };

interface Rung {
  /** Container the encoder actually produces, used verbatim in the data URL. */
  mime: string;
  encode: (image: SharpImage) => SharpImage;
}

const JPEG_RUNGS: Rung[] = JPEG_QUALITIES.map((quality) => ({
  mime: "image/jpeg",
  encode: (image) => image.jpeg({ quality }),
}));

/** Lossless first; `palette` narrows the colour depth when full PNG is too big. */
const PNG_RUNGS: Rung[] = [
  {
    mime: "image/png",
    encode: (image) => image.png({ compressionLevel: PNG_COMPRESSION_LEVEL }),
  },
  {
    mime: "image/png",
    encode: (image) =>
      image.png({ compressionLevel: PNG_COMPRESSION_LEVEL, palette: true }),
  },
];

const WEBP_RUNGS: Rung[] = WEBP_QUALITIES.map((quality) => ({
  mime: "image/webp",
  encode: (image) => image.webp({ quality }),
}));

/** Transparency survives the whole ladder; JPEG is a last resort, flattened white. */
const ALPHA_LADDER: Rung[] = [
  ...PNG_RUNGS,
  ...WEBP_RUNGS,
  {
    mime: "image/jpeg",
    encode: (image) =>
      image
        .flatten({ background: OPAQUE_BACKGROUND })
        .jpeg({ quality: JPEG_QUALITIES[0] }),
  },
];

const OPAQUE_LADDER: Rung[] = [...PNG_RUNGS, ...WEBP_RUNGS, ...JPEG_RUNGS];

function ladderFor(format: string | undefined, hasAlpha: boolean): Rung[] {
  // A photo is never improved by a lossless PNG pass; go straight to JPEG.
  if (format === "jpeg") return JPEG_RUNGS;
  if (hasAlpha) return ALPHA_LADDER;
  return OPAQUE_LADDER;
}

function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** Base64 payload of a data URL, without the `data:<mime>;base64,` prefix. */
function dataUrlBody(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Shrink both sides into the dimension budget, preserving aspect ratio. `fit:
 * "inside"` re-derives the ratio from the real image, so clamping each side
 * independently is correct (3000x2000 → 2000x1333, 1000x4000 → 500x2000).
 */
function clampToBudget(dimensions: ImageDimensions): ImageDimensions {
  return {
    width: Math.min(dimensions.width, OUTBOUND_IMAGE_MAX_DIMENSION_PX),
    height: Math.min(dimensions.height, OUTBOUND_IMAGE_MAX_DIMENSION_PX),
  };
}

type LadderOutcome =
  | { status: "fits"; dataUrl: string; dimensions?: ImageDimensions }
  /** Every rung is still over budget; the caller omits with the size it reports. */
  | { status: "exhausted"; sourceDimensions: ImageDimensions }
  /** Neither the header nor the codec could tell us the size — nothing to try. */
  | { status: "unknown-dimensions" };

/**
 * Walk the ladder until something fits the byte budget. Throws when the codec
 * itself fails (missing platform build, undecodable bytes) — the caller treats
 * that as "no codec".
 */
async function runLadder(
  sharp: SharpFactory,
  source: Buffer,
  knownDimensions: ImageDimensions | undefined,
): Promise<LadderOutcome> {
  const metadata = await sharp(source).metadata();
  const width = metadata.width ?? knownDimensions?.width ?? 0;
  const height = metadata.height ?? knownDimensions?.height ?? 0;
  if (width <= 0 || height <= 0) return { status: "unknown-dimensions" };

  const withinBudget = clampToBudget({ width, height });
  const rungs = ladderFor(metadata.format, metadata.hasAlpha === true);

  for (const scale of SCALES) {
    const targetWidth = Math.max(
      MIN_DIMENSION_PX,
      Math.floor(withinBudget.width * scale),
    );
    const targetHeight = Math.max(
      MIN_DIMENSION_PX,
      Math.floor(withinBudget.height * scale),
    );

    for (const rung of rungs) {
      const encoded = await rung
        .encode(
          sharp(source).resize(targetWidth, targetHeight, {
            fit: "inside",
            withoutEnlargement: true,
          }),
        )
        .toBuffer();
      if (encoded.length <= OUTBOUND_IMAGE_TARGET_RAW_BYTES) {
        return {
          status: "fits",
          dataUrl: toDataUrl(rung.mime, encoded),
          dimensions: getImageDimensions(encoded),
        };
      }
    }
  }
  return { status: "exhausted", sourceDimensions: { width, height } };
}

/**
 * Results keyed by the caller-supplied cache key, capped at a handful of
 * entries: every turn rebuilds the request body from the whole history, so
 * without a cache each turn would re-encode the same oversized screenshots.
 */
const rewritten = new LRUCache<string, OutboundImagePlan>({ max: 8 });

/** Drop cached rewrites (tests, and any future "the codec just appeared" reset). */
export function __resetImageRewriteCacheForTesting(): void {
  rewritten.clear();
}

/**
 * Cache key for an image that came from a local file: path plus size plus
 * mtime. Cheaper than hashing the bytes, and a rewritten file (different size or
 * mtime) gets a fresh entry instead of reusing a stale rewrite.
 */
export function imageFileCacheKey(path: string): string {
  try {
    const stat = statSync(path);
    return `${path}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return path;
  }
}

/**
 * The degradation path used whenever we could not even try to shrink the image
 * (no codec, codec failure, unknown size): an image the gateway would reject
 * anyway is omitted with an actionable note; anything the gateway can still take
 * is sent untouched, oversized bytes included — we have no way to shrink it, and
 * refusing it would break a turn that used to work.
 */
function degrade(
  dataUrl: string,
  dimensions: ImageDimensions | undefined,
  sourcePath: string | undefined,
  reason: string,
): OutboundImagePlan {
  if (dimensions && exceedsMaxDimension(dimensions)) {
    logger.warn(
      `Omitting oversized image (${reason}):`,
      dimensions,
      sourcePath,
    );
    return { kind: "omit", note: omittedImageNote(dimensions, sourcePath) };
  }
  logger.warn(`Sending image without rewriting (${reason}):`, sourcePath);
  return { kind: "send", dataUrl };
}

export interface OutboundImageInput {
  /** Data URL of the image (already base64, whatever its original source). */
  dataUrl: string;
  /** Cache identity: the data URL itself for inline images, path+size+mtime for files. */
  cacheKey: string;
  /** Local file the image came from, when it has one (used in notes). */
  sourcePath?: string;
}

/**
 * Decide what to send for one image. Never throws and never rejects — see the
 * module comment.
 */
export async function planOutboundImage(
  input: OutboundImageInput,
): Promise<OutboundImagePlan> {
  const { dataUrl, cacheKey, sourcePath } = input;
  const dimensions = getImageDimensionsFromDataUrl(dataUrl);

  if (!exceedsOutboundBudget(dataUrl, dimensions)) {
    return { kind: "send", dataUrl };
  }

  const cached = rewritten.get(cacheKey);
  if (cached) return cached;

  const plan = await rewrite(dataUrl, dimensions, sourcePath);
  rewritten.set(cacheKey, plan);
  return plan;
}

async function rewrite(
  dataUrl: string,
  dimensions: ImageDimensions | undefined,
  sourcePath: string | undefined,
): Promise<OutboundImagePlan> {
  const sharp = getImageProcessor();
  if (!sharp) {
    // Kick a download so a later turn has the codec; this turn still degrades
    // rather than blocking the request on ~8MB.
    void ensureRuntimeDeps();
    return degrade(dataUrl, dimensions, sourcePath, "no image codec available");
  }

  let outcome: LadderOutcome;
  try {
    outcome = await runLadder(
      sharp,
      Buffer.from(dataUrlBody(dataUrl), "base64"),
      dimensions,
    );
  } catch (error) {
    logger.warn("Image rewrite failed:", sourcePath, error);
    return degrade(dataUrl, dimensions, sourcePath, "the image codec failed");
  }

  if (outcome.status === "unknown-dimensions") {
    return degrade(
      dataUrl,
      dimensions,
      sourcePath,
      "its dimensions could not be determined",
    );
  }

  if (outcome.status === "exhausted") {
    // The codec ran out of rungs without fitting the budget (extreme aspect
    // ratios). The spec routes this to the same note as an unshrinkable
    // oversized image rather than sending something we know is over budget.
    logger.warn(
      "Omitting image that cannot fit the outbound budget:",
      outcome.sourceDimensions,
      sourcePath,
    );
    return {
      kind: "omit",
      note: omittedImageNote(outcome.sourceDimensions, sourcePath),
    };
  }

  const resizedTo = outcome.dimensions;
  const wasResized =
    dimensions !== undefined &&
    resizedTo !== undefined &&
    (dimensions.width !== resizedTo.width ||
      dimensions.height !== resizedTo.height);

  return {
    kind: "send",
    dataUrl: outcome.dataUrl,
    ...(wasResized ? { note: resizedImageNote(dimensions, resizedTo) } : {}),
  };
}
