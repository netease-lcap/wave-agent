/**
 * Shared artifact content layer.
 *
 * The single implementation of artifact content retrieval: slug extraction,
 * metadata probe (`via=model_read`), ownership detection, Bearer-authenticated
 * content fetch, HTML→markdown conversion and large-content persistence.
 * Both the Artifact tool's `read` action and WebFetch's artifact URL
 * interception call into it (spec: 读取实现单一化).
 */

import TurndownService from "turndown";
import { authService, createAuthAwareFetch } from "./authService.js";
import { logger } from "../utils/globalLogger.js";
import {
  buildPersistedOutputMessage,
  generatePreview,
  persistToolResult,
} from "../utils/toolResultStorage.js";
import { processContentWithAI } from "./contentSummarizer.js";
import type { ToolContext, ToolResult } from "../tools/types.js";

/** Metadata/content request timeout. */
const ARTIFACT_READ_TIMEOUT_MS = 60_000;
/** Artifact content beyond this size is persisted to a temp file (path + preview). */
export const ARTIFACT_PREVIEW_BYTES = 2 * 1024;
/** Inline fallback when persisting large content fails. */
const MAX_INLINE_ARTIFACT_CHARS = 100_000;
/** Used when the caller reads someone else's artifact without a `prompt`. */
export const DEFAULT_READ_SUMMARY_PROMPT =
  "Summarize this page: its purpose, structure, and key content.";

/** Frame metadata returned by `GET /api/frame/{slug}?via=model_read`. */
export interface FrameMeta {
  slug?: string;
  /**
   * Frame version. The server sends a number (`1`, `2`, …); a string is only
   * accepted for robustness, so always read it through `artifactVersionOf`.
   */
  version?: string | number;
  title?: string;
  favicon?: string;
  perm?: { mode: "owner" | "users" | "org"; role?: string };
  url?: string;
  contentUrl?: string;
  /**
   * Short-lived (1h) HMAC for reading the artifact's `_blob` assets. Derived
   * server-side from `JWT_SECRET`, so it is not a session token and must only
   * travel as the `__frame_t` query parameter.
   */
  assetToken?: string;
  /** Empty/missing = shared-live (readers see live updates); non-empty = pinned. */
  shared?: string;
}

/** The publishing user's relationship to an artifact. */
export type ArtifactOwnership = "owner" | "reader";

export interface ArtifactContent {
  slug: string;
  version: string;
  ownership: ArtifactOwnership;
  /**
   * Model-facing sharing status (scope + this session's role + the read-only
   * note), or null when the server reported no `perm`. Computed here so the
   * Artifact tool's `read` and WebFetch's interception render it identically.
   */
  sharingNotice: string | null;
  /** Raw HTML as stored server-side (inline CSS/JS preserved). */
  html: string;
  bytes: number;
}

export type FrameMetaResult =
  | { kind: "ok"; meta: FrameMeta }
  | { kind: "error"; status: number; error: string };

export type ArtifactContentResult =
  | { kind: "ok"; artifact: ArtifactContent }
  | { kind: "error"; status?: number; error: string };

/** Extract the artifact slug from a `{host}/code/artifact/{slug}` URL. */
export function extractArtifactSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/code\/artifact\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a value is usable as a slug in a request path. Slugs are short
 * alphanumeric tokens; anything else (a decoded `../`, a slash, whitespace) is
 * rejected so it can never reshape the URL it is interpolated into.
 */
export function isValidArtifactSlug(slug: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(slug);
}

/**
 * The frame version as a string, or "" when the server sent none. The wire type
 * is a number, so a `typeof === "string"` check silently drops it (which would
 * lose version tracking on reads and make `read_asset` unable to build its URL).
 */
export function artifactVersionOf(meta: FrameMeta): string {
  const { version } = meta;
  return typeof version === "string" || typeof version === "number"
    ? String(version)
    : "";
}

