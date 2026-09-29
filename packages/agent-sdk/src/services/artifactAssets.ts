/**
 * Artifact asset library — the `/api/frame/blob/{slug}/agent-*` endpoints plus
 * the token-authenticated `_blob` read channel.
 *
 * The server validates only the *shape* of the request (a bare MIME type, its
 * own size ceilings); everything semantic lives here, matching Claude Code:
 * the extension → MIME allowlist, the per-asset size ceilings, and the
 * human-readable mapping of the server's terse error codes.
 *
 * Wire facts (verified against codechat + Claude Code 2.1.284):
 * - `asset_id` is a bare 32-hex `opaque_id`; `_blob/{id}` is only a display URL.
 * - `agent-list` pages at a server-fixed 50 and ignores the `limit` we send.
 * - `agent-delete` is idempotent: a missing/already-deleted asset returns 200
 *   `{deleted: false}` rather than 404.
 * - `read_asset` never uses the session Bearer token: it carries the artifact's
 *   `assetToken` (a 1-hour HMAC derived from `JWT_SECRET`) as `__frame_t`.
 */

import { authService, createAuthAwareFetch } from "./authService.js";
import {
  artifactOwnershipFromMeta,
  fetchFrameMeta,
  type ArtifactOwnership,
} from "./artifactContent.js";
import { logger } from "../utils/globalLogger.js";

const ASSET_LIST_TIMEOUT_MS = 30_000;
const ASSET_UPLOAD_TIMEOUT_MS = 30_000;
/** Larger transfers get a longer deadline (Claude Code's 30s/90s pair). */
const ASSET_LONG_TIMEOUT_MS = 90_000;
const ASSET_LARGE_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Per-asset ceiling, and the tighter one the server applies to SVGs. */
export const ASSET_MAX_BYTES = 20 * 1024 * 1024;
export const ASSET_SVG_MAX_BYTES = 2 * 1024 * 1024;
/** `agent-copy` accepts 1-10 distinct ids per call. */
export const ASSET_COPY_MAX_IDS = 10;
/** `agent-list` page size — the server fixes it; we only echo the contract. */
export const ASSET_PAGE_SIZE = 50;

const SVG_CONTENT_TYPE = "image/svg+xml";

const ASSET_ID_RE = /^[0-9a-f]{32}$/;
const ASSET_REF_RE = /(?:^|\/)_blob\/([0-9a-f]{32})(?:$|[/?#])/;

/**
 * Extensions accepted for upload. The server takes any bare MIME type, so this
 * allowlist is the only gate — keep it in step with Claude Code's map.
 */
export const ASSET_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": SVG_CONTENT_TYPE,
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".txt": "text/plain",
  ".ts": "text/plain",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
};

/** Allowed extensions, in allowlist order, for error messages. */
export const ASSET_ALLOWED_EXTENSIONS = Object.keys(ASSET_MIME_BY_EXTENSION);

/** Content types small enough to hand back inline rather than persisting. */
const TEXTUAL_CONTENT_TYPES = new Set([
  "application/json",
  "application/manifest+json",
  "application/xml",
  "application/javascript",
  SVG_CONTENT_TYPE,
]);

/** MIME type for a file's extension, or undefined when the type is not allowed. */
export function assetContentTypeFor(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return undefined;
  return ASSET_MIME_BY_EXTENSION[filePath.slice(dot).toLowerCase()];
}

export function assetSizeLimitFor(contentType: string): number {
  return contentType === SVG_CONTENT_TYPE
    ? ASSET_SVG_MAX_BYTES
    : ASSET_MAX_BYTES;
}

export function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/** A file extension to write a fetched asset under, derived from its type. */
export function assetFileExtension(contentType: string): string {
  const bare = contentType.split(";")[0].trim().toLowerCase();
  for (const [ext, type] of Object.entries(ASSET_MIME_BY_EXTENSION)) {
    if (type === bare) return ext.slice(1);
  }
  const subtype = bare.split("/")[1] ?? "";
  return /^[a-z0-9]{1,10}$/.test(subtype) ? subtype : "bin";
}

/** Whether a 32-hex durable asset id. */
export function isAssetId(value: string): boolean {
  return ASSET_ID_RE.test(value);
}

/**
 * Accept the several spellings a model may produce for an asset — a bare id,
 * `_blob/{id}`, `/_blob/{id}`, or a full `_blob` URL — and return the id.
 */
export function normalizeAssetId(raw: string): string | null {
  const trimmed = raw.trim();
  if (ASSET_ID_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(ASSET_REF_RE);
  return match ? match[1] : null;
}

/** Whether an asset should be returned as text rather than written to disk. */
export function isTextContentType(contentType: string): boolean {
  const bare = contentType.split(";")[0].trim().toLowerCase();
  return bare.startsWith("text/") || TEXTUAL_CONTENT_TYPES.has(bare);
}

// --- Responses ---

export interface AssetRecord {
  asset_id: string;
  url?: string;
  content_type: string;
  size_bytes: number;
  sha256?: string;
  created_at?: string;
  /** On a copy, the source asset this one was copied from. */
  from_id?: string;
}

export interface AssetUsage {
  files: number;
  bytes: number;
  max_files: number;
  max_bytes: number;
}

export interface AssetListResult {
  assets: AssetRecord[];
  usage: AssetUsage;
  next?: string;
}

export interface AssetReadResult {
  bytes: Buffer;
  contentType: string;
  /** Whether the artifact belongs to the current account or was shared to it. */
  ownership: ArtifactOwnership;
}

export type AssetOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrow the server's `{ error: { code, message } }` / plain-text bodies. */
function serverMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = asRecord(JSON.parse(trimmed));
    const error = asRecord(parsed?.error);
    if (typeof error?.message === "string") return error.message;
    if (typeof error?.code === "string") return error.code;
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // Not JSON — the server sometimes answers 403 with a bare reason phrase.
  }
  return trimmed.startsWith("<") ? undefined : trimmed;
}

