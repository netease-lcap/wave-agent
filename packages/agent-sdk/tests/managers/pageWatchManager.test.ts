import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  authService: {
    getServerUrl: vi.fn(() => "https://server.test"),
    getSSOToken: vi.fn(() => "token"),
  },
  createAuthAwareFetch: vi.fn((innerFetch: typeof fetch) => innerFetch),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService } from "../../src/services/authService.js";
import { Container } from "../../src/utils/container.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import {
  PageWatchManager,
  parseSseFrames,
} from "../../src/managers/pageWatchManager.js";
import { parsePageCommentEventXml } from "../../src/utils/pageCommentEventXml.js";

const SERVER_URL = "https://server.test";
const SLUG = "abc";
const ARTIFACT_URL = `${SERVER_URL}/code/artifact/${SLUG}`;

const encoder = new TextEncoder();

/** One live SSE connection the test can push frames into. */
class Stream {
  controller!: ReadableStreamDefaultController<Uint8Array>;
  signal?: AbortSignal;
  readonly response: Response;

  constructor() {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.response = {
      ok: true,
      status: 200,
      body,
      text: async () => "",
    } as unknown as Response;
  }

  push(event: string, data: unknown): void {
    this.controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  }

  close(): void {
    this.controller.close();
  }
}

interface ReadCall {
  url: string;
  cursor: string | null;
}

/**
 * Fetch router: the stream endpoint hands back a pushable Stream, the read
 * endpoint answers from `reads` (the queue of pages the test staged).
 */
class Harness {
  streams: Stream[] = [];
  readCalls: ReadCall[] = [];
  /** Pages returned by successive reads; the last one repeats. */
  pages: Array<Record<string, unknown>> = [];
  /** Set to make the next stream attempt reject (transport failure). */
  streamFailures = 0;
  /** Set to answer the stream request with a non-2xx status. */
  streamRejection?: { status: number; body: unknown };

  install(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/stream")) {
          if (this.streamFailures > 0) {
            this.streamFailures -= 1;
            throw new Error("ECONNRESET");
          }
          if (this.streamRejection) {
            const { status, body } = this.streamRejection;
            return {
              ok: false,
              status,
              statusText: "Error",
              body: null,
              text: async () => JSON.stringify(body),
            } as unknown as Response;
          }
          const stream = new Stream();
          stream.signal = init?.signal as AbortSignal;
          this.streams.push(stream);
          return stream.response;
        }
        if (url.includes("/api/frame/comments/")) {
          const cursor = new URL(url).searchParams.get("cursor");
          this.readCalls.push({ url, cursor });
          const page =
            this.pages.length > 1
              ? this.pages.shift()!
              : (this.pages[0] ?? { comments: [], unresolvedCount: 0 });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => JSON.stringify(page),
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }
}

function awaitingRow(
  id: string,
  threadId = id,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    text: `comment ${id}`,
    status: "open",
    authorKind: "user",
    replyToCommentId: threadId === id ? null : threadId,
    author: { uuid: "u1", fullName: "张三" },
    awaitingAgentReply: true,
    createdAt: "2026-10-20T10:00:00Z",
    ...overrides,
  };
}

function setUp(options: { wakeWindowMs?: number; delays?: number[] } = {}) {
  const container = new Container();
  const queue = new MessageQueue();
  container.register("MessageQueue", queue);
  const enqueue = vi.spyOn(queue, "enqueueNotification");
  const manager = new PageWatchManager(container, {
    wakeWindowMs: options.wakeWindowMs ?? 5,
    backoffDelaysMs: options.delays ?? [5],
  });
  return { manager, queue, enqueue, container };
}

function wakeEvents(enqueue: { mock: { calls: unknown[][] } }) {
  return enqueue.mock.calls
    .map((call) => parsePageCommentEventXml(String(call[0])))
    .filter((event): event is NonNullable<typeof event> => event !== null);
}