/**
 * The publishing user's relationship to an artifact, from the metadata probe.
 * Unknown ownership resolves to "reader": never hand out the full text of a
 * page we cannot prove the user owns.
 */
export function artifactOwnershipFromMeta(
  meta: Pick<FrameMeta, "perm">,
): ArtifactOwnership {
  return meta.perm?.mode === "owner" || meta.perm?.role === "owner"
    ? "owner"
    : "reader";
}

/** How each server share mode reads to the model. */
const SHARING_MODE_TEXT: Record<"owner" | "users" | "org", string> = {
  owner:
    "private — only you can open it, other people cannot open the link until it is shared",
  users: "shared with specific people",
  org: "visible to everyone in your organization",
};

/**
 * Claude Code's fixed closing sentence for every sharing note: sharing is not
 * something the tool can change (the server only lets the owner do it, from the
 * web shell).
 */
const SHARING_READONLY_NOTE =
  "You cannot change sharing; that is done from the page's Share menu.";

/**
 * The sharing status rendered for the model, or null when the server sent no
 * `perm` (never guess "private" — an unshared page and an unreported one must
 * not look the same).
 *
 * `role` overrides the ownership derived from the metadata, for callers that
 * already proved ownership another way (a successful deploy can only be done by
 * a writer).
 */
export function formatArtifactSharing(
  meta: FrameMeta | null | undefined,
  options: { role?: ArtifactOwnership } = {},
): string | null {
  const perm = meta?.perm;
  if (!perm) return null;
  // Only the three modes codechat actually serves; anything else stays unsaid
  // rather than being rendered as a guess.
  const mode = perm.mode;
  if (mode !== "owner" && mode !== "users" && mode !== "org") return null;

  const ownership = options.role ?? artifactOwnershipFromMeta(meta);
  if (ownership === "reader") {
    return [
      "Sharing: this page is shared with you by someone else — you are a reader, so this session can never publish to it. Publish a new artifact instead.",
      SHARING_READONLY_NOTE,
    ].join("\n");
  }

  return [`Sharing: ${SHARING_MODE_TEXT[mode]}.`, SHARING_READONLY_NOTE].join(
    "\n",
  );
}

