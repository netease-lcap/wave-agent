/**
 * Artifact page comments (`ArtifactComments` tool's `read` / `reply` / `resolve`).
 *
 * Server contract (codechat 第二期, live): the thread list is a single flat
 * page of rows — thread roots and their replies together, one level deep — and
 * an optional opaque `cursor` turns the same endpoint into an incremental read.
 * The cursor is server-generated and must be passed back verbatim. Which axis a
 * `?cursor=` means is decided by the server: an untruncated page comes back with
 * the incremental `cursor` (updated-at, equal to the stream's `head`), a
 * truncated one with `nextCursor` (created-at, full-list paging) — never both.
 *
 * Two server-computed facts drive everything the client says:
 * - `awaitingAgentReply` is the ONLY judgement of "should the agent answer"
 *   (it already accounts for whether an agent is standing behind the thread).
 * - `unresolvedCount` is always computed over the whole page, so it is a badge
 *   regardless of how incremental the read was.
 *
 * Rendering lives here rather than in the tool so the wake path (which only
 * counts) and the `read` action (which prints) read the same parsed rows.
 */

import { authService, createAuthAwareFetch } from "./authService.js";
import type {
  ArtifactCommentsCommentData,
  ArtifactCommentsReadResultData,
  ArtifactCommentsThreadData,
} from "../tools/resultData/artifactComments.js";
import { logger } from "../utils/globalLogger.js";

const COMMENT_TIMEOUT_MS = 15_000;
/** One retry on a first-attempt network error or 5xx, matching artifact list. */
const COMMENT_RETRY_DELAY_MS = 300;

/** Server limit for one reply body, in UTF-8 **bytes** (not characters). */
export const COMMENT_TEXT_MAX_BYTES = 4096;
/** Anchor excerpt kept in the rendered thread header. */
const ANCHOR_RENDER_MAX_CHARS = 60;

export type CommentOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: string; status?: number };

export interface CommentAuthor {
  uuid: string;
  fullName: string;
}

export interface ArtifactComment {
  id: string;
  /** The thread this row belongs to — the root's own id for a root row. */
  threadId: string;
  text: string;
  status: "open" | "resolved";
  authorKind: "user" | "agent";
  replyToCommentId: string | null;
  continuesReplyId: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  isOwn: boolean;
  /** Server-computed: a person asked, and no agent has answered this thread yet. */
  awaitingAgentReply: boolean;
  /** One-line description of where the comment is anchored, or null. */
  anchor: string | null;
  /** The row's own cursor, when the server sends one (incremental read tail). */
  cursor: string | null;
}

export interface CommentPage {
  comments: ArtifactComment[];
  unresolvedCount: number;
  /** Present only when the server truncated the page. */
  nextCursor?: string;
  /**
   * Incremental position for the end of this read — the server's `cursor`
   * (updated-at axis, equal to the stream's `head`). Absent on a truncated
   * page, because there `nextCursor` continues the *other* axis; a caller that
   * keeps a position must page with `nextCursor` until it reaches an
   * untruncated page.
   */
  tailCursor?: string;
  truncated: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Collapse whitespace/newlines so one comment fits on one rendered line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseAuthor(raw: unknown): CommentAuthor | null {
  const author = asRecord(raw);
  if (!author) return null;
  return { uuid: str(author.uuid), fullName: str(author.fullName) };
}

/**
 * Anchor → one line. The server's anchor payload is a discriminated union whose
 * fields differ per `kind`; only the locator fields are ever shown, and an
 * unknown shape degrades to the kind alone rather than dropping the anchor.
 */
function summarizeAnchor(raw: unknown): string | null {
  const anchor = asRecord(raw);
  if (!anchor) return null;
  const kind = str(anchor.kind).trim();
  const selection = str(anchor.text).trim() || str(anchor.quote).trim();
  if (selection) {
    return `${kind || "text"}: "${clip(oneLine(selection), ANCHOR_RENDER_MAX_CHARS)}"`;
  }
  const locator =
    str(anchor.selector).trim() ||
    str(anchor.domPath).trim() ||
    str(anchor.path).trim() ||
    str(anchor.id).trim();
  if (locator) {
    return `${kind || "element"} ${clip(oneLine(locator), ANCHOR_RENDER_MAX_CHARS)}`;
  }
  return kind || null;
}

function parseComment(
  raw: unknown,
  fallbackCursor: string | null,
): ArtifactComment | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = str(row.id).trim();
  if (!id) return null;
  const replyTo = str(row.replyToCommentId).trim() || null;
  const author = parseAuthor(row.author);
  return {
    id,
    threadId: replyTo ?? id,
    text: str(row.text),
    status: row.status === "resolved" ? "resolved" : "open",
    authorKind: row.authorKind === "agent" ? "agent" : "user",
    replyToCommentId: replyTo,
    continuesReplyId: str(row.continuesReplyId).trim() || null,
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    authorName:
      author?.fullName?.trim() ||
      (row.authorKind === "agent" ? "agent" : "someone"),
    isOwn: row.isOwn === true,
    awaitingAgentReply: row.awaitingAgentReply === true,
    anchor: summarizeAnchor(row.anchor),
    cursor: str(row.cursor).trim() || fallbackCursor,
  };
}

