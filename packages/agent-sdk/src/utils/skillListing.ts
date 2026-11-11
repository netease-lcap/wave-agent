/**
 * The available-skills list, announced in the conversation instead of inside
 * the `Skill` tool description.
 *
 * Why it cannot live in the description: `tools[]` sits in the cached prefix,
 * and the skill set is not a constant of the session. A skill directory refresh
 * (file watcher), an in-place plugin reload, or a subtree skill discovered
 * mid-conversation (`utils/nestedSkills.ts`) would rewrite the declaration and
 * take the cached prefix with it. The description is a pool-independent
 * constant now; the list is appended at the tail, where an addition invalidates
 * nothing that already went out. Same shape as `exec/catalogAnnouncement.ts`,
 * and for the same reasons — see that file for the longer argument.
 *
 * State lives in the history, not in the process: each announcement leads with
 * a marker line carrying the hash of the body it introduces. That makes
 * "has the model read this exact list, and is it still current" answerable
 * without remembering anything between turns, so compaction / rewind / process
 * restart all degrade to "nothing announced yet ⇒ announce the full list". A
 * duplicate is better than a loss.
 *
 * There is no delta. The body *is* the skill list, so a delta would have to
 * carry the previously-announced set in order to describe a change to it, and
 * "the following are new" is a history-dependent line that can never compare
 * equal to a freshly rendered one — the session would then re-announce on every
 * single turn.
 */
import { createHash } from "node:crypto";
import type { Message } from "../types/messaging.js";
import type { SkillMetadata } from "../types/skills.js";

/** Marks a skills listing so the history scan can find it. */
export const SKILL_LISTING_MARKER_PREFIX = "<!-- skill-listing ";
export const SKILL_LISTING_MARKER_SUFFIX = " -->";

/** A marker's payload: what a later turn needs to compare against. */
export interface SkillListingMarker {
  /** Hash of the listing body as of this announcement. */
  hash: string;
}

interface MarkerPayload {
  h?: unknown;
}

/** Opens the list; one skill per line follows. */
const LISTING_HEADER =
  "Skills available for use with the Skill tool (name: when to use it):";

/** Shown when the list is empty but an earlier one had been announced. */
const EMPTY_NOTE =
  "No skills are currently available. The skill list an earlier message showed is no longer current.";

/**
 * How much of a non-builtin description survives when the list does not fit.
 * Skills that ship with the product keep their full description: they are the
 * ones the model is expected to recognise without further hints.
 */
const MIN_DESCRIPTION_CHARS = 80;

/**
 * Character budget used when the caller has no context window to scale from.
 * Roughly 2K tokens — a listing that does not fit in this is not a listing the
 * model can use anyway.
 */
export const DEFAULT_SKILL_LISTING_CHAR_BUDGET = 8_000;

/** Squash a description onto one line and cap it. */
function formatDescription(description: string, maxChars: number): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderLine(
  skill: SkillMetadata,
  maxDescription: number | null,
): string {
  if (maxDescription === null) return `- ${skill.name}`;
  const description = formatDescription(skill.description, maxDescription);
  return description ? `- ${skill.name}: ${description}` : `- ${skill.name}`;
}

/**
 * Render the listing body, trimming descriptions until it fits `budgetChars`.
 *
 * Order of sacrifice, cheapest first: full descriptions → non-builtin
 * descriptions shortened → descriptions dropped entirely (names only) → the
 * tail of the name list dropped with an explicit count. Names survive longer
 * than descriptions on purpose: a skill whose name the model never sees cannot
 * be invoked at all, while a missing description only makes selection worse.
 * The count is appended rather than left implicit, because "the list happened to
 * be shorter" and "there are more skills" must not look the same.
 *
 * Sorted by name so the body — and therefore the hash — is a function of the
 * skill *set*, not of discovery order.
 */
