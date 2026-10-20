/**
 * Per-agent artifact comment watcher (`Artifact` tool's `watch` / `unwatch`).
 *
 * The server keeps **no subscription state**: opening the SSE stream *is*
 * subscribing and closing it is unsubscribing, so `watch` / `unwatch` are
 * purely local actions and this manager owns everything that has to outlive a
 * single tool call — the connection, the known cursor, the reconnect backoff,
 * and the (throttled) wake-up of the session.
 *
 * The stream carries **signals, not data**: every frame is compared against the
 * cursor this manager already pulled to, and the actual comments are fetched
 * through the same read endpoint the `comments` action uses. `head` is an
 * opaque cursor for "the newest row on this page", so the comparison is plain
 * string equality — nothing here parses or orders it, which is what makes
 * reconnects, server restarts and replica changes self-heal.
 *
 * State is per-instance (one manager per agent, registered in the container).
 * A module-level registry would outlive the session that created it and
 * accumulate per sessionId — see `services/artifactSession.ts` for that bug.
 */

import { Container } from "../utils/container.js";
import type { MessageQueue } from "./messageQueue.js";
import { authService, createAuthAwareFetch } from "../services/authService.js";
import { logger } from "../utils/globalLogger.js";
import { pageCommentEventToXml } from "../utils/pageCommentEventXml.js";
import {
  fetchComments,
  type ArtifactComment,
} from "../services/artifactComments.js";

/** How long new comment events on one page are merged into a single wake-up. */
export const COMMENT_WAKE_WINDOW_MS = 30_000;
/** Reconnect backoff steps; the last entry repeats (jittered) forever. */
export const WATCH_BACKOFF_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** Server cap on concurrent streams per account. */
export const MAX_CONCURRENT_STREAMS = 8;

export type WatchStatus = "connecting" | "watching" | "backoff" | "stopped";

export type WatchOutcome =
  | { kind: "watching"; slug: string; already: boolean; note?: string }
  | { kind: "error"; error: string };

export interface WatchState {
  slug: string;
  url?: string;
  status: WatchStatus;
  /** Last known read position; null until the first successful read or `hello`. */
  cursor: string | null;
  error?: string;
}

interface WatchEntry {
  slug: string;
  url?: string;
  status: WatchStatus;
  cursor: string | null;
  /** Latest `head` seen on any frame — the fallback cursor after a plain read. */
  head: string | null;
  error?: string;
  attempt: number;
  abort: AbortController | null;
  retryTimer: NodeJS.Timeout | null;
  wakeTimer: NodeJS.Timeout | null;
  /** Coalesces overlapping reads triggered by frames on the same stream. */
  reading: Promise<{ ok: boolean; awaiting: ArtifactComment[] }> | null;
  /** Settles the promise returned by `watch()`; cleared once it has fired. */
  opened?: (outcome: WatchOutcome) => void;
}

export interface PageWatchOptions {
  /** Merge window for wake-ups on the same page. */
  wakeWindowMs?: number;
  backoffDelaysMs?: number[];
}

export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Split an SSE byte stream into frames on blank lines. Comment lines (`:`) and
 * `id:` / `retry:` fields are ignored — the server sends `event:` + `data:`.
 */
export function parseSseFrames(buffer: string): {
  frames: SseFrame[];
  rest: string;
} {
  const frames: SseFrame[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }
    if (event && dataLines.length > 0) {
      frames.push({ event, data: dataLines.join("\n") });
    }
  }
  return { frames, rest };
}

/** Artifact page URL for a slug, so the model gets a URL it can pass back. */
function pageUrlFor(slug: string): string {
  return `${authService.getServerUrl()}/code/artifact/${encodeURIComponent(slug)}`;
}

export class PageWatchManager {
  private entries = new Map<string, WatchEntry>();
  private stopped = false;
  private readonly wakeWindowMs: number;
  private readonly backoffDelaysMs: number[];