function requestSignal(abortSignal?: AbortSignal): AbortSignal {
  return abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(COMMENT_TIMEOUT_MS)])
    : AbortSignal.timeout(COMMENT_TIMEOUT_MS);
}

function commentsUrl(slug: string, cursor?: string): string {
  const serverUrl = authService.getServerUrl();
  const base = `${serverUrl}/api/frame/comments/${encodeURIComponent(slug)}`;
  return cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base;
}

/** Every write must carry `via=agent`: it decides `author_kind` and the rate bucket. */
function agentUrl(slug: string, suffix: string): string {
  const serverUrl = authService.getServerUrl();
  return `${serverUrl}/api/frame/comments/${encodeURIComponent(slug)}${suffix}?via=agent`;
}

/** Map a non-2xx comment response to something a model can act on. */
function describeStatus(
  status: number,
  statusText: string,
  body: string,
): string {
  const data = asRecord(safeJson(body));
  const serverMessage = str(data?.message) || str(data?.error);
  const code = str(data?.code);
  if (status === 401 || status === 403) {
    return `authentication failed (HTTP ${status}). Run /login again and retry.${serverMessage ? ` Server said: ${serverMessage}` : ""}`;
  }
  if (status === 404) {
    return `the artifact or thread was not found (HTTP 404)${serverMessage ? `: ${serverMessage}` : ""}`;
  }
  if (status === 429) {
    return `rate limited by the server (HTTP 429)${serverMessage ? `: ${serverMessage}` : ""} — wait a moment before trying again`;
  }
  if (status === 409) {
    return `conflict (HTTP 409)${code ? ` ${code}` : ""}${serverMessage ? `: ${serverMessage}` : ""}`;
  }
  return `the server returned HTTP ${status} ${statusText}${serverMessage ? ` — ${serverMessage}` : ""}`;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/**
 * Read a page of comments. Without `cursor` this is the full thread list
 * (`created_at ASC`); with one it returns only the rows that changed since.
 */
export async function fetchComments(
  slug: string,
  cursor?: string,
  opts: { abortSignal?: AbortSignal } = {},
): Promise<CommentOutcome<CommentPage>> {
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const url = commentsUrl(slug, cursor);

  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await authFetch(url, {
        method: "GET",
        signal: requestSignal(opts.abortSignal),
      });
    } catch (error) {
      if (attempt === 0 && !opts.abortSignal?.aborted) {
        await delay(COMMENT_RETRY_DELAY_MS);
        continue;
      }
      logger?.warn("Artifact comments read failed", {
        slug,
        error: String(error),
      });
      return {
        kind: "error",
        error: `failed to reach the server: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (res.status >= 500 && attempt === 0 && !opts.abortSignal?.aborted) {
      await delay(COMMENT_RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  if (!res) return { kind: "error", error: "failed to reach the server" };
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      error: describeStatus(res.status, res.statusText, body),
    };
  }

  const data = asRecord(safeJson(body));
  if (!data || !Array.isArray(data.comments)) {
    return { kind: "error", error: "malformed response: no comments array" };
  }

  const raw = data.comments as unknown[];
  const comments: ArtifactComment[] = [];
  for (const row of raw) {
    const parsed = parseComment(row, null);
    if (parsed) comments.push(parsed);
  }
  if (raw.length > 0 && comments.length === 0) {
    return { kind: "error", error: "response rows were unreadable" };
  }

  const nextCursor = str(data.nextCursor).trim() || undefined;
  // The two cursors are on different axes and are mutually exclusive:
  // `nextCursor` (created-at axis, only when `truncated`) pages through the
  // full list, while `cursor` (updated-at axis, only on an untruncated page,
  // always equal to the stream's `head`) is the incremental position. Handing
  // `nextCursor` to an incremental caller would silently skip rows, so the
  // tail is the incremental cursor and nothing else. An older server sent
  // neither consistently; the caller then falls back to the head it saw before
  // the read (at worst it re-reads a row, never loses one).
  const tailCursor = str(data.cursor).trim() || undefined;

  return {
    kind: "ok",
    value: {
      comments,
      unresolvedCount:
        typeof data.unresolvedCount === "number" ? data.unresolvedCount : 0,
      nextCursor,
      tailCursor,
      truncated: data.truncated === true,
    },
  };
}

export interface ReplyResult {
  replied: boolean;
  threadId: string;
  commentId?: string;
  /** `alreadyAnswered` — not an error: the thread already has an agent reply. */
  alreadyAnswered?: boolean;
  standingReplyId?: string;
}

/** Post a reply into an existing thread. `threadId` may be any row in it. */
export async function postReply(
  slug: string,
  threadId: string,
  body: {
    text: string;
    continuesReplyId?: string;
    acknowledgeDuplicate?: boolean;
  },
  opts: { abortSignal?: AbortSignal } = {},
): Promise<CommentOutcome<ReplyResult>> {
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const payload: Record<string, unknown> = { text: body.text };
  if (body.continuesReplyId) payload.continuesReplyId = body.continuesReplyId;
  if (body.acknowledgeDuplicate) payload.acknowledgeDuplicate = true;

  let res: Response;
  try {
    res = await authFetch(agentUrl(slug, `/${encodeURIComponent(threadId)}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: requestSignal(opts.abortSignal),
    });
  } catch (error) {
    logger?.warn("Artifact comment reply failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      error: `the request failed in transit or timed out — re-read the thread before retrying (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      error: describeStatus(res.status, res.statusText, text),
    };
  }
  const data = asRecord(safeJson(text));
  if (!data)
    return { kind: "error", error: "the reply response was unreadable" };

  const resolvedThreadId = str(data.threadId).trim() || threadId;
  if (data.replied === false || data.alreadyAnswered === true) {
    return {
      kind: "ok",
      value: {
        replied: false,
        alreadyAnswered: true,
        threadId: resolvedThreadId,
        standingReplyId: str(data.standingReplyId).trim() || undefined,
      },
    };
  }
  return {
    kind: "ok",
    value: {
      replied: true,
      threadId: resolvedThreadId,
      commentId: str(data.commentId).trim() || undefined,
    },
  };
}