export function formatSkillsWithinBudget(
  skills: readonly SkillMetadata[],
  budgetChars: number = DEFAULT_SKILL_LISTING_CHAR_BUDGET,
): { body: string; omitted: number } {
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const assemble = (lines: string[], omitted = 0): string => {
    const tail = omitted > 0 ? [`- (${omitted} more skills not listed)`] : [];
    return [LISTING_HEADER, ...lines, ...tail].join("\n");
  };

  const full = sorted.map((skill) =>
    renderLine(skill, Number.MAX_SAFE_INTEGER),
  );
  const fullBody = assemble(full);
  if (fullBody.length <= budgetChars) return { body: fullBody, omitted: 0 };

  // Compact: non-builtin descriptions collapse to the short form, builtin keep
  // theirs — they are the ones the model is expected to recognise unaided.
  const compact = sorted.map((skill) =>
    renderLine(
      skill,
      skill.type === "builtin"
        ? Number.MAX_SAFE_INTEGER
        : MIN_DESCRIPTION_CHARS,
    ),
  );
  const compactBody = assemble(compact);
  if (compactBody.length <= budgetChars)
    return { body: compactBody, omitted: 0 };

  // Names only, then drop the tail if even that does not fit.
  const names = sorted.map((skill) => renderLine(skill, null));
  const nameBody = assemble(names);
  if (nameBody.length <= budgetChars) return { body: nameBody, omitted: 0 };

  const kept: string[] = [];
  let used = LISTING_HEADER.length + 1;
  for (const line of names) {
    // +1 for the newline; the omission footer is reserved lazily below.
    if (used + line.length + 1 > budgetChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = names.length - kept.length;
  return { body: assemble(kept, omitted), omitted };
}

/** The marker line for a body: its hash is the identity a later turn compares. */
function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

function renderMarker(marker: SkillListingMarker): string {
  const payload: MarkerPayload = { h: marker.hash };
  return `${SKILL_LISTING_MARKER_PREFIX}${JSON.stringify(payload)}${SKILL_LISTING_MARKER_SUFFIX}`;
}

/**
 * Read the last skills listing out of the history, or null when there is none.
 *
 * Scanned from the tail and stopped at the first hit: the answer is the newest
 * marker, and this runs every turn against a history that only grows. Only meta
 * messages are read — a marker quoted in prose (a reply explaining the
 * mechanism, a hook echoing one) is *about* a marker, not a statement about the
 * skill set. A marker that cannot be parsed is skipped for the same reason; the
 * worst case is one extra listing.
 */
export function collectSkillListingState(
  messages: Message[],
): SkillListingMarker | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.isMeta !== true) continue;
    for (const block of message.blocks) {
      if (block.type !== "text") continue;
      if (!block.content.includes(SKILL_LISTING_MARKER_PREFIX)) continue;
      for (const line of block.content.split("\n")) {
        const marker = parseMarkerLine(line);
        if (marker) return marker;
      }
    }
  }

  return null;
}

function parseMarkerLine(line: string): SkillListingMarker | null {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith(SKILL_LISTING_MARKER_PREFIX) ||
    !trimmed.endsWith(SKILL_LISTING_MARKER_SUFFIX)
  ) {
    return null;
  }
  const payload = trimmed.slice(
    SKILL_LISTING_MARKER_PREFIX.length,
    trimmed.length - SKILL_LISTING_MARKER_SUFFIX.length,
  );
  try {
    const parsed = JSON.parse(payload) as MarkerPayload;
    if (typeof parsed.h !== "string") return null;
    return { hash: parsed.h };
  } catch {
    // A marker we cannot read (hand-edited or truncated history) must not take
    // the turn down; the worst case is announcing the list once more.
    return null;
  }
}

/**
 * The next listing for this turn, or null when there is nothing to say.
 *
 * Decision table:
 *  - no skills and nothing ever announced → silence (most sessions with no
 *    skills should not be told about a list they never saw);
 *  - no skills but a list is on record → say so once, so a model that still
 *    believes the old list exists is corrected;
 *  - nothing announced yet → the full list;
 *  - the same hash → silence;
 *  - anything else → the full list.
 */
export function buildSkillListingAnnouncement(
  last: SkillListingMarker | null,
  skills: readonly SkillMetadata[],
  budgetChars: number = DEFAULT_SKILL_LISTING_CHAR_BUDGET,
): string | null {
  if (skills.length === 0) {
    if (last === null) return null;
    const emptyMarker = { hash: hashBody(EMPTY_NOTE) };
    if (last.hash === emptyMarker.hash) return null;
    return `${renderMarker(emptyMarker)}\n${EMPTY_NOTE}`;
  }

  const { body } = formatSkillsWithinBudget(skills, budgetChars);
  const hash = hashBody(body);
  if (last !== null && last.hash === hash) return null;

  return `${renderMarker({ hash })}\n${body}`;
}
