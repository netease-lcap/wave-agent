/**
 * Ingest-time image budget: shrink a tool's images *before* they land in the
 * message list.
 *
 * `imageRewrite.ts` budgets images on the way **out** — the rewritten bytes went
 * into one request body and were then thrown away, so the message block kept the
 * original base64 forever. That leftover copy is what everything downstream
 * duplicates (agent memory, the host's message cache, the IPC hop, the renderer);
 * it is the resident set that took the desktop renderer down at
 * `workingSet=2981 MB` after a session had read a few dozen screenshots.
 *
 * This module applies the same ladder **once**, at the moment the tool result is
 * attached, and writes the shrunk bytes back into the block — so the request, the
 * host cache and the UI all share one small copy. That is Claude Code's shape:
 * budget at ingest, not at egress.
 *
 * Deliberate non-goals:
 *
 * - **No policy of its own.** The budget, the ladder and the wording all come
 *   from `imageBudget.ts` / `imageRewrite.ts`; this module only decides *when*,
 *   and what to do with the original.
 * - **Never lose an image.** When the ladder degrades (no codec, codec failure,
 *   unknown size, extreme aspect ratio) the original bytes stay in the block and
 *   `convertMessagesForAPI` keeps handling them exactly as before.
 * - **Never drop the original without a home.** A shrunk image keeps a `path` to
 *   bytes the user can still open: the source file for Read / path images, a
 *   persisted temp copy for tool-produced ones. If that write fails, the original
 *   stays inline instead of disappearing.
 * - **No second resize on the way out.** In-budget images (including everything
 *   this module just shrank) pass through `planOutboundImage` untouched, so the
 *   encode happens once and the bytes are stable across turns.
 */
import { logger } from "./globalLogger.js";
import { planOutboundImage } from "./imageRewrite.js";
import { persistToolImages } from "./toolImagePersistence.js";

export interface ToolImage {
  data: string;
  mediaType?: string;
  /** Local file the image can be reopened from (source file or persisted copy). */
  path?: string;
  /**
   * "original WxH, displayed at …" note produced when this module shrank the
   * image. Carried into the request by `convertMessagesForAPI` so the model can
   * map coordinates back even though the outbound layer no longer resizes it.
   */
  note?: string;
}

function toDataUrl(image: ToolImage): string {
  return image.data.startsWith("data:")
    ? image.data
    : `data:${image.mediaType || "image/png"};base64,${image.data}`;
}

function splitDataUrl(dataUrl: string): ToolImage {
  const comma = dataUrl.indexOf(",");
  const mediaType = /^data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1];
  return {
    data: comma === -1 ? dataUrl : dataUrl.slice(comma + 1),
    ...(mediaType ? { mediaType } : {}),
  };
}

/** Persist the original bytes so a shrunk image never loses its full-size copy. */
function persistOriginal(image: ToolImage): string | undefined {
  const [persisted] = persistToolImages([
    { data: image.data, mediaType: image.mediaType },
  ]);
  return persisted?.path;
}

async function budgetOne(image: ToolImage): Promise<ToolImage> {
  const dataUrl = toDataUrl(image);
  const plan = await planOutboundImage({
    dataUrl,
    cacheKey: dataUrl,
    sourcePath: image.path,
  });

  // Degraded (no codec / codec failure / unshrinkable) or already inside the
  // budget: hand back the caller's object verbatim, byte for byte.
  if (plan.kind === "omit" || plan.dataUrl === dataUrl) return image;

  const path = image.path ?? persistOriginal(image);
  if (!path) {
    // Could not give the original a home — keep it inline rather than dropping
    // the only copy. The outbound layer shrinks it per request, as before.
    logger.warn(
      "Keeping original tool image inline: it could not be persisted before shrinking",
    );
    return image;
  }

  return {
    ...splitDataUrl(plan.dataUrl),
    path,
    ...(plan.note ? { note: plan.note } : {}),
  };
}

/**
 * Bring every image a tool returned inside the outbound budget, writing the
 * result back into the block. Order and count are preserved so the caller can
 * hand the result straight to `updateToolBlock`.
 */
export async function applyToolImageBudget(
  images: ToolImage[],
): Promise<ToolImage[]> {
  const budgeted: ToolImage[] = [];
  for (const image of images) {
    try {
      budgeted.push(await budgetOne(image));
    } catch (error) {
      // A turn must not die because one image could not be measured.
      logger.warn("Failed to budget tool image at ingest:", error);
      budgeted.push(image);
    }
  }
  return budgeted;
}
