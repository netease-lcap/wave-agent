/**
 * Addressing a daemon session by a name a human can say out loud.
 *
 * Every `wave daemon` subcommand takes a sessionId and used to accept nothing
 * else: a 36-character UUID cannot be dictated, remembered, or typed from
 * memory, so the daemon's own sessions could not be talked about. The fix is
 * deliberately not a new naming table — a session's name IS its existing title
 * (`customTitle`, appended to the transcript as a `custom-title` entry), so the
 * desktop app, the IDE plugins, the session picker and this CLI all show the
 * same label and a rename needs no extra file.
 *
 * Resolution order is fixed and lives here in one place, because two commands
 * disagreeing about which session a name means is worse than having no names
 * (spec: docs/specs/multi-agent/daemon-command.md「按名字寻址会话」):
 *
 * 1. complete sessionId — exact match
 * 2. sessionId prefix — unique match; several matches are an ambiguity error
 * 3. name (`customTitle`) — exact match; several matches are an ambiguity error
 *
 * The order cannot be reversed: a session literally named `c530` must not steal
 * the id-prefix meaning of `c530`. A miss is never guessed at either — the
 * caller reports the candidates and lets the user pick.
 *
 * This module is pure: the candidates come from the daemon
 * (`listDaemonSessions` for live sessions, `listAllSessions` for the on-disk
 * index), rendering is here, and `process.exit` stays in commands.ts.
 */

/** Longest name accepted — longer ones are refused, not truncated. */
export const SESSION_NAME_MAX_LENGTH = 64;

/** A complete session id: never treated as a name (or as a name candidate). */
const FULL_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Input that may be an id prefix. Hex only, at least 4 characters: shorter
 * input cannot narrow a 36-character id in any useful way, and treating `a` as
 * a prefix would make a session named `a` unaddressable.
 */
const SESSION_ID_PREFIX = /^[0-9a-f]{4,}$/i;

/** One addressable session, as resolution sees it. */
export interface SessionCandidate {
  sessionId: string;
  /** The session's `customTitle`; absent = it was never named. */
  name?: string;
  /** Directory the session was created in (`sessionCwd` / the transcript's). */
  workdir: string;
  /** Hosted by the daemon right now (came from `listDaemonSessions`). */
  live: boolean;
  /** `idle` / `generating` for live rows; absent for on-disk-only ones. */
  status?: string;
}

/** How a `ref` was resolved. */
export type RefMatch =
  | {
      kind: "found";
      sessionId: string;
      matchedBy: "id" | "id-prefix" | "name";
    }
  | {
      kind: "ambiguous";
      matchedBy: "id-prefix" | "name";
      candidates: SessionCandidate[];
    };

export function isFullSessionId(ref: string): boolean {
  return FULL_SESSION_ID.test(ref);
}

/**
 * Validate a user-supplied session name.
 *
 * Only the names that would break addressing are refused: an empty/blank one
 * (nothing to say), one longer than {@link SESSION_NAME_MAX_LENGTH} (not
 * representable in a table or a sentence), and one containing a newline (it
 * would break every single-line rendering). Spaces are allowed — quoting them
 * is the shell's job, not this command's.
 */
export function normalizeSessionName(
  raw: string,
): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) {
    return { error: "Session name must not be empty or blank" };
  }
  if (/[\r\n]/.test(name)) {
    return { error: "Session name must be a single line (no line breaks)" };
  }
  if (name.length > SESSION_NAME_MAX_LENGTH) {
    return {
      error: `Session name must be at most ${SESSION_NAME_MAX_LENGTH} characters (got ${name.length})`,
    };
  }
  return { name };
}

/**
 * Steps 1 and 2 of resolution: a complete id first (exact, so a departed
 * session id is never confused with a prefix of a live one), then a unique id
 * prefix. Returns undefined when nothing matches by id — the caller then tries
 * names.
 */
export function matchBySessionId(
  candidates: SessionCandidate[],
  ref: string,
): RefMatch | undefined {
  if (candidates.some((c) => c.sessionId === ref)) {
    return { kind: "found", sessionId: ref, matchedBy: "id" };
  }
  if (!SESSION_ID_PREFIX.test(ref)) return undefined;
  const needle = ref.toLowerCase();
  const prefixed = candidates.filter((c) =>
    c.sessionId.toLowerCase().startsWith(needle),
  );
  if (prefixed.length === 0) return undefined;
  if (prefixed.length === 1) {
    return {
      kind: "found",
      sessionId: prefixed[0].sessionId,
      matchedBy: "id-prefix",
    };
  }
  return { kind: "ambiguous", matchedBy: "id-prefix", candidates: prefixed };
}