  constructor(
    private container: Container,
    options: PageWatchOptions = {},
  ) {
    this.wakeWindowMs = options.wakeWindowMs ?? COMMENT_WAKE_WINDOW_MS;
    this.backoffDelaysMs =
      options.backoffDelaysMs && options.backoffDelaysMs.length > 0
        ? options.backoffDelaysMs
        : WATCH_BACKOFF_DELAYS_MS;
  }

  /**
   * Start (or reuse) a stream for `slug`. Resolves once the server has answered
   * the stream request, so a 429 / 401 / 404 reaches the tool as a real error;
   * a transport failure resolves as "watching, retrying in the background"
   * because the watcher keeps trying after the tool call returns.
   */
  public async watch(slug: string, url?: string): Promise<WatchOutcome> {
    if (this.stopped) {
      return {
        kind: "error",
        error: "page watching is unavailable: the session is shut down",
      };
    }
    if (!authService.getSSOToken()) {
      return {
        kind: "error",
        error:
          "not authenticated. Run /login to connect your account before watching comments",
      };
    }

    const live = this.entries.get(slug);
    if (live && (live.status === "watching" || live.status === "connecting")) {
      // Idempotent: one stream per page, never two (the server caps at 8).
      return { kind: "watching", slug, already: true };
    }
    if (live) this.teardownEntry(live);

    const entry: WatchEntry = {
      slug,
      ...(url ? { url } : {}),
      status: "connecting",
      cursor: null,
      head: null,
      attempt: 0,
      abort: null,
      retryTimer: null,
      wakeTimer: null,
      reading: null,
    };
    this.entries.set(slug, entry);
    const opened = new Promise<WatchOutcome>((resolve) => {
      entry.opened = resolve;
    });
    void this.connect(entry);
    return opened;
  }

  /** Stop watching `slug`. Returns false when it was not being watched. */
  public unwatch(slug: string): boolean {
    const entry = this.entries.get(slug);
    if (!entry) return false;
    this.entries.delete(slug);
    this.teardownEntry(entry);
    return true;
  }

  /** Snapshot of every watched page (diagnostics and tests). */
  public listWatched(): WatchState[] {
    return [...this.entries.values()].map((entry) => ({
      slug: entry.slug,
      ...(entry.url ? { url: entry.url } : {}),
      status: entry.status,
      cursor: entry.cursor,
      ...(entry.error ? { error: entry.error } : {}),
    }));
  }

  public isWatching(slug: string): boolean {
    const entry = this.entries.get(slug);
    return entry?.status === "watching" || entry?.status === "connecting";
  }

