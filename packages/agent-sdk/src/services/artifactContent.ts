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
  version?: string;
  title?: string;
  favicon?: string;
  perm?: { mode: "owner" | "users" | "org"; role?: string };
  url?: string;
  contentUrl?: string;
  /** Empty/missing = shared-live (readers see live updates); non-empty = pinned. */
  shared?: string;
}

/** The publishing user's relationship to an artifact. */
export type ArtifactOwnership = "owner" | "reader";

export interface ArtifactContent {
  slug: string;
  version: string;
  ownership: ArtifactOwnership;
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
  const version = typeof meta.version === "string" ? meta.version : "";
  const contentUrl = typeof meta.contentUrl === "string" ? meta.contentUrl : "";
  if (!contentUrl) {
    return {
      kind: "error",
      error: "Artifact metadata did not include a contentUrl",
    };
  }

  // Unknown ownership is treated as reader-owned: never hand out full text of a
  // page we cannot prove the user owns.
  const ownership: ArtifactOwnership =
    meta.perm?.mode === "owner" || meta.perm?.role === "owner"
      ? "owner"
      : "reader";

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
  html: string,
  context: ToolContext,
): Promise<ToolResult> {
  const markdown = htmlToMarkdown(html);
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
  return result;
}