function readSignal(abortSignal?: AbortSignal): AbortSignal {
  return abortSignal
    ? AbortSignal.any([
        abortSignal,
        AbortSignal.timeout(ARTIFACT_READ_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(ARTIFACT_READ_TIMEOUT_MS);
}

/** Probe artifact metadata; `via=model_read` marks model access. */
export async function fetchFrameMeta(
  slug: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<FrameMetaResult> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  try {
    const res = await authFetch(
      `${serverUrl}/api/frame/${encodeURIComponent(slug)}?via=model_read`,
      { method: "GET", signal: readSignal(opts.abortSignal) },
    );
    if (!res.ok) {
      return {
        kind: "error",
        status: res.status,
        error: `Failed to fetch artifact metadata: ${res.status} ${res.statusText}`,
      };
    }
    return { kind: "ok", meta: (await res.json()) as FrameMeta };
  } catch (error) {
    logger?.warn("Artifact metadata probe failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      status: 0,
      error: `Failed to fetch artifact metadata: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Read an artifact's content. Owner reads come back as raw HTML (inline CSS/JS
 * intact); ownership is decided from the server metadata so readers of someone
 * else's page can be routed to the isolated-summary path.
 */
export async function readArtifactContent(
  slug: string,
  opts: { url?: string; abortSignal?: AbortSignal } = {},
): Promise<ArtifactContentResult> {
  const displayUrl = opts.url || slug;
  const metaResult = await fetchFrameMeta(slug, {
    abortSignal: opts.abortSignal,
  });
  if (metaResult.kind === "error") {
    if (metaResult.status === 404) {
      return {
        kind: "error",
        status: 404,
        error: `Artifact not found: ${displayUrl} (it may have been deleted)`,
      };
    }
    if (metaResult.status === 403) {
      return {
        kind: "error",
        status: 403,
        error: `You do not have permission to read this artifact: ${displayUrl}`,
      };
    }
    return {
      kind: "error",
      status: metaResult.status,
      error: metaResult.error,
    };
  }

  const meta = metaResult.meta;
  const version = artifactVersionOf(meta);
  const contentUrl = typeof meta.contentUrl === "string" ? meta.contentUrl : "";
  if (!contentUrl) {
    return {
      kind: "error",
      error: "Artifact metadata did not include a contentUrl",
    };
  }

  // Unknown ownership is treated as reader-owned: never hand out full text of a
  // page we cannot prove the user owns.
  const ownership = artifactOwnershipFromMeta(meta);

  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  let html: string;
  try {
    const res = await authFetch(new URL(contentUrl, serverUrl).toString(), {
      method: "GET",
      signal: readSignal(opts.abortSignal),
    });
    if (res.status === 403) {
      return {
        kind: "error",
        status: 403,
        error: `You do not have permission to read this artifact: ${displayUrl}`,
      };
    }
    if (!res.ok) {
      return {
        kind: "error",
        status: res.status,
        error: `Failed to fetch artifact content: ${res.status} ${res.statusText}`,
      };
    }
    html = await res.text();
  } catch (error) {
    logger?.warn("Artifact content fetch failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      error: `Failed to fetch artifact content: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    kind: "ok",
    artifact: {
      slug,
      version,
      ownership,
      sharingNotice: formatArtifactSharing(meta),
      html,
      bytes: new TextEncoder().encode(html).length,
    },
  };
}

/** Convert artifact HTML to markdown (the summary path feeds text, not markup). */
export function htmlToMarkdown(html: string): string {
  return new TurndownService().turndown(html);
}

/** Whether content is too large to return inline. */
export function isLargeArtifactContent(content: string): boolean {
  return new TextEncoder().encode(content).length > ARTIFACT_PREVIEW_BYTES;
}

/**
 * Persist content to a temp file and return the `<persisted-output>` message.
 * Returns null when the content is small enough to inline, or on write failure.
 */
export function persistArtifactContent(content: string): string | null {
  if (!isLargeArtifactContent(content)) return null;
  const filePath = persistToolResult(content, "artifact");
  if (!filePath) return null;
  return buildPersistedOutputMessage(
    content.length,
    filePath,
    generatePreview(content),
  );
}

/**
 * Reader view: run someone else's artifact through the fast model and return
 * only the answer, so the full page never reaches the main conversation.
 */
export async function summarizeArtifactAsReader(
  url: string,
  prompt: string,
  artifact: ArtifactContent,
  context: ToolContext,
): Promise<ToolResult> {
  const markdown = htmlToMarkdown(artifact.html);
  const bytes = new TextEncoder().encode(markdown).length;
  const persisted = persistArtifactContent(markdown);
  let aiInput = markdown;
  if (persisted) {
    aiInput = persisted;
  } else if (bytes > ARTIFACT_PREVIEW_BYTES) {
    aiInput =
      markdown.substring(0, MAX_INLINE_ARTIFACT_CHARS) +
      "\n\n... (content truncated, failed to persist full output)";
  }

  const result = await processContentWithAI(
    url,
    prompt || DEFAULT_READ_SUMMARY_PROMPT,
    aiInput,
    200,
    "OK",
    context,
    bytes,
  );
  if (persisted) {
    // Append the persisted-output message so the model can Read the full text.
    result.content = result.content
      ? result.content + "\n\n" + persisted
      : persisted;
  }
  if (result.success && artifact.sharingNotice) {
    // Same header the owner-facing `read` prepends, so both routes say the same
    // thing about sharing.
    result.content = result.content
      ? `${artifact.sharingNotice}\n\n${result.content}`
      : artifact.sharingNotice;
  }
  return result;
}