/**
 * Step 3 of resolution: exact `customTitle` match.
 *
 * The same session can be listed twice (live now, and again in the on-disk
 * index) — that is one candidate, not an ambiguity. Two *different* sessions
 * sharing a name is an ambiguity, and the caller must show them instead of
 * picking one: names are a user-facing title the product lets repeat, ids are
 * the only thing that can be wrong-typed into a destructive command.
 */
export function matchByName(
  candidates: SessionCandidate[],
  ref: string,
): RefMatch | undefined {
  const seen = new Set<string>();
  const named: SessionCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.name !== ref) continue;
    if (seen.has(candidate.sessionId)) continue;
    seen.add(candidate.sessionId);
    named.push(candidate);
  }
  if (named.length === 0) return undefined;
  if (named.length === 1) {
    return { kind: "found", sessionId: named[0].sessionId, matchedBy: "name" };
  }
  return { kind: "ambiguous", matchedBy: "name", candidates: named };
}

/**
 * The name a `create` gets when the user did not give one: `<base>-<n>`, n
 * starting at 1 and skipping names that are already taken.
 *
 * `base` is the worktree name or the workdir's basename, so the name says where
 * the session lives (`mods-x`, `wave-agent-3`). The number keeps plain sessions
 * in the same project distinguishable without anyone having to invent a name,
 * and skipping taken ones is what keeps the *default* names unambiguous —
 * which matters more than for hand-picked ones, because the user never sees a
 * default name being chosen and so cannot react to a warning about it.
 */
export function pickDefaultSessionName(
  base: string,
  taken: Iterable<string>,
): string {
  const takenSet = new Set(taken);
  const cleaned =
    base
      .trim()
      .replace(/[\r\n\t]+/g, "-")
      .slice(0, SESSION_NAME_MAX_LENGTH - 4) || "session";
  let n = 1;
  let name = `${cleaned}-${n}`;
  while (takenSet.has(name)) {
    n += 1;
    name = `${cleaned}-${n}`;
  }
  return name;
}

/** Aligned table for candidate lists (last column is never right-padded). */
function renderTable(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, index) =>
        index === row.length - 1 ? cell : cell.padEnd(widths[index]),
      )
      .join("  ")
      .trimEnd(),
  );
}

/**
 * The candidate table shown when a `ref` cannot be resolved to one session:
 * sessionId (what the user has to retype), name, status, working directory and
 * the last message (the fastest way to tell two same-named sessions apart).
 * `lastMessageOf` answers undefined for a session that is not hosted here —
 * its messages cannot be read without loading it first.
 */
export function renderCandidateTable(
  candidates: SessionCandidate[],
  lastMessageOf: (candidate: SessionCandidate) => string | undefined,
): string[] {
  const rows: string[][] = [
    ["Session", "Name", "Status", "Working directory", "Last message"],
  ];
  for (const candidate of candidates) {
    rows.push([
      candidate.sessionId,
      candidate.name ?? "-",
      candidate.status ?? "not hosted",
      candidate.workdir,
      lastMessageOf(candidate) ?? "-",
    ]);
  }
  return renderTable(rows);
}

/**
 * The failure text for an ambiguous reference. Both halves matter: what was
 * ambiguous (so the user knows the name did match something) and the table (so
 * they can pick by id without a second command).
 */
export function renderAmbiguousRef(
  ref: string,
  match: Extract<RefMatch, { kind: "ambiguous" }>,
  lastMessageOf: (candidate: SessionCandidate) => string | undefined,
): string {
  const count = match.candidates.length;
  const by = match.matchedBy === "name" ? "name" : "session-id prefix";
  return [
    `Ambiguous session reference "${ref}": matches ${count} sessions by ${by}. Address one by sessionId (a unique prefix is enough):`,
    "",
    ...renderCandidateTable(match.candidates, lastMessageOf),
  ].join("\n");
}

/**
 * The one-line hint appended to a not-found failure: what was tried, and which
 * names exist so a typo is visible without running `wave daemon list`.
 */
export function describeNotFound(ref: string, knownNames: string[]): string {
  const tried = `No session id, id prefix or name matches "${ref}".`;
  return knownNames.length > 0
    ? `${tried} Known names: ${knownNames.join(", ")}`
    : `${tried} No session on this machine has a name yet.`;
}
