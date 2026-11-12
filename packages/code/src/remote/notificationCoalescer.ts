/**
 * Frame coalescer for the remote-control (phone) path.
 *
 * The bridge emits one notification per streamed chunk (see
 * `agentBridge.ts` `onAssistantContentUpdated`), which mirrors the model's
 * frame rate — tens to ~150 frames per second per session. Locally that is
 * free: those frames go out over a unix socket inside the same process. Over a
 * relay it becomes the dominant cost, because the JSON-RPC envelope (~150–250
 * B) is an order of magnitude larger than the delta it carries — and the relay
 * pays that cost per subscriber, per frame.
 *
 * So the remote path alone gets a merge window: notifications carrying an
 * accumulating delta are held for at most `windowMs` and concatenated, and
 * notifications carrying a **replaceable snapshot** (a tool block's `running`
 * stage `shortResult`) are held for the same window and overwritten, last one
 * winning. Everything else is a discrete event — a permission request, a tool
 * block reaching `end`, a status signal — and is written through immediately,
 * after flushing whatever was held, so a phone never observes a reordered stream.
 *
 * This is a delay, never a sample: no delta is dropped, and the merged frame
 * carries exactly the bytes the individual frames would have (for the
 * replaceable kind, exactly the bytes of the last frame). The local desktop /
 * IDE path does not go through here at all.
 */

/** One notification on its way to the relay. */
export interface RelayFrame {
  method: string;
  params: unknown;
  sessionId?: string;
}

/**
 * Merge window for the remote path. Long enough to collapse a streaming burst
 * (the model emits far faster than this), short enough that a human reading the
 * phone cannot tell the difference.
 */
export const REMOTE_FRAME_WINDOW_MS = 150;

type MergeSpec =
  | {
      /** Concatenate `field` across every frame of the run. */
      mode: "append";
      /** The params field that accumulates. */
      field: string;
      /** Identity of the accumulating thing, so two runs never interleave. */
      key: string;
    }
  | {
      /** Keep only the latest frame of the run — a snapshot, not a delta. */
      mode: "replace";
      /** Identity of the thing being refreshed. */
      key: string;
    };

/**
 * Decide whether a notification may be merged, and how.
 *
 * The streaming callbacks qualify for `append` only in their streaming stage:
 * their payloads are documented as deltas ("consumers accumulate"), and
 * `messageOperations.ts` accumulates `parametersChunk` by plain concatenation —
 * the same operation this class performs. A `start` / `running` / `end` frame
 * is a one-time snapshot (or the authoritative full value) and must not be
 * concatenated with anything. `btwContent` (the `/btw` answer stream) is the
 * fourth, and the compaction summary tail (`compactionContentUpdate`) the fifth:
 * both carry one delta field and no stages, so every frame is a delta.
 *
 * The one `replace` case is the tool block's `running` + `shortResult` snapshot
 * (a subagent's live progress, a foreground script's invocation count). The SDK
 * rewrites it on every subagent delta — model-frame rate, with `compactParams`
 * and friends repeated in full each time — while the local CLI throttles the
 * very same family (500 ms window, `core/stream-content-updates.md`) precisely
 * because nothing is lost by showing it less often: it is "the progress right
 * now", and the later snapshot supersedes the earlier one entirely. Without
 * this the window's savings leak out through the busiest path of a subagent
 * run; see `remote/remote-channel.md`「白名单与增量拉取」场景 14.
 */