  /** Session end: drop every stream and timer. */
  public stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) this.teardownEntry(entry);
    this.entries.clear();
  }

  // --- connection ---

  private async connect(entry: WatchEntry): Promise<void> {
    if (this.stopped || entry.status === "stopped") return;
    const abort = new AbortController();
    entry.abort = abort;
    entry.status = entry.attempt === 0 ? "connecting" : "backoff";

    const authFetch = createAuthAwareFetch(globalThis.fetch);
    let res: Response;
    try {
      res = await authFetch(
        `${authService.getServerUrl()}/api/frame/comments/${encodeURIComponent(entry.slug)}/stream`,
        {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: abort.signal,
        },
      );
    } catch (error) {
      if (this.stopped || abort.signal.aborted) return;
      logger?.warn("Artifact comment stream connect failed", {
        slug: entry.slug,
        error: String(error),
      });
      // The tool call has already been answered with a "retrying" note; the
      // watcher keeps trying so a flaky network does not silently unhook it.
      this.resolveOpened(entry, {
        kind: "watching",
        slug: entry.slug,
        already: false,
        note: "the connection could not be established yet — retrying in the background",
      });
      this.scheduleReconnect(entry);
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.resolveOpened(entry, {
        kind: "error",
        error: this.describeStreamRejection(res.status, body),
      });
      this.failEntry(entry, this.describeStreamRejection(res.status, body));
      return;
    }
    if (!res.body) {
      const message = "the server accepted the stream but sent no body";
      this.resolveOpened(entry, { kind: "error", error: message });
      this.scheduleReconnect(entry);
      return;
    }

    entry.status = "watching";
    entry.attempt = 0;
    this.resolveOpened(entry, {
      kind: "watching",
      slug: entry.slug,
      already: false,
    });
    await this.consume(entry, res.body, abort.signal);
    if (this.isDead(entry)) return;
    if (abort.signal.aborted) return;
    // The server closed the stream: reconnect and let `hello.head` self-heal.
    this.scheduleReconnect(entry);
  }

  private async consume(
    entry: WatchEntry,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) this.handleFrame(entry, frame);
      }
    } catch (error) {
      if (!signal.aborted) {
        logger?.warn("Artifact comment stream interrupted", {
          slug: entry.slug,
          error: String(error),
        });
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  /**
   * Whether this entry must do nothing more. Read through a method on purpose:
   * `entry.status` is also mutated by the frame handler while a read is in
   * flight, so narrowing it at the assignment site would be wrong.
   */
  private isDead(entry: WatchEntry): boolean {
    return this.stopped || entry.status === "stopped";
  }

  /** Map a non-2xx stream response: some are terminal, some are worth retrying. */
  private describeStreamRejection(status: number, body: string): string {
    let code = "";
    let serverMessage = "";
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      code = typeof parsed.code === "string" ? parsed.code : "";
      serverMessage =
        typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
            ? parsed.message
            : "";
    } catch {
      serverMessage = body.trim();
    }
    if (status === 429 && code === "TOO_MANY_STREAMS") {
      return (
        `already watching ${MAX_CONCURRENT_STREAMS} pages (the server's limit) — ` +
        'unwatch a page first (action "unwatch") and then watch this one'
      );
    }
    if (status === 429) {
      return "the server is rate limiting comment streams (HTTP 429) — try again shortly";
    }
    if (status === 401 || status === 403) {
      return `authentication failed (HTTP ${status}). Run /login again and retry.`;
    }
    if (status === 404) {
      return "the artifact was not found (HTTP 404) — it may have been deleted";
    }
    return `the server refused the comment stream (HTTP ${status})${serverMessage ? `: ${serverMessage}` : ""}`;
  }

  /** A terminal failure: no retry, the page stays listed as stopped. */
  private failEntry(entry: WatchEntry, error: string): void {
    logger?.warn("Artifact comment watch stopped", {
      slug: entry.slug,
      error,
    });
    entry.status = "stopped";
    entry.error = error;
    this.clearRetry(entry);
  }

  private scheduleReconnect(entry: WatchEntry): void {
    if (this.stopped || entry.status === "stopped" || entry.retryTimer) return;
    const index = Math.min(entry.attempt, this.backoffDelaysMs.length - 1);
    const base = this.backoffDelaysMs[index];
    entry.attempt += 1;
    entry.status = "backoff";
    // Jitter keeps a fleet of reconnecting sessions off the same second.
    const delay = Math.round(base * (1 + Math.random() * 0.25));
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      void this.connect(entry);
    }, delay);
    entry.retryTimer.unref?.();
  }

  private clearRetry(entry: WatchEntry): void {
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  private resolveOpened(entry: WatchEntry, outcome: WatchOutcome): void {
    const settle = entry.opened;
    entry.opened = undefined;
    settle?.(outcome);
  }

  private teardownEntry(entry: WatchEntry): void {
    entry.status = "stopped";
    entry.abort?.abort();
    entry.abort = null;
    this.clearRetry(entry);
    if (entry.wakeTimer) {
      clearTimeout(entry.wakeTimer);
      entry.wakeTimer = null;
    }
    this.resolveOpened(entry, {
      kind: "error",
      error: "watching stopped before the connection was established",
    });
  }

  // --- frames ---

  private handleFrame(entry: WatchEntry, frame: SseFrame): void {
    if (entry.status === "stopped") return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      logger?.warn("Artifact comment stream frame was not JSON", {
        slug: entry.slug,
        event: frame.event,
      });
      return;
    }
    const head = typeof payload.head === "string" ? payload.head : null;
    if (head) entry.head = head;

    switch (frame.event) {
      case "hello": {
        // First frame on every (re)connection. `head` is the truth pointer: if
        // it differs from ours we may have missed frames while disconnected.
        if (entry.cursor === null) {
          entry.cursor = head;
        } else if (head && head !== entry.cursor) {
          this.scheduleWake(entry);
        }
        break;
      }
      case "change": {
        const kind = typeof payload.kind === "string" ? payload.kind : "";
        if (kind === "deleted") {
          // A delete needs no reply; reading anyway keeps the cursor moving.
          void this.readIncrement(entry);
        } else {
          this.scheduleWake(entry);
        }
        break;
      }
      case "heartbeat": {
        // Sync, not an event: catch up, never wake.
        if (head && head !== entry.cursor) void this.readIncrement(entry);
        break;
      }
      case "resync_required": {
        // The server dropped frames for us: read unconditionally.
        void this.readIncrement(entry);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Merge every change on this page into one wake-up per window. A burst of
   * comments then costs one turn, and the read that produces the counts happens
   * once for the whole burst.
   */
  private scheduleWake(entry: WatchEntry): void {
    if (entry.wakeTimer) return;
    entry.wakeTimer = setTimeout(() => {
      entry.wakeTimer = null;
      void this.wake(entry);
    }, this.wakeWindowMs);
    entry.wakeTimer.unref?.();
  }

  private async wake(entry: WatchEntry): Promise<void> {
    if (this.isDead(entry)) return;
    const result = await this.readIncrement(entry);
    if (this.isDead(entry)) return;
    if (!result.ok) {
      // Cannot tell how many threads are waiting — but staying silent while a
      // person is waiting for an answer is worse than one unnecessary read.
      this.enqueueWake(entry, []);
      return;
    }
    if (result.awaiting.length === 0) return;
    this.enqueueWake(entry, result.awaiting);
  }

  /** Read everything past `entry.cursor`; returns the rows awaiting a reply. */
  private async readIncrement(
    entry: WatchEntry,
  ): Promise<{ ok: boolean; awaiting: ArtifactComment[] }> {
    // One read in flight per page; a second caller waits for the same answer
    // instead of starting a parallel request (or own result would be lost).
    if (entry.reading) return entry.reading;
    const run = (async () => {
      // Snapshot before the request: `head` may advance while the read is in
      // flight, and jumping the cursor to a row this read never returned would
      // silently swallow the wake-up for it.
      const before = entry.head;
      const outcome = await fetchComments(
        entry.slug,
        entry.cursor ?? undefined,
        { abortSignal: entry.abort?.signal },
      );
      if (outcome.kind === "error") {
        logger?.warn("Artifact comment read after stream event failed", {
          slug: entry.slug,
          error: outcome.error,
        });
        return { ok: false, awaiting: [] as ArtifactComment[] };
      }
      const page = outcome.value;
      // The server's own pointer wins; otherwise the head we saw before the
      // read is at-or-before everything this read covered, so it is a safe
      // cursor (at worst it re-reads a row).
      entry.cursor = page.tailCursor ?? before ?? entry.cursor;
      return {
        ok: true,
        awaiting: page.comments.filter((comment) => comment.awaitingAgentReply),
      };
    })();
    entry.reading = run;
    try {
      return await run;
    } finally {
      if (entry.reading === run) entry.reading = null;
    }
  }

  private enqueueWake(entry: WatchEntry, awaiting: ArtifactComment[]): void {
    const messageQueue = this.container.get<MessageQueue>("MessageQueue");
    if (!messageQueue) {
      logger?.warn("Artifact comment wake dropped: no MessageQueue", {
        slug: entry.slug,
      });
      return;
    }
    const threadIds = [...new Set(awaiting.map((c) => c.threadId))];
    const url = entry.url ?? pageUrlFor(entry.slug);
    messageQueue.enqueueNotification(
      pageCommentEventToXml({
        url,
        slug: entry.slug,
        ...(threadIds.length > 0 && { count: threadIds.length, threadIds }),
      }),
    );
    logger?.info("Artifact comment wake enqueued", {
      slug: entry.slug,
      threads: threadIds.length,
    });
  }
}