beforeEach(() => {
  vi.mocked(authService.getSSOToken).mockReturnValue("token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseSseFrames", () => {
  it("splits frames on blank lines and keeps the partial tail", () => {
    const buffer =
      'event: hello\ndata: {"head":"h1"}\n\nevent: change\ndata: {"head":"h2"}\n\npartial';
    const { frames, rest } = parseSseFrames(buffer);
    expect(frames).toEqual([
      { event: "hello", data: '{"head":"h1"}' },
      { event: "change", data: '{"head":"h2"}' },
    ]);
    expect(rest).toBe("partial");
  });

  it("joins multi-line data and ignores comment lines", () => {
    const { frames } = parseSseFrames(
      ": keep-alive\nevent: x\ndata: a\ndata: b\n\n",
    );
    expect(frames).toEqual([{ event: "x", data: "a\nb" }]);
  });
});

describe("PageWatchManager", () => {
  it("opens exactly one stream per page and adopts the hello head", async () => {
    const harness = new Harness();
    harness.install();
    const { manager, enqueue } = setUp();

    const first = await manager.watch(SLUG, ARTIFACT_URL);
    expect(first).toEqual({ kind: "watching", slug: SLUG, already: false });

    const second = await manager.watch(SLUG);
    expect(second).toMatchObject({ kind: "watching", already: true });
    expect(harness.streams).toHaveLength(1);

    harness.streams[0].push("hello", {
      slug: SLUG,
      head: "h1",
      heartbeatMs: 15000,
    });
    await vi.waitFor(() => {
      expect(manager.listWatched()[0]?.cursor).toBe("h1");
    });
    // Nothing was read: hello on a fresh watch is a baseline, not an event.
    expect(harness.readCalls).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    manager.stop();
  });

  it("merges a burst of changes into one read and one wake-up", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [
      {
        comments: [awaitingRow("t1"), awaitingRow("t2")],
        unresolvedCount: 2,
      },
    ];
    const { manager, enqueue } = setUp({ wakeWindowMs: 10 });

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    await vi.waitFor(() => expect(manager.listWatched()[0]?.cursor).toBe("h1"));

    harness.streams[0].push("change", {
      slug: SLUG,
      head: "h2",
      kind: "created",
      threadId: "t1",
    });
    harness.streams[0].push("change", {
      slug: SLUG,
      head: "h3",
      kind: "created",
      threadId: "t2",
    });
    harness.streams[0].push("change", {
      slug: SLUG,
      head: "h4",
      kind: "updated",
      threadId: "t1",
    });

    await vi.waitFor(() => expect(wakeEvents(enqueue)).toHaveLength(1));
    expect(harness.readCalls).toHaveLength(1);
    // The read is incremental from the cursor we had, not a full re-list.
    expect(harness.readCalls[0].cursor).toBe("h1");
    expect(wakeEvents(enqueue)[0]).toEqual({
      url: ARTIFACT_URL,
      slug: SLUG,
      count: 2,
      threadIds: ["t1", "t2"],
    });

    // The wake-up carries no comment text.
    const xml = String(enqueue.mock.calls[0][0]);
    expect(xml).not.toContain("comment t1");
    expect(xml).toContain('action "comments"');
    manager.stop();
  });

  it("does not wake for a change that only carries the agent's own reply", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [
      {
        comments: [
          awaitingRow("r1", "t1", {
            authorKind: "agent",
            awaitingAgentReply: false,
          }),
        ],
        unresolvedCount: 1,
      },
    ];
    const { manager, enqueue } = setUp({ wakeWindowMs: 5 });

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    harness.streams[0].push("change", {
      slug: SLUG,
      head: "h2",
      kind: "created",
      threadId: "t1",
    });

    await vi.waitFor(() => expect(harness.readCalls.length).toBe(1));
    expect(wakeEvents(enqueue)).toHaveLength(0);
    manager.stop();
  });

  it("catches up on a heartbeat without waking", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [{ comments: [awaitingRow("t1")], unresolvedCount: 1 }];
    const { manager, enqueue } = setUp();

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    harness.streams[0].push("heartbeat", { slug: SLUG, head: "h2" });

    await vi.waitFor(() => expect(harness.readCalls.length).toBe(1));
    expect(enqueue).not.toHaveBeenCalled();
    // A heartbeat whose head matches is a no-op.
    harness.streams[0].push("heartbeat", { slug: SLUG, head: "h2" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.readCalls).toHaveLength(1);
    manager.stop();
  });

  it("reads unconditionally on resync_required", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [{ comments: [], unresolvedCount: 0 }];
    const { manager, enqueue } = setUp();

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    harness.streams[0].push("resync_required", { slug: SLUG });

    await vi.waitFor(() => expect(harness.readCalls.length).toBe(1));
    expect(enqueue).not.toHaveBeenCalled();
    manager.stop();
  });

  it("reconnects after the stream drops and heals through hello.head", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [{ comments: [awaitingRow("t9")], unresolvedCount: 1 }];
    const { manager, enqueue } = setUp({ wakeWindowMs: 5, delays: [5] });

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    await vi.waitFor(() => expect(manager.listWatched()[0]?.cursor).toBe("h1"));

    harness.streams[0].close();
    await vi.waitFor(() => expect(harness.streams).toHaveLength(2));

    // The head moved while we were disconnected: comments landed unwatched.
    harness.streams[1].push("hello", { slug: SLUG, head: "h5" });
    await vi.waitFor(() => expect(wakeEvents(enqueue)).toHaveLength(1));
    expect(harness.readCalls[0].cursor).toBe("h1");
    expect(wakeEvents(enqueue)[0]).toMatchObject({
      count: 1,
      threadIds: ["t9"],
    });
    manager.stop();
  });

  it("keeps retrying in the background when the connection cannot be established", async () => {
    const harness = new Harness();
    harness.install();
    harness.streamFailures = 1;
    const { manager } = setUp({ delays: [5] });

    const outcome = await manager.watch(SLUG, ARTIFACT_URL);
    expect(outcome).toMatchObject({ kind: "watching", already: false });
    if (outcome.kind === "watching") expect(outcome.note).toContain("retrying");

    await vi.waitFor(() => expect(harness.streams).toHaveLength(1));
    manager.stop();
  });

  it("turns a 429 TOO_MANY_STREAMS into a readable error and never retries", async () => {
    const harness = new Harness();
    harness.install();
    harness.streamRejection = {
      status: 429,
      body: { code: "TOO_MANY_STREAMS", error: "too many" },
    };
    const { manager } = setUp({ delays: [5] });

    const outcome = await manager.watch(SLUG, ARTIFACT_URL);
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.error).toContain("8");
      expect(outcome.error).toContain("unwatch");
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    expect(manager.listWatched()[0].status).toBe("stopped");
    manager.stop();
  });

  it("stops on 403 instead of retrying a permission problem", async () => {
    const harness = new Harness();
    harness.install();
    harness.streamRejection = { status: 403, body: { error: "not a writer" } };
    const { manager } = setUp({ delays: [5] });

    const outcome = await manager.watch(SLUG, ARTIFACT_URL);
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") expect(outcome.error).toContain("Run /login");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
    manager.stop();
  });

  it("unwatch aborts the stream and makes later events silent", async () => {
    const harness = new Harness();
    harness.install();
    harness.pages = [{ comments: [awaitingRow("t1")], unresolvedCount: 1 }];
    const { manager, enqueue } = setUp({ wakeWindowMs: 5 });

    await manager.watch(SLUG, ARTIFACT_URL);
    harness.streams[0].push("hello", { slug: SLUG, head: "h1" });
    await vi.waitFor(() => expect(manager.listWatched()[0]?.cursor).toBe("h1"));

    expect(manager.unwatch(SLUG)).toBe(true);
    expect(manager.unwatch(SLUG)).toBe(false);
    expect(harness.streams[0].signal?.aborted).toBe(true);
    expect(manager.listWatched()).toHaveLength(0);

    // Nothing reaches the queue after an unwatch.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(enqueue).not.toHaveBeenCalled();
    expect(harness.readCalls).toHaveLength(0);
    manager.stop();
  });

  it("refuses to watch when the session is not logged in", async () => {
    vi.mocked(authService.getSSOToken).mockReturnValue(undefined);
    const harness = new Harness();
    harness.install();
    const { manager } = setUp();

    const outcome = await manager.watch(SLUG, ARTIFACT_URL);
    expect(outcome).toMatchObject({ kind: "error" });
    if (outcome.kind === "error") expect(outcome.error).toContain("/login");
    expect(harness.streams).toHaveLength(0);
  });

  it("stop() aborts every stream and clears the registry", async () => {
    const harness = new Harness();
    harness.install();
    const { manager } = setUp();

    await manager.watch("one");
    await manager.watch("two");
    expect(harness.streams).toHaveLength(2);

    manager.stop();
    expect(harness.streams.every((stream) => stream.signal?.aborted)).toBe(
      true,
    );
    expect(manager.listWatched()).toHaveLength(0);

    const after = await manager.watch("three");
    expect(after).toMatchObject({ kind: "error" });
    expect(harness.streams).toHaveLength(2);
  });
});