/** Turn a non-2xx asset response into a message the model can act on. */
function describeAssetError(
  status: number,
  statusText: string,
  body: string,
  what: string,
): string {
  const detail = serverMessage(body);
  switch (status) {
    case 401:
      return `authentication failed (HTTP 401). Run /login again and retry.`;
    case 403:
      if (detail === "not a writer") {
        return `only the artifact's owner or a writer can change its assets.`;
      }
      return detail
        ? `the server refused the ${what} (HTTP 403): ${detail}.`
        : `the server refused the ${what} (HTTP 403).`;
    case 404:
      return detail
        ? `${what} failed: ${detail}.`
        : `${what} failed: not found (HTTP 404) — check the artifact URL and asset id.`;
    case 409:
      return `the artifact cannot take the ${what} right now (HTTP 409${detail ? `: ${detail}` : ""}) — it may be unpublished, or at its asset storage quota.`;
    case 413:
      return `the server rejected the ${what} as too large (HTTP 413) — compress or split it.`;
    case 415:
      return `the server rejected the content type${detail ? `: ${detail}` : " (HTTP 415)"} — it must be a bare MIME type with no parameters.`;
    case 429:
      return `rate limited (HTTP 429) — wait before retrying, and do not loop.`;
    default:
      if (status >= 500) {
        return `the asset store is unavailable right now (HTTP ${status}) — retry once after a short wait.`;
      }
      return `unexpected answer from the server (HTTP ${status} ${statusText})${detail ? `: ${detail}` : ""}.`;
  }
}