function mergeSpec(method: string, params: unknown): MergeSpec | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const p = params as Record<string, unknown>;

  if (
    method === "assistantContentUpdated" ||
    method === "assistantReasoningUpdated"
  ) {
    if (p.stage !== "streaming" || typeof p.chunk !== "string")
      return undefined;
    if (typeof p.messageId !== "string") return undefined;
    return {
      mode: "append",
      field: "chunk",
      key: `c\u0000${p.messageId}`,
    };
  }

  if (method === "toolBlockUpdated") {
    if (typeof p.messageId !== "string" || typeof p.id !== "string") {
      return undefined;
    }
    if (p.stage === "streaming" && typeof p.parametersChunk === "string") {
      return {
        mode: "append",
        field: "parametersChunk",
        key: `t\u0000${p.messageId}\u0000${p.id}`,
      };
    }
    // Progress snapshot, not content: `start` / `end` and the `running` frame
    // that only announces "parameters complete" carry no `shortResult` and stay
    // discrete.
    if (p.stage === "running" && typeof p.shortResult === "string") {
      return {
        mode: "replace",
        key: `r\u0000${p.messageId}\u0000${p.id}`,
      };
    }
    return undefined;
  }

  // `/btw` side question (`btwContent`, spec remote/remote-web.md「Web 页也能用
  // /btw 旁路提问」场景 4). Same family as the three above: `content` is a pure
  // delta the panel accumulates, so the merged frame carries exactly the bytes
  // the individual ones would. The key carries the question **and** the channel
  // (`content` / `thinking`) — the panel drops thinking once content starts, so
  // merging the two together would resurrect text it had already discarded, and
  // two questions in flight must never interleave.
  if (method === "btwContent") {
    if (typeof p.content !== "string" || typeof p.question !== "string") {
      return undefined;
    }
    return {
      mode: "append",
      field: "content",
      // 归属键里有 requestId：多轮追问之后同一个问题可以同时在途两次（从主输入框
      // 连发两次 `/btw 同样的话`），只按 question 合并会把两轮的增量揉成一团。
      key: `b\u0000${typeof p.requestId === "string" ? p.requestId : ""}\u0000${p.question}\u0000${typeof p.type === "string" ? p.type : ""}`,
    };
  }

  // Compaction summary streaming: since 2026-10-27 the payload is a delta of
  // newly produced text (it used to carry the whole tail), so it merges exactly
  // like the three above. The key needs no stream identity: one compaction runs
  // one stream per session, and both its start and its end
  // (`compactionStateChange`) are discrete events that flush this buffer first
  // (spec: ui/stdio-transport.md「流式通知纯增量负载」场景 7, remote/remote-web.md
  // 场景 10).
  if (method === "compactionContentUpdate") {
    if (typeof p.content !== "string") return undefined;
    return { mode: "append", field: "content", key: "k" };
  }

  return undefined;
}

type Pending =
  | {
      kind: "append";
      method: string;
      sessionId?: string;
      /** Params of the first frame of the run, with the delta field zeroed. */
      base: Record<string, unknown>;
      field: string;
      text: string;
    }
  | {
      kind: "replace";
      method: string;
      sessionId?: string;
      /** Params of the newest frame — the whole snapshot, nothing merged in. */
      params: Record<string, unknown>;
    };

export class NotificationCoalescer {
  private pending = new Map<string, Pending>();
  /** Insertion order of live keys, so a flush preserves the original order. */
  private order: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly write: (frames: RelayFrame[]) => void,
    private readonly windowMs: number = REMOTE_FRAME_WINDOW_MS,
  ) {}

  push(method: string, params: unknown, sessionId?: string): void {
    const spec = mergeSpec(method, params);
    if (!spec) {
      // Discrete event: order matters relative to the buffered deltas, so the
      // buffer goes out first.
      this.flush();
      this.write([{ method, params, sessionId }]);
      return;
    }

    const mapKey = `${sessionId ?? ""}\u0000${method}\u0000${spec.key}`;
    const existing = this.pending.get(mapKey);
    if (existing) {
      if (existing.kind === "replace") {
        // Last one wins: a progress snapshot supersedes the one before it, so
        // keeping the earlier bytes would only send a stale progress line.
        existing.params = { ...(params as Record<string, unknown>) };
      } else {
        existing.text += String(
          (params as Record<string, unknown>)[existing.field] ?? "",
        );
      }
      return;
    }

    if (spec.mode === "replace") {
      this.pending.set(mapKey, {
        kind: "replace",
        method,
        sessionId,
        params: { ...(params as Record<string, unknown>) },
      });
    } else {
      const base = { ...(params as Record<string, unknown>) };
      const text = String(base[spec.field] ?? "");
      delete base[spec.field];
      this.pending.set(mapKey, {
        kind: "append",
        method,
        sessionId,
        base,
        field: spec.field,
        text,
      });
    }
    this.order.push(mapKey);
    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
      // A pending phone frame must never hold the process open.
      this.timer.unref?.();
    }
  }

  /** Write every buffered run, in the order the runs first appeared. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.order.length === 0) return;

    const keys = this.order;
    const buffered = this.pending;
    this.order = [];
    this.pending = new Map();

    const frames: RelayFrame[] = keys.map((key) => {
      const item = buffered.get(key)!;
      return {
        method: item.method,
        params:
          item.kind === "replace"
            ? item.params
            : { ...item.base, [item.field]: item.text },
        sessionId: item.sessionId,
      };
    });
    this.write(frames);
  }

  /** Drop everything buffered without writing — used when the socket dies. */
  discard(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.order = [];
    this.pending = new Map();
  }
}
