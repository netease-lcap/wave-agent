/**
 * On-demand image preview for the remote-control page.
 *
 * ## Why this exists
 *
 * The phone cannot read files: message payloads have their image bytes stripped
 * before they cross the relay (`stdio/uiPayload.ts`), and the page has no file
 * system of its own. A screenshot an agent saved to disk (`/tmp/shot.png`) is
 * therefore just a path in the conversation — readable nowhere on the phone.
 * This module is the one thing that turns such a path back into pixels, on
 * demand, over the relay (spec `remote/remote-web.md`「点消息里的图片路径看原图」).
 *
 * ## The two gates
 *
 * 1. **Routing** — {@link IMAGE_FILE_EXTENSIONS} decides whether the *page*
 *    offers a click target at all. That is a UI concern: an extension is a hint,
 *    never proof.
 * 2. **Authorisation** — the bytes are decoded here, and only a real raster
 *    container is served (`ALLOWED_SOURCE_FORMATS`). A `/tmp/x.png` that is
 *    really a symlink to a text file dies at this gate. Nothing else in this
 *    path can tell the two apart, so collapsing these gates would turn a file
 *    name into an authorisation decision.
 *
 * Everything is read-only: no writes, no deletions, no path is ever echoed back
 * as something callable.
 *
 * ## Why the budget is not the frame budget
 *
 * {@link IMAGE_PREVIEW_MAX_RAW_BYTES} is the *image's* budget, derived from the
 * relay's single-frame limit: the frame covers a whole JSON envelope and base64
 * inflates bytes by 4/3, so the image has to fit in roughly three quarters of
 * it. An over-budget frame is silently dropped by the relay's 1 MiB subscriber
 * buffer, which would leave the phone with nothing — hence "shrink or report",
 * never "send it as-is".
 */
import { readFile, stat } from "node:fs/promises";
import { shrinkImageForTransport } from "wave-agent-sdk";
import { IMAGE_FILE_EXTENSIONS } from "wave-agent-sdk/constants";
import { REMOTE_MAX_FRAME_BYTES } from "./frameBudget.js";

/** Containers the codec must report before any bytes are served. */
const ALLOWED_SOURCE_FORMATS = new Set(["png", "jpeg", "gif", "webp"]);

/**
 * Refuse to pull an absurd file into memory before the codec gets a say. Well
 * above any real screenshot (an 8K PNG is ~20–30 MB) and well below "a video
 * file with a .png name".
 */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/**
 * Raw-byte budget for the image itself: leave a little of the frame for the
 * envelope's keys and the `data:<mime>;base64,` prefix, then undo base64's 4/3.
 */
export const IMAGE_PREVIEW_MAX_RAW_BYTES = Math.floor(
  ((REMOTE_MAX_FRAME_BYTES - 2048) * 3) / 4,
);

/** Not an image, or not one of the containers above — the request is refused. */
export const IMAGE_PREVIEW_NOT_IMAGE = -32012;
/** Larger than the frame can carry even after every rung of the ladder. */
export const IMAGE_PREVIEW_TOO_LARGE = -32013;
/** sharp is missing (it is installed at runtime, not bundled). */
export const IMAGE_PREVIEW_CODEC_UNAVAILABLE = -32014;
/** The path could not be read (missing, permission, a directory). */
export const IMAGE_PREVIEW_READ_FAILED = -32015;

export interface ImagePreviewResult {
  /** The path that was asked for, echoed for the page's error/placeholder copy. */
  path: string;
  /** `data:<mime>;base64,…`, ready for `<img src>`. */
  dataUrl: string;
  mime: string;
  /** Dimensions of the bytes being returned (after any downscale). */
  width: number;
  height: number;
  /** True when the image was downscaled to fit — the page says so out loud. */
  scaled: boolean;
  /** Encoded size of the returned bytes. */
  bytes: number;
}

function fail(code: number, message: string): Error {
  const error = new Error(message) as Error & { code?: number };
  error.code = code;
  return error;
}

/**
 * Read one image from **this machine** and shrink it to fit a relay frame.
 *
 * Throws an `Error` carrying one of the `IMAGE_PREVIEW_*` codes; the remote
 * error reply turns it into one visible line on the page.
 */
export async function readImagePreview(
  filePath: string,
): Promise<ImagePreviewResult> {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw fail(IMAGE_PREVIEW_NOT_IMAGE, "getImagePreview requires a path");
  }

  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw fail(IMAGE_PREVIEW_READ_FAILED, `Not a file: ${filePath}`);
    }
    size = info.size;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number"
    ) {
      throw error;
    }
    throw fail(IMAGE_PREVIEW_READ_FAILED, `Could not read ${filePath}`);
  }

  if (size > MAX_SOURCE_BYTES) {
    throw fail(
      IMAGE_PREVIEW_TOO_LARGE,
      `${filePath} is ${Math.round(size / (1024 * 1024))} MB, too large to preview`,
    );
  }

  let source: Buffer;
  try {
    source = await readFile(filePath);
  } catch {
    throw fail(IMAGE_PREVIEW_READ_FAILED, `Could not read ${filePath}`);
  }

  const shrunk = await shrinkImageForTransport(
    source,
    IMAGE_PREVIEW_MAX_RAW_BYTES,
  );

  if (!shrunk.ok) {
    switch (shrunk.reason) {
      case "no-codec":
        throw fail(
          IMAGE_PREVIEW_CODEC_UNAVAILABLE,
          "This machine has no image codec installed, so the picture cannot be prepared for the phone",
        );
      case "too-large":
        throw fail(
          IMAGE_PREVIEW_TOO_LARGE,
          "The image is still too large for the remote channel after shrinking",
        );
      case "unreadable":
        throw fail(
          IMAGE_PREVIEW_NOT_IMAGE,
          `${filePath} is not an image this machine can read`,
        );
    }
  }

  // The authorisation gate: the *decoded* container, not the file name.
  if (
    !shrunk.sourceFormat ||
    !ALLOWED_SOURCE_FORMATS.has(shrunk.sourceFormat)
  ) {
    throw fail(
      IMAGE_PREVIEW_NOT_IMAGE,
      `${filePath} is not a supported image (${shrunk.sourceFormat ?? "unknown"})`,
    );
  }

  return {
    path: filePath,
    dataUrl: shrunk.dataUrl,
    mime: shrunk.mime,
    width: shrunk.width,
    height: shrunk.height,
    scaled: shrunk.scaled,
    bytes: shrunk.bytes,
  };
}

/** Re-exported so the remote host and the page's shim quote one list. */
export { IMAGE_FILE_EXTENSIONS };
