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
