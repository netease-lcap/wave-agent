/**
 * Lazy access to the optional `sharp` image codec.
 *
 * ## Why lazy, and why a runtime require
 *
 * `sharp` must never be pulled in by a plain `import`:
 *
 * - It is a native module — its wrapper does `require("../src/build/Release/
 *   sharp-<platform>.node")` *relative to its own directory* and falls back to
 *   `@img/sharp-<platform>/sharp.node`. Bundlers therefore cannot inline it, and
 *   a top-level import would drag a `.node` file into every host bundle.
 * - It is optional. Host processes (the desktop main process, the IDE extension
 *   hosts) load the SDK barrel without a platform build present; evaluating
 *   `require("sharp")` there would throw during module evaluation and take the
 *   host down. Same rule as `utils/ripgrep.ts`, but stricter: `rgPath` resolves
 *   eagerly (a broken install then only affects grep), while an image codec must
 *   degrade per-request.
 *
 * So resolution happens on first use, through `createRequire(import.meta.url)`
 * — a *runtime* require the host-bundle scanner does not match (it looks for
 * literal `require("<bare specifier>")` calls), keeping the CLI bundle free of
 * both the module and a load-time dependency on it.
 *
 * ## Failure memory
 *
 * The result (including "unavailable") is memoised for the life of the process,
 * so a missing codec costs one failed resolution rather than one per image.
 * Because a first-use failure is often just "the installer has not finished
 * yet", the installer calls {@link resetImageProcessor} after it drops files on
 * disk so the next turn can pick them up.
 */
import { createRequire } from "node:module";
import { logger } from "./globalLogger.js";

export interface SharpMetadata {
  width?: number;
  height?: number;
  /** Container format, e.g. `png` / `jpeg` / `webp` / `gif` / `svg`. */
  format?: string;
  hasAlpha?: boolean;
}

/**
 * The slice of sharp's chainable API this codebase uses. Structural typing keeps
 * the SDK compiling without sharp's own types (and without a dependency on a
 * package that may not be installed).
 */
export interface SharpImage {
  metadata(): Promise<SharpMetadata>;
  resize(
    width: number,
    height: number,
    options?: { fit?: "inside"; withoutEnlargement?: boolean },
  ): SharpImage;
  png(options?: { compressionLevel?: number; palette?: boolean }): SharpImage;
  webp(options?: { quality?: number }): SharpImage;
  jpeg(options?: { quality?: number }): SharpImage;
  flatten(options?: {
    background?: { r: number; g: number; b: number };
  }): SharpImage;
  toBuffer(): Promise<Buffer>;
}

export interface SharpFactory {
  (input: Buffer): SharpImage;
  /** Populated at require time; `vips` doubles as a "the native side loaded" check. */
  versions?: { vips?: string };
}

let cached: SharpFactory | undefined;
let resolutionAttempted = false;

/**
 * Require sharp and check it is usable. Never throws: an absent package, a
 * missing platform build, a failed `dlopen` all come back as `undefined`, with
 * the underlying error logged once so an operator can tell the three apart.
 *
 * `requireFn` is injectable so tests can exercise every outcome without the real
 * module.
 */
export function resolveSharp(requireFn: NodeRequire): SharpFactory | undefined {
  try {
    const loaded: unknown = requireFn("sharp");
    if (typeof loaded !== "function") {
      logger.warn("sharp resolved to a non-callable value; image resizing off");
      return undefined;
    }
    const factory = loaded as SharpFactory;
    if (typeof factory.versions?.vips !== "string") {
      logger.warn(
        "sharp loaded without a libvips version; the native build is unusable",
      );
      return undefined;
    }
    return factory;
  } catch (error) {
    logger.warn("sharp is unavailable, images will not be resized:", error);
    return undefined;
  }
}

/**
 * The image codec, or `undefined` when this process cannot resize images.
 * Resolved once on first call — callers on a hot path pay a single boolean
 * check after that.
 */
export function getImageProcessor(): SharpFactory | undefined {
  if (!resolutionAttempted) {
    resolutionAttempted = true;
    cached = resolveSharp(createRequire(import.meta.url));
  }
  return cached;
}

/**
 * Forget the memoised result so the next {@link getImageProcessor} resolves
 * again. Called by the runtime-dependency installer once sharp is on disk —
 * without it a process that asked for a codec *before* the download finished
 * would keep degrading for its whole lifetime. Also used by tests.
 */
export function resetImageProcessor(): void {
  cached = undefined;
  resolutionAttempted = false;
}