export type ResolveOutcome =
  | { kind: "ok"; resolved: boolean; threadId: string }
  | { kind: "conflict"; live?: string; message?: string }
  | { kind: "error"; error: string; status?: number };

/**
 * Resolve or reopen a thread. `afterVersion` makes the server refuse stale edits;
 * it is a positive integer (a string is rejected with 400 INVALID_AFTER_VERSION).
 */
export async function postResolve(
  slug: string,
  threadId: string,
  body: { resolved: boolean; afterVersion?: number },
  opts: { abortSignal?: AbortSignal } = {},
): Promise<ResolveOutcome> {
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const payload: Record<string, unknown> = { resolved: body.resolved };
  if (body.afterVersion !== undefined) payload.afterVersion = body.afterVersion;

  let res: Response;
  try {
    res = await authFetch(
      agentUrl(slug, `/${encodeURIComponent(threadId)}/resolve`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: requestSignal(opts.abortSignal),
      },
    );
  } catch (error) {
    logger?.warn("Artifact comment resolve failed", {
      slug,
      error: String(error),
    });
    return {
      kind: "error",
      error: `the request failed in transit or timed out — re-read the thread before retrying (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const text = await res.text().catch(() => "");
  if (res.status === 409) {
    const data = asRecord(safeJson(text));
    return {
      kind: "conflict",
      live: str(data?.live).trim() || undefined,
      message: str(data?.message).trim() || undefined,
    };
  }
  if (!res.ok) {
    return {
      kind: "error",
      status: res.status,
      error: describeStatus(res.status, res.statusText, text),
    };
  }
  const data = asRecord(safeJson(text));
  return {
    kind: "ok",
    resolved:
      typeof data?.status === "string"
        ? data.status === "resolved"
        : body.resolved,
    threadId,
  };
}

// --- Result data ---
//
// 这里只产 `data`（issue #3055 阶段 2），正文由
// `src/tools/resultData/artifactComments.ts` 的渲染器从 `data` 重建 —— 与本文件
// 其余部分的分工一致：服务层取数、resultData 层定形状与措辞。形状对齐 CC 的
// `Nr`（`2058-125829B-hIi.js:782`）：扁平的评论行在这里重新组装成
// `threads[].comments[]`。

export interface RenderOptions {
  url: string;
  /** The cursor the caller passed in, when the read was incremental. */
  cursor?: string;
}

function toCommentData(comment: ArtifactComment): ArtifactCommentsCommentData {
  return {
    id: comment.id,
    account: comment.authorName,
    role: comment.authorKind === "agent" ? "agent" : "user",
    text: comment.text,
    ...(comment.createdAt ? { created_at: comment.createdAt } : {}),
    ...(comment.awaitingAgentReply ? { awaiting_reply: true as const } : {}),
    ...(comment.continuesReplyId
      ? { continues_reply_id: comment.continuesReplyId }
      : {}),
  };
}

/**
 * 一页评论 → `ArtifactComments` 的 `read` 结果数据（CC `Nr` 形状；`action` 由工具
 * 补上，服务层不认识工具名）。
 *
 * 分组的两个判据都在服务端这一侧：根行 `replyToCommentId === null`，线程按根的
 * `createdAt` 排序。根不在本页（增量读 / 截断）时只带回复并打 `root_missing`，
 * 渲染器据此换成那句「根不在这一页」的说明。
 */
export function commentThreadsData(
  page: CommentPage,
  opts: RenderOptions,
): Omit<ArtifactCommentsReadResultData, "action"> {
  const roots = new Map<string, ArtifactComment>();
  const replies = new Map<string, ArtifactComment[]>();
  for (const comment of page.comments) {
    if (comment.replyToCommentId === null) {
      roots.set(comment.threadId, comment);
    } else {
      const list = replies.get(comment.threadId) ?? [];
      list.push(comment);
      replies.set(comment.threadId, list);
    }
  }

  const threadIds = [...new Set(page.comments.map((c) => c.threadId))].sort(
    (a, b) => {
      const left = roots.get(a)?.createdAt ?? "";
      const right = roots.get(b)?.createdAt ?? "";
      return left.localeCompare(right);
    },
  );

  const threads: ArtifactCommentsThreadData[] = threadIds.map((threadId) => {
    const root = roots.get(threadId);
    const members = [...(root ? [root] : []), ...(replies.get(threadId) ?? [])];
    return {
      id: threadId,
      ...(root?.createdAt ? { created_at: root.createdAt } : {}),
      resolved: root?.status === "resolved",
      // CC 的 `claude_activated`：本线程里有 agent 参与过（回过帖）。
      claude_activated: members.some((c) => c.authorKind === "agent"),
      ...(root?.anchor ? { anchor_label: root.anchor } : {}),
      ...(root?.isOwn ? { own: true as const } : {}),
      ...(root ? {} : { root_missing: true as const }),
      comments: members.map(toCommentData),
    };
  });

  return {
    url: opts.url,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    unresolved_count: page.unresolvedCount,
    threads,
    ...(page.truncated && page.nextCursor
      ? { threads_dropped: true as const, next_cursor: page.nextCursor }
      : {}),
  };
}