function requestSignal(
  timeoutMs: number,
  abortSignal?: AbortSignal,
): AbortSignal {
  return abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

/** Shared request wrapper for the `agent-*` endpoints. */
async function callAssetEndpoint(
  path: string,
  init: { method: string; body?: BodyInit; contentType?: string },
  opts: { what: string; timeoutMs?: number; abortSignal?: AbortSignal },
): Promise<AssetOutcome<{ status: number; body: string }>> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const headers: Record<string, string> = {};
  if (init.contentType) headers["Content-Type"] = init.contentType;

  let res: Response;
  try {
    res = await authFetch(`${serverUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: requestSignal(
        opts.timeoutMs ?? ASSET_LIST_TIMEOUT_MS,
        opts.abortSignal,
      ),
    });
  } catch (error) {
    logger?.warn(`Artifact asset ${opts.what} failed`, {
      error: String(error),
    });
    return {
      kind: "error",
      error: `the request failed in transit or timed out — nothing may have changed, so one retry is safe (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const body = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      kind: "error",
      error: describeAssetError(res.status, res.statusText, body, opts.what),
    };
  }
  return { kind: "ok", value: { status: res.status, body } };
}

function parseAssets(raw: unknown[]): AssetRecord[] {
  const assets: AssetRecord[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    const id = typeof record?.opaque_id === "string" ? record.opaque_id : "";
    if (!isAssetId(id)) continue;
    assets.push({
      asset_id: id,
      url: typeof record?.url === "string" ? record.url : undefined,
      content_type:
        typeof record?.content_type === "string" ? record.content_type : "",
      size_bytes:
        typeof record?.size_bytes === "number" ? record.size_bytes : 0,
      sha256: typeof record?.sha256 === "string" ? record.sha256 : undefined,
      created_at:
        typeof record?.created_at === "string" ? record.created_at : undefined,
      from_id: typeof record?.from_id === "string" ? record.from_id : undefined,
    });
  }
  return assets;
}

/** Upload raw bytes to an artifact's asset store. */
export async function uploadAsset(
  slug: string,
  bytes: Buffer,
  contentType: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<AssetOutcome<AssetRecord>> {
  const timeoutMs =
    bytes.byteLength > ASSET_LARGE_UPLOAD_BYTES
      ? ASSET_LONG_TIMEOUT_MS
      : ASSET_UPLOAD_TIMEOUT_MS;
  const res = await callAssetEndpoint(
    `/api/frame/blob/${encodeURIComponent(slug)}/agent-upload`,
    {
      method: "POST",
      body: new Uint8Array(bytes) as unknown as BodyInit,
      contentType,
    },
    { what: "upload", timeoutMs, abortSignal: opts.abortSignal },
  );
  if (res.kind === "error") return res;

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.value.body);
  } catch {
    parsed = null;
  }
  const record = parseAssets([parsed])[0];
  if (!record) {
    return {
      kind: "error",
      error:
        "the upload probably succeeded but the reply was unreadable — retry at most once; if it repeats, stop and report it.",
    };
  }
  return { kind: "ok", value: record };
}

/** List an artifact's assets, one server page at a time. */
export async function listAssets(
  slug: string,
  after: string | undefined,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<AssetOutcome<AssetListResult>> {
  const res = await callAssetEndpoint(
    `/api/frame/blob/${encodeURIComponent(slug)}/agent-list`,
    {
      method: "POST",
      body: JSON.stringify({
        limit: ASSET_PAGE_SIZE,
        ...(after ? { after } : {}),
      }),
      contentType: "application/json",
    },
    { what: "listing", abortSignal: opts.abortSignal },
  );
  if (res.kind === "error") return res;

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.value.body);
  } catch {
    parsed = null;
  }
  const data = asRecord(parsed);
  if (!data || !Array.isArray(data.assets)) {
    return { kind: "error", error: "the listing reply was unreadable" };
  }
  const usage = asRecord(data.usage);
  return {
    kind: "ok",
    value: {
      assets: parseAssets(data.assets),
      usage: {
        files: typeof usage?.files === "number" ? usage.files : 0,
        bytes: typeof usage?.bytes === "number" ? usage.bytes : 0,
        max_files: typeof usage?.max_files === "number" ? usage.max_files : 0,
        max_bytes: typeof usage?.max_bytes === "number" ? usage.max_bytes : 0,
      },
      next: typeof data.next === "string" && data.next ? data.next : undefined,
    },
  };
}

