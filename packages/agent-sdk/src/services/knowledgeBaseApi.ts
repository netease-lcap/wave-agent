/**
 * Enterprise knowledge base retrieval (`kb_search` / `kb_get_doc` / `kb_suggest`).
 *
 * Three read-only endpoints on the enterprise server, reached exactly the way the
 * artifact endpoints are: the base is the account's `serverUrl`, the credential
 * is the SSO Bearer token attached by `createAuthAwareFetch`, and one retry
 * covers a first-attempt network error or a 5xx. Nothing here decides *whether*
 * the tools exist — that is `knowledgeBaseAvailability.ts` — and nothing here
 * decides what the model reads — that is the tools.
 *
 * Response fields stay untyped on purpose: `hit`/`doc` objects are handed on to
 * `metadata.citations` (the webview's citation card) without a rewrite, so the
 * tools read the fields they need tolerantly and unknown extras survive.
 */
import { authService, createAuthAwareFetch } from "./authService.js";
import { logger } from "../utils/globalLogger.js";

const KB_TIMEOUT_MS = 15_000;
/** One retry on a first-attempt network error or 5xx, matching `fetchArtifactList`. */
const KB_RETRY_DELAY_MS = 300;

/** Server-side clamp for `limit`: pulled into 1..10, defaulting to 5. */
export const KB_SEARCH_DEFAULT_LIMIT = 5;
export const KB_SEARCH_MAX_LIMIT = 10;

/**
 * One search hit. Only `snippet` — never full text: reading a chunk is
 * `kb_get_doc`'s job, so a search round trip stays cheap enough for the model to
 * search more than once.
 */
export interface KbHit {
  title?: string;
  docId?: string;
  chunkId?: string;
  sectionPath?: string;
  /** 1-based page number; absent for sources without paging (e.g. docx). */
  page?: number;
  snippet?: string;
  score?: number;
  /** Parser gaps, e.g. `emf_or_chart` — surfaced so the model can say so. */
  degraded?: string[];
}

/** One chunk read in full, with the document location it came from. */
export interface KbDoc {
  content: string;
  chunkId?: string;
  docId?: string;
  title?: string;
  sectionPath?: string;
  page?: number;
  blockType?: string;
  imageCaptions?: string[];
  degraded?: string[];
}

/**
 * What a knowledge-base call came back as.
 *
 * `unauthorized` and `not_found` are separate from `error` because both are
 * ordinary answers the model must phrase, not failures: the first means "this
 * account cannot search the enterprise library", the second "that chunk no longer
 * exists". An empty hit list is `ok` — "the documents do not cover it" is a
 * finding, and a search that returns nothing must never read as a broken tool.
 */
export type KbOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestKb(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown> },
  opts: { abortSignal?: AbortSignal } = {},
): Promise<KbOutcome<Record<string, unknown>>> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const signal = opts.abortSignal
    ? AbortSignal.any([opts.abortSignal, AbortSignal.timeout(KB_TIMEOUT_MS)])
    : AbortSignal.timeout(KB_TIMEOUT_MS);

  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await authFetch(`${serverUrl}${path}`, {
        method: init.method,
        ...(init.body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(init.body),
            }
          : {}),
        signal,
      });
    } catch (error) {
      if (attempt === 0 && !opts.abortSignal?.aborted) {
        await delay(KB_RETRY_DELAY_MS);
        continue;
      }
      logger?.warn("Knowledge base request failed", {
        path,
        error: String(error),
      });
      return {
        kind: "error",
        error: `failed to reach the server: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (res.status >= 500 && attempt === 0 && !opts.abortSignal?.aborted) {
      await delay(KB_RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  if (!res) {
    return { kind: "error", error: "failed to reach the server" };
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthorized" };
  }
  if (res.status === 404) {
    return { kind: "not_found" };
  }
  if (!res.ok) {
    return {
      kind: "error",
      error: `the server returned HTTP ${res.status} ${res.statusText}`,
    };
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { kind: "ok", value: data };
}

/**
 * Search the enterprise's ingested documents. `limit` is the caller's hit count
 * before the server's own clamp (1..10).
 */
export async function searchKnowledgeBase(
  query: string,
  limit: number,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<KbOutcome<{ hits: KbHit[] }>> {
  const outcome = await requestKb(
    "/api/kb/search",
    { method: "POST", body: { query, limit } },
    opts,
  );
  if (outcome.kind !== "ok") return outcome;

  const hits = outcome.value.hits;
  if (!Array.isArray(hits)) {
    return { kind: "error", error: "malformed response: no hits array" };
  }
  return { kind: "ok", value: { hits: hits as KbHit[] } };
}

/** Read one chunk in full. A chunk outside the tenant or deleted is a 404. */
export async function fetchKbDoc(
  chunkId: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<KbOutcome<KbDoc>> {
  const outcome = await requestKb(
    `/api/kb/doc/${encodeURIComponent(chunkId)}`,
    { method: "GET" },
    opts,
  );
  if (outcome.kind !== "ok") return outcome;
  if (typeof outcome.value.content !== "string") {
    return { kind: "error", error: "malformed response: no content" };
  }
  return { kind: "ok", value: outcome.value as unknown as KbDoc };
}

/** Terms that actually occur in the corpus — how the model re-words a search. */
export async function suggestKbTerms(
  term: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<KbOutcome<{ terms: string[] }>> {
  const outcome = await requestKb(
    "/api/kb/suggest",
    { method: "POST", body: { term } },
    opts,
  );
  if (outcome.kind !== "ok") return outcome;

  const terms = outcome.value.terms;
  if (!Array.isArray(terms)) {
    return { kind: "error", error: "malformed response: no terms array" };
  }
  return {
    kind: "ok",
    value: { terms: terms.filter((t): t is string => typeof t === "string") },
  };
}
