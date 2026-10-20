/**
 * `<page-comment-event>` — the wake-up signal for artifact page comments.
 *
 * Deliberately its own tag rather than a `<task-notification>` with a new
 * `task-type`: that channel means "a background task reached a terminal state,
 * here is its taskId and output file". A comment event has no task, no terminal
 * state and repeats forever, so reusing it would make every consumer of
 * `taskType` / `status` handle a fake task id — the vocabulary would lie.
 *
 * The event is a **signal only**: it carries no comment text (the server does
 * not send any) and tells the model to read the threads itself.
 */

export interface PageCommentEvent {
  /** Artifact page URL, as the model would pass it back to the tool. */
  url: string;
  slug: string;
  /** Threads awaiting a reply, when the reader could determine them. */
  count?: number;
  threadIds?: string[];
}

const OPEN_TAG = "<page-comment-event>";
const CLOSE_TAG = "</page-comment-event>";

function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"));
  return match ? unescapeXml(match[1]) : null;
}

function unescapeXml(text: string): string {
  return text.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_match, entity: string) => ENTITIES[entity] ?? _match,
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function pageCommentEventToXml(event: PageCommentEvent): string {
  const lines = [
    OPEN_TAG,
    `<artifact>${escapeXml(event.url)}</artifact>`,
    `<slug>${escapeXml(event.slug)}</slug>`,
  ];
  if (event.count !== undefined) lines.push(`<count>${event.count}</count>`);
  const threadIds = event.threadIds?.filter(Boolean) ?? [];
  if (threadIds.length > 0) {
    lines.push(`<threads>${threadIds.map(escapeXml).join(",")}</threads>`);
  }
  lines.push(
    `<reason>${event.count ? `${event.count} comment thread(s) are awaiting your reply` : "comments on this page changed"}</reason>`,
    '<next-step>Read the latest with the Artifact tool: action "comments" and this slug (or url). ' +
      'Then decide whether to reply (action "reply") or resolve (action "resolve"). ' +
      "This event carries no comment text.</next-step>",
    CLOSE_TAG,
  );
  return lines.join("\n");
}

export function parsePageCommentEventXml(xml: string): PageCommentEvent | null {
  if (!xml.includes(OPEN_TAG)) return null;
  try {
    const url = extractTag(xml, "artifact");
    const slug = extractTag(xml, "slug");
    if (!url || !slug) return null;

    const countRaw = extractTag(xml, "count");
    const count =
      countRaw !== null &&
      countRaw.trim() !== "" &&
      Number.isFinite(Number(countRaw))
        ? Number(countRaw)
        : undefined;
    const threadsRaw = extractTag(xml, "threads");
    const threadIds =
      threadsRaw !== null
        ? threadsRaw
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined;

    return {
      url: url.trim(),
      slug: slug.trim(),
      ...(count !== undefined && { count }),
      ...(threadIds && threadIds.length > 0 && { threadIds }),
    };
  } catch {
    return null;
  }
}