/** Copy assets from another artifact. Returns the copies in `assetIds` order. */
export async function copyAssets(
  targetSlug: string,
  fromSlug: string,
  assetIds: string[],
  opts: { abortSignal?: AbortSignal } = {},
): Promise<AssetOutcome<AssetRecord[]>> {
  const res = await callAssetEndpoint(
    `/api/frame/blob/${encodeURIComponent(targetSlug)}/agent-copy`,
    {
      method: "POST",
      body: JSON.stringify({ from: fromSlug, ids: assetIds }),
      contentType: "application/json",
    },
    {
      what: "copy",
      timeoutMs: ASSET_LONG_TIMEOUT_MS,
      abortSignal: opts.abortSignal,
    },
  );
  if (res.kind === "error") return res;

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.value.body);
  } catch {
    parsed = null;
  }
  const data = asRecord(parsed);
  if (!data || !Array.isArray(data.assets)) {
    return {
      kind: "error",
      error:
        "the copy reply was unreadable — some assets may have been copied; run list_assets on the target before retrying.",
    };
  }
  // The server preserves `ids` order; re-key on `from_id` so a reordered or
  // partial reply still lines up with what was asked for.
  const copies = parseAssets(data.assets);
  const bySourceId = new Map<string, AssetRecord>();
  for (const raw of data.assets) {
    const record = asRecord(raw);
    const sourceId = record?.from_id;
    if (typeof sourceId === "string") {
      const copy = parseAssets([record])[0];
      if (copy) bySourceId.set(sourceId, copy);
    }
  }
  if (bySourceId.size > 0) {
    return {
      kind: "ok",
      value: assetIds.map((id) => bySourceId.get(id)).filter((x) => !!x),
    };
  }
  return { kind: "ok", value: copies };
}

/** Delete one asset. Idempotent: `deleted: false` means it was already gone. */
export async function deleteAsset(
  slug: string,
  assetId: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<AssetOutcome<{ deleted: boolean }>> {
  const res = await callAssetEndpoint(
    `/api/frame/blob/${encodeURIComponent(slug)}/${encodeURIComponent(assetId)}/agent-delete`,
    { method: "POST" },
    { what: "delete", abortSignal: opts.abortSignal },
  );
  if (res.kind === "error") return res;

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.value.body);
  } catch {
    parsed = null;
  }
  const data = asRecord(parsed);
  if (!data || typeof data.deleted !== "boolean") {
    return {
      kind: "error",
      error:
        "the delete may have succeeded but the reply was unreadable — list the assets to check.",
    };
  }
  return { kind: "ok", value: { deleted: data.deleted } };
}

/**
 * Read an asset's bytes. Goes through the artifact's `assetToken` (1-hour HMAC,
 * not the session JWT), so the session Bearer token is deliberately not sent.
 * A stale token answers 401, which is retried once against a fresh probe.
 */
export async function readAsset(
  slug: string,
  assetId: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<AssetOutcome<AssetReadResult>> {
  const serverUrl = authService.getServerUrl();

  for (let attempt = 0; attempt < 2; attempt++) {
    const metaResult = await fetchFrameMeta(slug, {
      abortSignal: opts.abortSignal,
    });
    if (metaResult.kind === "error") {
      return { kind: "error", error: metaResult.error };
    }
    const meta = metaResult.meta;
    const token = typeof meta.assetToken === "string" ? meta.assetToken : "";
    const version = typeof meta.version === "string" ? meta.version : "";
    const ownership = artifactOwnershipFromMeta(meta);
    if (!token || !version) {
      return {
        kind: "error",
        error: "artifact metadata did not include an asset token",
      };
    }

    const url = `${serverUrl}/_f/${encodeURIComponent(version)}/_blob/${encodeURIComponent(assetId)}?__frame_t=${encodeURIComponent(token)}`;
    let res: Response;
    try {
      res = await globalThis.fetch(url, {
        method: "GET",
        signal: requestSignal(ASSET_LIST_TIMEOUT_MS, opts.abortSignal),
      });
    } catch (error) {
      logger?.warn("Artifact asset read failed", { error: String(error) });
      return {
        kind: "error",
        error: `the request failed in transit or timed out: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (res.status === 401) {
      // The `__frame_t` HMAC was refused: probe once more for a fresh token.
      if (attempt === 0) continue;
      return {
        kind: "error",
        error:
          "the asset was refused with HTTP 401 twice — the artifact may have been unshared or taken down.",
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        kind: "error",
        error: describeAssetError(
          res.status,
          res.statusText,
          body,
          "asset read",
        ),
      };
    }

    return {
      kind: "ok",
      value: {
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "",
        ownership,
      },
    };
  }

  return {
    kind: "error",
    error: "the asset could not be read — retry once, then report it.",
  };
}
