/**
 * Outbound image dimension budget: the per-side pixel ceiling we deliberately
 * keep every image under, aligned with Claude Code's `IMAGE_MAX_WIDTH` /
 * `IMAGE_MAX_HEIGHT`.
 *
 * Two gates enforce it and they must agree on the number:
 *
 * - the webview paste path (`packages/webview/src/utils/imageValidation.ts`)
 *   downsamples an oversized paste in the browser, before it becomes a message;
 * - the SDK's outbound rewrite pass (`utils/imageRewrite.ts`, via sharp) is the
 *   catch-all for every other source (Read tool, file paths, hosts that cannot
 *   re-encode).
 *
 * The value lives here rather than in `utils/imageBudget.ts` because the
 * webview is a browser bundle: by contract it may only take *values* from
 * `wave-agent-sdk/constants`, and `utils/*` is not a public subpath. Copying
 * `2000` into the webview would let the two gates drift apart silently — the
 * paste would shrink to one number while the SDK judged by another.
 *
 * Not to be confused with the gateway's *hard* bound: `MAX_IMAGE_DIMENSION_PX`
 * in `utils/imageDimensions.ts` (8192px per side) is where the upstream starts
 * rejecting the whole request with `HTTP 400 ... unsupported image`. That one is
 * an immovable external limit; this one is our own conservative budget and can
 * be raised freely when we want more image fidelity.
 */
export const OUTBOUND_IMAGE_MAX_DIMENSION_PX = 2000;

/**
 * Image extensions recognised **by file name**, lower-case and without the dot.
 *
 * Two callers need the same list and they sit on opposite sides of a process
 * boundary, which is why it lives here rather than next to either of them:
 *
 * - the Read tool (`tools/readTool.ts`) decides whether a path is an image it
 *   can attach;
 * - the remote-control page (`utils/filePathLinks.ts`) decides whether a path in
 *   a message is worth turning into a click target, and the host that serves it
 *   (`packages/code/src/remote/imagePreview.ts`) uses it as the first gate.
 *
 * **An extension is never proof.** Both consumers treat it as a *routing* hint
 * only; the host re-checks the decoded container before serving any bytes, so a
 * `.png` that is really something else is refused. Keep the two gates separate —
 * collapsing them would turn a file name into an authorisation.
 *
 * `svg` / `bmp` / `ico` are deliberately absent: the desktop file panel renders
 * them, but they have no place on the remote page (an SVG is XML, not a raster
 * image with the same "shrink to fit a frame" semantics).
 */
export const IMAGE_FILE_EXTENSIONS = [
  "png",
  "jpeg",
  "jpg",
  "gif",
  "webp",
] as const;

/** Fast membership test for {@link IMAGE_FILE_EXTENSIONS} (`ext` without the dot). */
export function isImageFileExtension(ext: string): boolean {
  return (IMAGE_FILE_EXTENSIONS as readonly string[]).includes(
    ext.toLowerCase(),
  );
}
