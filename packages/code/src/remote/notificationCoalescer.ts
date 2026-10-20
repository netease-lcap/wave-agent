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
 * So the remote path alone gets a merge window: notifications whose payload is
 * an accumulating delta are held for at most `windowMs` and concatenated.
 * Everything else is a discrete event — a permission request, a tool block
 * reaching `end`, a status signal — and is written through immediately, after
 * flushing whatever was held, so a phone never observes a reordered stream.
 *
 * This is a delay, never a sample: no delta is dropped, and the merged frame
 * carries exactly the bytes the individual frames would have. The local
 * desktop / IDE path does not go through here at all.
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

interface MergeSpec {
  /** The params field that accumulates. */
  field: string;
  /** Identity of the accumulating thing, so two streams never interleave. */
  key: string;
}

/**
 * Decide whether a notification is a pure delta that may be merged.
 *
 * Only the streaming callbacks qualify, and only in their streaming stage:
 * their payloads are documented as deltas ("consumers accumulate"), and
 * `messageOperations.ts` accumulates `parametersChunk` by plain concatenation —
 * the same operation this class performs. A `start` / `running` / `end` frame
 * is a one-time snapshot (or the authoritative full value) and must not be
 * merged with anything. `btwContent` (the `/btw` answer stream) is the fourth:
 * one field, no stages, a delta every time.
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
    return { field: "chunk", key: `c\u0000${p.messageId}` };
  }

  if (method === "toolBlockUpdated") {
    if (p.stage !== "streaming" || typeof p.parametersChunk !== "string") {
      return undefined;
    }
    if (typeof p.messageId !== "string" || typeof p.id !== "string") {
      return undefined;
    }
    return {
      field: "parametersChunk",
      key: `t\u0000${p.messageId}\u0000${p.id}`,
    };
  }

  // `/btw` side question (`btwContent`, spec ui/remote-control.md「Web 页也能用
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
      field: "content",
      key: `b\u0000${p.question}\u0000${typeof p.type === "string" ? p.type : ""}`,
    };
  }

  return undefined;
}

interface Pending {
  method: string;
  sessionId?: string;
  /** Params of the first frame of the run, with the delta field zeroed. */
  base: Record<string, unknown>;
  field: string;
  text: string;
}

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
      existing.text += String(
        (params as Record<string, unknown>)[spec.field] ?? "",
      );
      return;
    }

    const base = { ...(params as Record<string, unknown>) };
    const text = String(base[spec.field] ?? "");
    delete base[spec.field];
    this.pending.set(mapKey, {
      method,
      sessionId,
      base,
      field: spec.field,
      text,
    });
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
        params: { ...item.base, [item.field]: item.text },
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
