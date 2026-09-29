/**
 * Artifact enumeration (`Artifact` tool's `list` action).
 *
 * The server exposes a single fixed-size page (`GET /api/frame/frames?limit=200`)
 * with no scope filter and no cursor, so both scoping (`mine` / `shared` / `all`)
 * and truncation to the caller's `limit` happen here — matching Claude Code, whose
 * `scope` and `limit` are likewise client-side behaviour.
 */

import { authService, createAuthAwareFetch } from "./authService.js";
import { logger } from "../utils/globalLogger.js";

/** Server page size — fixed, not caller-controlled (Claude Code's `Ko`). */
const LIST_PAGE_SIZE = 200;
const LIST_TIMEOUT_MS = 15_000;
/** One retry on a first-attempt network error or 5xx, matching Claude Code. */
const LIST_RETRY_DELAY_MS = 300;

export const ARTIFACT_LIST_DEFAULT_LIMIT = 25;
export const ARTIFACT_LIST_MAX_LIMIT = 50;

export const ARTIFACT_SCOPES = ["mine", "shared", "all"] as const;
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number];

export function isArtifactScope(value: unknown): value is ArtifactScope {
  return ARTIFACT_SCOPES.includes(value as ArtifactScope);
}

/** How a listed artifact relates to the current account. */
export type ArtifactRel = "mine" | "shared";

export interface ArtifactListRow {
  slug: string;
  title: string;
  rel: ArtifactRel;
  favicon?: string;
  updatedAt?: string;
}

export type ArtifactListOutcome =
  | { kind: "ok"; rows: ArtifactListRow[]; truncated: boolean }
  | { kind: "error"; error: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Titles land in the list output, so control characters and newlines collapse. */
function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== "string") return "Untitled artifact";
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
  return cleaned || "Untitled artifact";
}

function normalizeRow(
  raw: unknown,
  scope: ArtifactScope,
): ArtifactListRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  // Soft-deleted rows still come back in the page but are not listable.
  if (row.softDeleted === true) return null;
  const rel = row.rel;
  if (rel !== "mine" && rel !== "shared") return null;
  if (scope !== "all" && rel !== scope) return null;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!slug) return null;

  const normalized: ArtifactListRow = {
    slug,
    title: sanitizeTitle(row.title),
    rel,
  };
  if (typeof row.updatedAt === "string" && row.updatedAt) {
    normalized.updatedAt = row.updatedAt;
  }
  // Claude Code only surfaces a favicon on the account's own artifacts.
  if (rel === "mine" && typeof row.favicon === "string" && row.favicon) {
    normalized.favicon = row.favicon;
  }
  return normalized;
}

/**
 * List the account's artifacts, filtered to `scope` and cut down to `limit`.
 * `truncated` is set whenever the caller's `limit` (or the server's fixed page)
 * hid rows that would otherwise have been listed.
 */
export async function fetchArtifactList(
  scope: ArtifactScope,
  limit: number,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<ArtifactListOutcome> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const url = `${serverUrl}/api/frame/frames?limit=${LIST_PAGE_SIZE}`;

  const signal = opts.abortSignal
    ? AbortSignal.any([opts.abortSignal, AbortSignal.timeout(LIST_TIMEOUT_MS)])
    : AbortSignal.timeout(LIST_TIMEOUT_MS);

  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await authFetch(url, { method: "GET", signal });
    } catch (error) {
      if (attempt === 0 && !opts.abortSignal?.aborted) {
        await delay(LIST_RETRY_DELAY_MS);
        continue;
      }
      logger?.warn("Artifact listing failed", { error: String(error) });
      return {
        kind: "error",
        error: `failed to reach the server: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (res.status >= 500 && attempt === 0 && !opts.abortSignal?.aborted) {
      await delay(LIST_RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  if (!res) {
    return { kind: "error", error: "failed to reach the server" };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      kind: "error",
      error: `authentication failed (HTTP ${res.status}). Run /login again and retry.`,
    };
  }
  if (!res.ok) {
    return {
      kind: "error",
      error: `the server returned HTTP ${res.status} ${res.statusText}`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!Array.isArray(data.frames)) {
    return { kind: "error", error: "malformed response: no frames array" };
  }

  const frames = data.frames as unknown[];
  const rows: ArtifactListRow[] = [];
  let malformed = 0;
  let truncated = false;
  for (const raw of frames) {
    if (rows.length >= limit) {
      truncated = true;
      break;
    }
    const row = normalizeRow(raw, scope);
    if (!row) {
      malformed++;
      continue;
    }
    rows.push(row);
  }
  if (frames.length >= LIST_PAGE_SIZE) truncated = true;

  // Every row came back unreadable: report it rather than showing an empty list.
  if (frames.length > 0 && rows.length === 0 && malformed === frames.length) {
    return {
      kind: "error",
      error: "response rows were unreadable",
    };
  }

  return { kind: "ok", rows, truncated };
}
