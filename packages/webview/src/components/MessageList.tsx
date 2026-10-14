import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { useVirtualizer, elementScroll } from "@tanstack/react-virtual";
import { Message } from "./Message";
import { streamingTail } from "../utils/streamingText";
import type { MessageListProps } from "../types";
import type { Message as MessageType } from "wave-agent-sdk/types";
import "../styles/MessageList.css";

// Measured row heights by message id, shared across MessageList instances and
// PERSISTED to localStorage (OpenCode's timelineCache keeps measurements per
// session in memory; we keep them per message id across webview lifetimes, so
// a session switch or page reload answers estimateSize with the real measured
// height instead of the coarse 200px default — a reload lands on the true
// total height in one shot instead of shrinking one row per frame for seconds
// as rows are progressively measured (each measurement shrank the spacer,
// re-anchored the bottom, mounted the next row, and measured it — a chain
// that kept scrollHeight moving).
//
// Foldable blocks (reasoning / compact) break the "finished message height is
// permanent" assumption, so each entry also records the fold state it was
// measured in. estimateSize only trusts an entry when its fold state matches
// the message's current DEFAULT fold state (ReasoningBlockView starts
// expanded while streaming, collapsed once ended; CompactBlockView starts
// collapsed). A fold toggle re-measures the row (ResizeObserver) and
// overwrites the entry with the new height + fold state; a mismatch on load
// (e.g. the user expanded a block, scrolled away, and the session reloads
// with the block collapsed) invalidates the entry until the row is measured
// again. Messages without foldable blocks carry fold: null and stay valid
// forever.
type FoldState = "collapsed" | "expanded" | null;

// How long after a real input event (wheel / touch / scroll key / scrollbar
// drag) the shipped 'scroll' events still count as the user's. This is the
// gesture window the scroll handler gates on — events older than it are our own
// pins, the virtualizer's compensations or a browser clamp, and never touch the
// opt-out. It therefore has to cover the ~1-frame dispatch lag of synthesized
// scroll events (measured: ~70% land after the next rAF) plus trackpad inertia,
// without letting a stale timestamp swallow a later genuine gesture.
const USER_INPUT_GRACE_MS = 200;

// How close to the real bottom the viewport must be to count as "at the bottom"
// — used both to re-engage following after an opt-out and to follow a freshly
// appended message when the user never opted out.
//
// Deliberately tight (a few px to ~10), matching the rest of the field:
// opencode's `createAutoScroll` defaults `bottomThreshold` to 10, react-virtuoso's
// `atBottomThreshold` defaults to 4, claude.ai's bundles use 2/4/8. A wide band is
// not a grace margin but a bug: it declares "at the bottom" for a user who has
// visibly left it, and then the very next non-programmatic scroll event (resize
// compensation, an image settling, a stray wheel tick) clears the opt-out and the
// streaming pin yanks the viewport back down. That is the intermittent
// "I scrolled up and it pulled me back" report this replaced — the previous 300px
// band (introduced by 9b856225 with no external rationale) was an order of
// magnitude wider than any comparable implementation.
//
// Measured A/B on the same build (e2e/streaming-wheel-scroll.e2e.ts, "a light
// wheel nudge inside the old 300px band"): park the viewport 183px from the
// bottom, then deliver one scroll event that our own write did not produce.
// With 300px it reads as "the user is back at the bottom", clears the opt-out,
// and the next streaming pin drags the viewport to gap 0; with 10px it stays
// parked. Such an event is not hypothetical — the virtualizer's resize
// compensation writes scrollTop directly — so the threshold is an independent
// guard, on top of recognizing our own writes by position (see autoScrollRef).
const BOTTOM_FOLLOW_THRESHOLD_PX = 10;

// Is the viewport at the real bottom? One definition, used both to decide
// whether following may continue and to re-engage it from the scroll handler.
const atBottom = (container: HTMLElement) =>
  container.scrollTop + container.clientHeight >=
  container.scrollHeight - BOTTOM_FOLLOW_THRESHOLD_PX;

/**
 * Why the viewport is being asked to move. The reason is the answer to "may
 * this override the user's reading position?" — it is not decoration, and it is
 * the only thing that may re-arm following:
 *
 * - `initial`   the pane just mounted / a session was bound. Nothing is being
 *               read yet, so this pins unless the user had already opted out.
 * - `user-sent` the user just sent a message: the reply is what they are
 *               waiting for, so this is the one reason that lifts an earlier
 *               opt-out. Together with "scrolled back to the real bottom" it is
 *               the second and last way back into following.
 * - `new-message` a message was appended (or the queue changed): the reader
 *               wants to see it, so it pins unless they opted out.
 * - `content`   the message already on screen changed — a streaming chunk. This
 *               one additionally requires the stream to be running or the
 *               viewport to be at the bottom, so a parked reader is never
 *               chased by the reply growing under them.
 * - `ambient`   the conversation did not change: an async resource finished
 *               loading, a row was measured, the host asked for the bottom.
 *               Pins unless the user opted out.
 */
type FollowReason =
  | "initial"
  | "user-sent"
  | "new-message"
  | "content"
  | "ambient";

// How long a programmatic-scroll position stays recognizable, and how close the
// viewport has to be to it. Same values as opencode's markAuto/isAuto: the
// window must outlive the dispatch lag of the synthesized 'scroll' event, and
// the tolerance absorbs the browser clamping the write.
const AUTO_SCROLL_WINDOW_MS = 1500;
const AUTO_SCROLL_TOLERANCE_PX = 2;

interface MeasuredEntry {
  height: number;
  fold: FoldState;
}

const measuredHeights = new Map<string, MeasuredEntry>();
const MEASURED_HEIGHTS_LIMIT = 2000;
const HEIGHTS_STORAGE_KEY = "wave-webview:measured-heights:v1";
// Arithmetic mean of measured row heights, used as the estimate for rows not
// yet measured (e.g. the first load of a conversation). Converges to the real
// average within the first batch of measurements, so unmeasured rows estimate
// close to reality and the total height does not keep drifting as rows are
// progressively measured. Starts conservative (200, the old estimateSize).
let measuredSum = 0;
let measuredCount = 0;
let avgMeasuredHeight = 200;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loadMeasuredHeights() {
  try {
    const raw = localStorage.getItem(HEIGHTS_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Array<
      [string, { h: number; f?: 0 | 1 | null }]
    >;
    for (const [id, entry] of entries) {
      if (measuredHeights.size >= MEASURED_HEIGHTS_LIMIT) break;
      if (typeof id !== "string" || typeof entry?.h !== "number") continue;
      measuredHeights.set(id, {
        height: entry.h,
        fold: entry.f === 0 ? "collapsed" : entry.f === 1 ? "expanded" : null,
      });
      measuredSum += entry.h;
      measuredCount++;
    }
    if (measuredCount > 0) avgMeasuredHeight = measuredSum / measuredCount;
  } catch {
    // Storage unavailable / corrupted payload — start from an empty cache.
    measuredHeights.clear();
    measuredSum = 0;
    measuredCount = 0;
    avgMeasuredHeight = 200;
  }
}

loadMeasuredHeights();

function scheduleSaveMeasuredHeights() {
  if (saveTimer !== undefined) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const payload: Array<[string, { h: number; f: 0 | 1 | null }]> = [];
      measuredHeights.forEach((entry, id) => {
        payload.push([
          id,
          {
            h: entry.height,
            f: entry.fold === null ? null : entry.fold === "expanded" ? 1 : 0,
          },
        ]);
      });
      localStorage.setItem(HEIGHTS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota exceeded / storage unavailable — keep the in-memory cache.
    }
  }, 400);
}

function recordMeasuredHeight(id: string, height: number, fold: FoldState) {
  if (!measuredHeights.has(id)) {
    measuredSum += height;
    measuredCount++;
    avgMeasuredHeight = measuredSum / measuredCount;
    if (measuredHeights.size >= MEASURED_HEIGHTS_LIMIT) {
      // Map iterates in insertion order — evict the oldest entry.
      const oldest = measuredHeights.keys().next().value;
      if (oldest !== undefined) measuredHeights.delete(oldest);
    }
  }
  measuredHeights.set(id, { height, fold });
  scheduleSaveMeasuredHeights();
}

// The default fold state a message renders with on mount, mirroring
// ReasoningBlockView (streaming reasoning starts expanded, ended reasoning
// and compact blocks start collapsed). Used to validate a cached entry's fold
// state: the cache only answers when the message is in its default state, so
// a user-expanded height is never served to a default-collapsed render.
function defaultFoldState(message: MessageType): FoldState {
  if (!message.blocks) return null;
  let hasFoldable = false;
  for (const block of message.blocks) {
    if (block.type === "reasoning") {
      hasFoldable = true;
      if (block.stage !== "end") return "expanded";
    } else if (block.type === "compact") {
      hasFoldable = true;
    }
  }
  return hasFoldable ? "collapsed" : null;
}

// Read the ACTUAL fold state from the rendered row: a `.reasoning-content`
// child exists only while its block is expanded. Matches what the cache entry
// stores so a fold toggle re-measure lands on the right key.
function detectFoldState(node: HTMLElement): FoldState {
  const blocks = node.querySelectorAll<HTMLElement>(".reasoning-block");
  if (blocks.length === 0) return null;
  for (const block of blocks) {
    if (block.querySelector(".reasoning-content")) return "expanded";
  }
  return "collapsed";
}

// Count the blocks in an assistant message that Message.tsx wraps in a `.timeline-row`
// (i.e. that carry a timeline dot): non-empty text/compact, tool, and reasoning blocks.
// Mirrors the `wrap` logic in Message.renderBlock so the group can decide whether it has
// a single lone dot (no connecting line) or multiple dots (draw the line).
function countTimelineBlocks(message: MessageType): number {
  if (!message.blocks) return 0;
  let count = 0;
  for (const block of message.blocks) {
    switch (block.type) {
      case "text":
      case "compact":
        if (block.content && block.content.trim()) count++;
        break;
      case "tool":
      case "reasoning":
        count++;
        break;
    }
  }
  return count;
}

export const MessageList = forwardRef<
  { scrollToBottom: (behavior?: ScrollBehavior) => void },
  MessageListProps
>(function MessageList(
  {
    messages,
    queuedMessages,
    isStreaming,
    isCompacting,
    compactionStream,
    vscode,
    onRewindToMessage,
    workdir,
    onOpenPreview,
    onOpenFile,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  // True until the first effect run after mount. MessageList only renders once
  // messages exist (empty state shows LoadingLogo/WelcomeView), so the first run
  // IS the initial session load and must force-scroll to the bottom.
  const isFirstEffectRef = useRef(true);
  // True when the user has scrolled up away from the bottom. While set,
  // auto-scroll-to-bottom is suspended so the user can read history undisturbed
  // during streaming. Set by ANY upward scroll (even a few px) — detected by
  // comparing scrollTop direction in the scroll handler — so a light upward
  // nudge is respected instead of being overridden because the user is still
  // "within the bottom threshold". Cleared only when the user scrolls back down
  // to the bottom region.
  const userScrolledUpRef = useRef(false);
  // 最近一次真实输入（wheel / 触摸 / 滚动键 / 拖动滚动条）的时间戳。它只在上锁侧
  // 使用：窗口内的向上滚动一律算用户意图，哪怕这次事件正好落在程序滚动的落点上。
  // 触摸/拖动滚动条/键盘没有 wheel 事件可以在输入时刻同步置锁，这个窗口是它们
  // 唯一的同步钩子。
  const lastUserInputAtRef = useRef(0);
  // 我们自己那次滚动落在哪儿、什么时候落的（doScrollToBottom / scrollToIndex /
  // resizeItem 补偿——所有虚拟器滚动都经 scrollToFn）。
  //
  // 判据是**位置**而不是计数：'scroll' 事件在更晚的任务里派发（实测 ~70% 晚于
  // 下一帧 rAF），所以「这次事件是不是我造成的」不能靠一个「待消费计数」回答——
  // 一次没有移动视口的程序滚动根本不会派发事件，计数就透支了，下一次真实手势被
  // 当成我们自己的事件吞掉（上滚被吞 ⇒ 视口被钉底拽回）。改为记住我们瞄准的
  // 落点，窗口内落到该位置的事件就认作自己的。对齐 opencode 的 markAuto/isAuto。
  //
  // 记的是**一组**候选落点而不是单个：虚拟器瞄准的 offset（resizeItem 补偿会把
  // scrollTop 移到那里，那个位置通常不是底部）与当次写入能被 clamp 到的上界
  // （max scrollTop —— 钉底时实际落在这里，因为写入值可能超过可滚范围）。只记
  // 后者会让补偿落点认不出来，从而把「测量修正」误判成用户上滚、冻住首开钉底。
  const autoScrollRef = useRef<{ tops: number[]; at: number } | undefined>(
    undefined,
  );
  const markAutoScroll = useCallback((tops: number[]) => {
    autoScrollRef.current = { tops, at: performance.now() };
  }, []);
  // True from a mousedown on the scrollbar track until the button is released:
  // the drag has to keep re-marking the input as it goes, because a thumb drag
  // lasts far longer than the gesture window the scroll handler gates on.
  const trackDragRef = useRef(false);
  // Last seen scrollTop, used to detect scroll direction (up vs down).
  const prevScrollTopRef = useRef(0);
  // Last seen scrollHeight, used to tell a content-shrink clamp apart from a
  // genuine user scroll-up. When content above the viewport shrinks (reasoning
  // auto-collapse, streaming-end reflow, image load, etc.) the browser clamps
  // scrollTop downward to keep it within bounds, which otherwise looks identical
  // to an upward user gesture and would wrongly suspend auto-follow.
  const prevScrollHeightRef = useRef(0);
  // Last seen clientHeight, used the same way for a viewport-GROWTH clamp: when
  // the container gets taller (confirmation dialog closes, input area shrinks,
  // window/panel grows) while parked at the bottom, the browser clamps scrollTop
  // downward with scrollHeight UNCHANGED — which passes the contentShrank check
  // and would likewise suspend auto-follow without a user gesture.
  const prevClientHeightRef = useRef(0);
  // The in-flow spacer div carrying the virtualized total height. Observed for
  // size changes (see the re-pin effect below) so any late growth of the
  // total — estimate→measure waves after the initial pin — re-pins.
  const spacerRef = useRef<HTMLDivElement | null>(null);

  // The most-recent user message that has scrolled above the viewport top; pinned
  // at the top of the list as a context hint (设计稿 2236-3792).
  const [stickyMessage, setStickyMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // Mirror of stickyMessage for computeSticky's pre-comparison. computeSticky
  // runs on every messages update (each streaming chunk) inside the main
  // effect's passive phase AND from scroll/ResizeObserver callbacks. Its
  // setStickyMessage is the only setState on the streaming hot path. With a
  // functional updater React only bails out cheaply when the update queue is
  // empty; during high-frequency dual-stream (reasoning + text) chunks pile up
  // while a render is in flight, the queue is never empty, and every
  // computeSticky call schedules an update — counting toward React's
  // nestedPassiveUpdateLimit and eventually firing "Maximum update depth
  // exceeded" (setState inside useEffect, ~50 consecutive passive rounds).
  // Comparing against the ref and skipping the call entirely when the value is
  // unchanged avoids scheduling altogether (same UI semantics, zero updates).
  const stickyRef = useRef<{
    id: string;
    text: string;
  } | null>(null);

  // Filter out user messages with isMeta (hidden from the list). Both the
  // sticky computation and the virtualizer index this filtered list.
  const visibleMessages = useMemo(() => {
    const out: MessageType[] = [];
    for (const msg of messages) {
      if (msg.role === "user" && msg.isMeta) continue;
      out.push(msg);
    }
    return out;
  }, [messages]);

  // Refs mirroring the current data for stable callbacks (event handlers and
  // the imperative handle must not capture a stale render).
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;
  stickyRef.current = stickyMessage;

  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => containerRef.current,
    // Estimate real measured height when known (same message ids reload after
    // a session switch), falling back to the running average of measured rows
    // so unmeasured rows match reality instead of a fixed 200px — this keeps
    // the spacer stable once the visible window has been measured.
    estimateSize: (i) => {
      const message = visibleMessages[i];
      const id = message?.id;
      if (id) {
        const cached = measuredHeights.get(id);
        // Only trust the cache when the message is in the fold state it was
        // measured in (see defaultFoldState); a mismatch means the entry is
        // stale — e.g. the user expanded a reasoning block, scrolled away, and
        // the session reloaded with the block collapsed — and falls back to
        // the average until the row is measured again.
        if (cached !== undefined && cached.fold === defaultFoldState(message)) {
          return cached.height;
        }
      }
      return avgMeasuredHeight;
    },
    // Hook the virtualizer's own measurement, which BOTH measurement paths go
    // through: the ref callback (virtualizer.measureElement method, mount
    // time) and the shared row ResizeObserver (size changes: streaming row
    // growth, fold toggles, width reflows). Recording here — instead of only
    // in the ref callback — keeps the persistent cache in sync with every
    // re-measure, so a fold toggle overwrites the entry with the new height +
    // fold state. The default option returns the internal cache for ref-path
    // re-measures; we always return the live size so a re-mounted row is
    // measured fresh.
    measureElement: (node, entry) => {
      const element = node as HTMLElement;
      const id = element.getAttribute("data-measured-message-id");
      const height = entry?.borderBoxSize?.[0]
        ? Math.round(entry.borderBoxSize[0].blockSize)
        : element.offsetHeight;
      if (id) recordMeasuredHeight(id, height, detectFoldState(element));
      return height;
    },
    overscan: 20,
    // Inter-row spacing is baked into each row's padding-bottom (see
    // timelineRuns) instead of the virtualizer's `gap`: consecutive assistant
    // messages render flush (gap 0) so the timeline line is continuous through
    // a run — a uniform `gap` would break the line at every message boundary.
    paddingStart: 10, // .messages-column padding
    paddingEnd: 10,
    // Keep the reading position anchored on appends; follow new content only
    // when the user is already at the end (streaming bottom-pin).
    anchorTo: "end",
    followOnAppend: true,
    getItemKey: (i) => visibleMessages[i].id,
    // Skip React re-renders for scroll-only updates: the virtualizer writes
    // row positions and the spacer height straight to the DOM, re-rendering
    // only when the visible range or isScrolling changes.
    directDomUpdates: true,
    // Position rows with `top` instead of the default `transform:
    // translate3d(…)`. A transform makes the row a containing block for its
    // `position: fixed` descendants, so hover layers inside a message (the
    // ContextTag / rewind-button Tooltips) were laid out against the row while
    // using viewport coordinates: the tooltip landed a row's offset below the
    // tag and its overflow grew the list — hovering an image tag pushed the
    // list into scrolling and scrolled the tag away from the pointer.
    directDomUpdatesMode: "position",
    // The virtualizer's default useFlushSync calls flushSync(rerender) whenever
    // notify(sync=true) fires — i.e. after a synchronous scroll compensation
    // (resizeItem on streaming row growth) or while isScrolling. measureElement
    // runs as a ref callback in React's commit phase, so a growing streaming row
    // can trigger that flushSync inside a lifecycle method, which React rejects
    // with "flushSync was called from inside a lifecycle method" (and the flush
    // is ignored anyway). With directDomUpdates the spacer height and row
    // transforms are still applied synchronously inside onChange; only the
    // React re-render (visible range) is deferred to the normal scheduler.
    useFlushSync: false,
    // Defer measurement resize callbacks to animation frames so streaming row
    // growth doesn't trigger layout thrash mid-frame.
    useAnimationFrameWithResizeObserver: true,
    // All virtualizer-initiated scrolls — scrollToEnd/scrollToIndex AND the
    // internal resizeItem compensations — route through scrollToFn. Two jobs:
    // (1) OpenCode-aligned: write the spacer height BEFORE the scroll so the
    // browser clamps against the CURRENT total instead of a stale one (a
    // scrollToEnd computed from the internal total would otherwise land short
    // when the DOM spacer write trails by a frame); (2) flag the scroll as
    // programmatic so the scroll handler can't mistake a size-change
    // compensation for a user gesture — a row measuring SHORTER than its
    // estimate shifts scrollTop by the negative delta, and that spurious
    // downward scroll would otherwise latch userScrolledUpRef and freeze the
    // bottom-pin mid-growth. The rAF reset mirrors doScrollToBottom's own flag
    // handling; the browser coalesces all scrollTop writes of a frame into one
    // 'scroll' event, dispatched before the next frame's rAF callback.
    scrollToFn: (offset, opts, instance) => {
      if (spacerRef.current) {
        spacerRef.current.style.height = `${instance.getTotalSize()}px`;
      }
      // Mark where this scroll lands so the scroll handler can recognize the
      // event as ours (see autoScrollRef) instead of reading it as user intent.
      // The virtualizer's resizeItem compensations route here too — a row
      // measuring SHORTER than its estimate shifts scrollTop by the negative
      // delta, and that spurious scroll would otherwise latch userScrolledUpRef
      // and freeze the bottom-pin mid-growth. Two candidate landings: the offset
      // the virtualizer aimed at, and the clamp ceiling — recorded AFTER the
      // spacer write above, so the ceiling is this write's real max scrollTop.
      const container = containerRef.current;
      if (container) {
        markAutoScroll([
          offset,
          Math.max(0, container.scrollHeight - container.clientHeight),
        ]);
      }
      elementScroll(offset, opts, instance);
    },
  });

  // Stable row ref: defers to the virtualizer's own measurement (its
  // measureElement method, which runs our hooked measureElement option). Must
  // stay referentially stable — an inline arrow would be recreated every
  // render and React would detach/reattach every row's ref each render,
  // re-measuring the whole visible window on every streaming chunk.
  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  // Per-message timeline run data. A run is a maximal sequence of consecutive
  // assistant messages (the virtualized analogue of the old .assistant-group
  // wrapper). Multi-dot runs draw a continuous vertical line: the run's first
  // row starts it at its first dot, the last row ends it at its last dot;
  // single-dot runs hide the line. paddingBottom is the row's bottom spacing:
  // 0 inside a multi-dot run so the line segments abut (flush), 14 after every
  // other row (the inter-message spacing, prototype .design-timeline gap).
  const timelineRuns = useMemo(() => {
    const classes: string[] = [];
    const paddings: number[] = [];
    let runStart = -1;
    let dots = 0;
    const flushRun = (end: number) => {
      if (runStart === -1) return;
      if (dots <= 1) {
        for (let i = runStart; i <= end; i++) {
          classes[i] = "timeline-run--single";
          paddings[i] = 14;
        }
      } else {
        classes[runStart] = "timeline-run--start";
        paddings[runStart] = 0;
        classes[end] = "timeline-run--end";
        paddings[end] = 14;
        for (let i = runStart + 1; i < end; i++) {
          paddings[i] = 0;
        }
        if (runStart === end) {
          classes[runStart] = "timeline-run--start timeline-run--end";
        }
      }
      runStart = -1;
      dots = 0;
    };
    visibleMessages.forEach((m, i) => {
      if (m.role === "assistant") {
        if (runStart === -1) runStart = i;
        dots += countTimelineBlocks(m);
      } else {
        flushRun(i - 1);
        classes[i] = "";
        paddings[i] = 14;
      }
    });
    flushRun(visibleMessages.length - 1);
    return { classes, paddings };
  }, [visibleMessages]);

  const computeSticky = useCallback(() => {
    const container = containerRef.current;
    // setSticky compares against stickyRef (synced from stickyMessage every
    // render) and skips the state update entirely when the computed value is
    // unchanged — see the stickyRef comment. This keeps the sticky computation
    // off React's nested-passive-update accounting on the streaming hot path.
    const setSticky = (next: { id: string; text: string } | null) => {
      const prev = stickyRef.current;
      const same =
        prev === null
          ? next === null
          : next !== null && prev.id === next.id && prev.text === next.text;
      if (!same) setStickyMessage(next);
    };
    if (!container) {
      setSticky(null);
      return;
    }
    const scrollTop = container.scrollTop;
    // The DOM only holds the visible window, so the sticky candidate is
    // derived from the data + the virtualizer's offset table. The candidate is
    // the last user message whose top edge sits above the viewport top, i.e.
    // the last user message at or before the item currently at the top of the
    // viewport (which is itself a candidate only when its top edge is strictly
    // above the fold).
    const at = virtualizer.getVirtualItemForOffset(scrollTop);
    let idx = at ? at.index : -1;
    if (at && at.start >= scrollTop) idx = at.index - 1;
    const rows = visibleMessagesRef.current;
    let candidate = -1;
    let candidateText = "";
    while (idx >= 0) {
      const row = rows[idx];
      if (row.role === "user") {
        // Skip text-less user messages (task notifications): they cannot
        // render a sticky label, so keep scanning upward for an earlier
        // text-bearing user message instead of clearing the bar.
        const text = (row.blocks ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.content || "")
          .join(" ")
          .trim();
        if (text) {
          candidate = idx;
          candidateText = text;
          break;
        }
      }
      idx--;
    }
    if (candidate < 0 || !rows[candidate].id) {
      setSticky(null);
      return;
    }
    setSticky({ id: rows[candidate].id, text: candidateText });
  }, [virtualizer]);

  const scrollToMessage = useCallback(
    (id: string) => {
      const container = containerRef.current;
      if (!container) return;
      // The target row is likely not mounted (it scrolled far above the
      // viewport), so jump via the virtualizer's offset table instead of
      // querying the DOM.
      const index = visibleMessagesRef.current.findIndex((m) => m.id === id);
      if (index >= 0) {
        // Clicking the sticky bar is an explicit "I'm leaving the bottom"
        // intent, exactly like scrolling up: opt out of following FIRST —
        // otherwise the streaming bottom-pin (gated only on userScrolledUp)
        // fires on the next chunk and yanks the viewport straight back down.
        userScrolledUpRef.current = true;
        // Land instantly, not smoothly. A smooth jump is computed once and
        // then walked frame by frame; while it walks, the rows entering the
        // viewport are being measured for the first time, and the
        // virtualizer's own resize compensation scrolls back to ITS recorded
        // offset — still the bottom — cancelling the jump. Measured: the
        // click moved the viewport 71px and then snapped back to the bottom,
        // i.e. the bar looked dead during streaming. An instant jump updates
        // that recorded offset atomically, so there is nothing left to
        // cancel.
        virtualizer.scrollToIndex(index, {
          align: "center",
          behavior: "auto",
        });
      }
    },
    [virtualizer],
  );

  // Perform a programmatic scroll-to-bottom. Every virtualizer scroll routes
  // through scrollToFn, which stamps its landing position (see autoScrollRef) so
  // the scroll handler treats the resulting 'scroll' event as ours (not the
  // user's) and leaves userScrolledUp alone. scrollToFn writes the spacer height
  // before the scroll (see above), so the browser clamps against the CURRENT
  // total — no stale-height short pin. Any later estimate→measure growth is
  // followed event-driven by the spacer ResizeObserver (see the re-pin effect
  // below) — no frame budget, matching OpenCode's persistent bottom-anchor.
  const doScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const container = containerRef.current;
      if (!container) return;
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer],
  );

  // The bottom WITHOUT the virtualizer's accounting: used for content that sits
  // outside the row spacer (the compaction hint), where scrollToEnd lands short
  // by that content's own height. Marked programmatic like every other write, so
  // its 'scroll' event can never be read as a user gesture.
  const pinToTrueBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    markAutoScroll([
      Math.max(0, container.scrollHeight - container.clientHeight),
    ]);
    container.scrollTop = container.scrollHeight;
  }, [markAutoScroll]);

  // Whether the viewport may move, decided in ONE place and pure — it writes
  // nothing, so no caller has to wonder which state a scroll left behind (the
  // re-arming that `user-sent` does happens in scrollToBottom, before this is
  // asked).
  const mayFollow = useCallback(
    (reason: FollowReason): boolean => {
      if (userScrolledUpRef.current) return false;
      // A content change must not chase a reader who is somewhere else in the
      // history: either the stream is running (the reply is arriving and the
      // reader was following it) or the viewport is at the bottom anyway.
      if (reason === "content") {
        const container = containerRef.current;
        return isStreaming || (!!container && atBottom(container));
      }
      return true;
    },
    [isStreaming],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth", reason: FollowReason = "ambient") => {
      // The user's own message re-arms following. It is the counterpart to the
      // two ways OUT of it (a scroll-away gesture, clicking the sticky bar) and
      // is expressed here rather than hidden inside the judgement below, so
      // "why did following come back?" has exactly one answer per reason.
      if (reason === "user-sent") userScrolledUpRef.current = false;
      if (!mayFollow(reason)) return;
      doScrollToBottom(behavior);
    },
    [doScrollToBottom, mayFollow],
  );

  // Expose ONE explicit "bring me to the bottom" request to the parent (host
  // commands: confirmation shown, pane/session bound, after rewind, settings
  // saved). It is a request, not an order — a user who scrolled up to read
  // history must not be yanked down because a dialog appeared somewhere else
  // (spec: 显式置底请求不得覆盖阅读位置). Restoring follow has exactly two
  // ways: the user scrolls back to the real bottom, or sends a new message.
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior, "ambient");
    },
  }));

  // Auto-scroll to bottom when messages change, streaming updates, or subagent messages update
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial load scrolls instantly ('auto') — a smooth animation would compute
    // its target once and land short while async content (images, webfonts,
    // mermaid) is still loading. isNewMessage marks appended messages.
    const isInitialLoad = isFirstEffectRef.current && messages.length > 0;
    isFirstEffectRef.current = false;
    const isNewMessage =
      messages.length > prevMessagesLengthRef.current ||
      (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;
    const reason: FollowReason = isInitialLoad
      ? "initial"
      : isNewMessage
        ? messages[messages.length - 1]?.role === "user"
          ? "user-sent"
          : "new-message"
        : "content";

    // The scroll event fires for user scrolling (wheel, trackpad, keyboard,
    // scrollbar drag) AND for everything we or the virtualizer do to the
    // viewport (scrollToEnd, resizeItem compensation, browser clamps). Two
    // layers separate them, in this order:
    //   1. a GESTURE GATE — an event with no real input behind it never reaches
    //      the intent decision at all (see handleScroll);
    //   2. a POSITION STAMP (autoScrollRef) — among the events that do have a
    //      gesture behind them, one landing exactly where our own write aimed is
    //      still ours. A counter cannot do this job: a programmatic scroll that
    //      moves nothing fires no event, so the count over-credits the next
    //      genuine gesture.
    // Intent itself is read from DIRECTION: any upward scroll (even a few px)
    // suspends following, so a light nudge up is respected instead of being
    // overridden by the bottom-threshold check. handleScroll explains why the
    // two directions are asymmetric.
    const markUserInput = () => {
      lastUserInputAtRef.current = performance.now();
    };

    const handleScroll = () => {
      // GATE: a 'scroll' event with no real input behind it — our own pin, the
      // virtualizer's resize compensation, a browser clamp — carries no user
      // intent at all, so it must not be allowed to move the opt-out in either
      // direction. opencode does exactly this (`if (!props.hasScrollGesture())
      // return`); it is the only thing that survives the compensations that
      // write back and forth within one frame (measured here: the same tick
      // writes 160619 then 160123, 500px apart, and the event lands at 160103 —
      // no position-stamp tolerance covers that). Baselines still have to be
      // refreshed, or the next genuine gesture is read against a stale
      // prevScrollTop.
      const userJustInteracted =
        performance.now() - lastUserInputAtRef.current <= USER_INPUT_GRACE_MS;
      if (!userJustInteracted) {
        prevScrollTopRef.current = container.scrollTop;
        prevScrollHeightRef.current = container.scrollHeight;
        prevClientHeightRef.current = container.clientHeight;
        computeSticky();
        return;
      }
      const stamp = autoScrollRef.current;
      let wasProgrammatic = false;
      if (stamp) {
        if (performance.now() - stamp.at > AUTO_SCROLL_WINDOW_MS) {
          // Stale: the position is nobody's claim any more.
          autoScrollRef.current = undefined;
        } else {
          wasProgrammatic = stamp.tops.some(
            (top) =>
              Math.abs(container.scrollTop - top) <= AUTO_SCROLL_TOLERANCE_PX,
          );
        }
      }
      const isNearBottom = atBottom(container);
      const scrolledUp = container.scrollTop < prevScrollTopRef.current;
      // A clamp from a content-shrink reflow (scrollHeight decreased) moves
      // scrollTop downward but is NOT user intent — ignore it so auto-follow
      // survives reasoning collapse / streaming-end reflow / image load.
      const contentShrank =
        container.scrollHeight < prevScrollHeightRef.current;
      // Same for a viewport-growth clamp (clientHeight increased, scrollHeight
      // unchanged): the container got taller under the user's parked position,
      // e.g. when the confirmation dialog closes and the input area comes back
      // shorter than the dialog.
      const viewportGrew = container.clientHeight > prevClientHeightRef.current;
      // Past the gate, every event has a real input behind it, so an upward
      // move is the user's — unless it is a clamp from a reflow that happened
      // in the same frame (content shrinking, or the container growing under a
      // parked position), which the two flags above rule out.
      if (scrolledUp && !contentShrank && !viewportGrew) {
        userScrolledUpRef.current = true;
      } else if (!wasProgrammatic && isNearBottom) {
        // Re-engaging still requires an event we are sure is the user's: our own
        // pin lands at the bottom by construction, so reading it as "the user is
        // back at the bottom" would unlock on every pin and drag the reader down
        // again.
        userScrolledUpRef.current = false;
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
    };

    // Does this gesture belong to a region INSIDE the list that scrolls
    // vertically on its own? Tool output, the diff view, reasoning, the write
    // preview and capped user content each carry a max-height + overflow-y
    // (nine rules across Message.css alone): a wheel or drag there is that
    // region's, not a request to leave the bottom — opencode excludes these
    // too (`[data-scrollable]`). Detected from layout rather than a
    // hand-maintained marker attribute: the containers live in a dozen CSS
    // rules across components, and "actually overflows vertically" is exactly
    // the condition that decides whether the inner region can consume the
    // gesture (a capped-but-short region does not swallow a wheel, so it must
    // not suppress the list's own reading intent either).
    //
    // What this decides is only whether the intent may be LATCHED at the input
    // event; the input itself is always recorded (see handleWheel). opencode
    // draws the same line in `markBoundaryGesture`: a gesture inside a nested
    // region is forwarded to the list only when that region is at its own edge
    // and the delta is going to be scrolled by the list.
    const ownsVerticalScroll = (target: EventTarget | null): boolean => {
      let el = target instanceof Element ? target : null;
      while (el && el !== container) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const overflowY = getComputedStyle(el).overflowY;
          if (overflowY === "auto" || overflowY === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    // A wheel scroll-up is recognized synchronously at the INPUT event, not at
    // the browser's synthesized 'scroll' event — the browser dispatches that on
    // a later rendering frame, and a streaming chunk's programmatic pin can win
    // the race and yank the viewport back down before the intent is recorded
    // (chunk-dense streams — e.g. reasoning — then feel like "I scroll up and
    // it keeps pulling me back"). Pinch-zoom also delivers wheel events with a
    // negative deltaY but no scrolling intent, so exclude ctrlKey wheels. Only
    // the opt-out is set here; re-engaging follow is unchanged (scrolling back
    // down to the bottom region clears userScrolledUp in handleScroll).
    const handleWheel = (e: WheelEvent) => {
      // markUserInput is NOT gated on ownsVerticalScroll: when the inner region
      // cannot consume the wheel (it is already at its own top) the delta ends
      // up scrolling the list, and that scroll event must find the gesture gate
      // open or the list's own scroll-up goes unrecorded and the reader gets
      // pulled back to the bottom. Only the synchronous opt-out is withheld,
      // since a wheel the inner region actually consumes never moves the list.
      markUserInput();
      if (!e.ctrlKey && e.deltaY < 0 && !ownsVerticalScroll(e.target)) {
        userScrolledUpRef.current = true;
      }
    };

    // Touch: a finger moving DOWN drags the content UP (earlier history), the
    // same intent as a wheel with deltaY < 0 — latched at the input event for
    // the same reason, since touch scrolling ships no wheel events. Same
    // division as the wheel: the drag is always recorded, only the opt-out is
    // held back while the finger is on a nested scroller.
    let lastTouchY: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      markUserInput();
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      markUserInput();
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      if (
        lastTouchY !== null &&
        y > lastTouchY &&
        !ownsVerticalScroll(e.target)
      ) {
        userScrolledUpRef.current = true;
      }
      lastTouchY = y;
    };

    // Keyboard scroll keys, for the focus holders inside the list (the table
    // scroll wrapper is a roving stop). Only the upward keys opt out here —
    // scrolling back down to the bottom re-engages follow via handleScroll.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const up = e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home";
      const down =
        e.key === "ArrowDown" ||
        e.key === "PageDown" ||
        e.key === "End" ||
        e.key === " ";
      if (!up && !down) return;
      markUserInput();
      // Arrowing inside a region that scrolls on its own is that region's
      // business too (the focus holders here include the table wrapper).
      if (up && !ownsVerticalScroll(e.target)) {
        userScrolledUpRef.current = true;
      }
    };

    // Scrollbar drag: Chromium targets the scroll container itself for mouse
    // events on its track, and the track band is exactly the width the classic
    // scrollbar takes out of the layout (0 for overlay scrollbars, where
    // grabbing the track isn't possible anyway). The drag's direction is read
    // from the resulting scroll events; what this has to supply is the gesture
    // the gate looks for — and it must keep supplying it for the WHOLE drag,
    // not just the mousedown: a thumb drag lasts far longer than the grace
    // window, and once the gate closed mid-drag, dragging down to the bottom
    // would no longer re-engage following.
    const handleMouseDown = (e: MouseEvent) => {
      const track = container.offsetWidth - container.clientWidth;
      if (track <= 0) return;
      if (e.clientX < container.getBoundingClientRect().right - track) return;
      trackDragRef.current = true;
      markUserInput();
    };
    const handleWindowMouseMove = () => {
      if (trackDragRef.current) markUserInput();
    };
    const handleWindowMouseUp = () => {
      trackDragRef.current = false;
    };

    container.addEventListener("scroll", handleScroll);
    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    // Use ResizeObserver to recompute sticky state on content height changes
    // (images, diffs, etc.). Auto-scroll itself is driven by the messages
    // dependency below, not by the observer.
    const resizeObserver = new ResizeObserver(() => {
      // Re-baseline the geometry refs on container resizes. A resize that
      // produces no scroll event (user not at the bottom → no clamp) would
      // otherwise leave prevClientHeight stale, and the NEXT genuine scroll-up
      // would be misread as a viewport-growth clamp and fail to suspend
      // following. If a clamp's scroll event hasn't been dispatched yet,
      // re-baselining here also neutralizes it (scrollTop no longer "decreased").
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
    });

    resizeObserver.observe(container);

    // Follow new content: scroll on every messages change (incl. streaming text
    // chunks so streamed text stays visible). The reason carries the decision —
    // whether this change is allowed to override the user's reading position is
    // scrollToBottom's judgement, not a flag assembled here.
    scrollToBottom(isStreaming || isInitialLoad ? "auto" : "smooth", reason);
    computeSticky();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [messages, queuedMessages, isStreaming, scrollToBottom, computeSticky]);

  // Re-pin to the true bottom after async content finishes loading (image
  // decode, webfont reflow, mermaid render). 'load' doesn't bubble, so listen in
  // capture phase; re-pin with 'auto' — a smooth re-pin would miss again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repin = () => scrollToBottom("auto", "ambient");
    container.addEventListener("load", repin, true);
    document.fonts?.ready.then(repin);
    return () => container.removeEventListener("load", repin, true);
  }, [scrollToBottom]);

  // Persistent bottom-follow on the spacer itself, OpenCode-style (their
  // resizeItem override re-scrolls to the end on every measurement; ours
  // observes the spacer, which covers ALL total changes — both resizeItem row
  // measurements and the avg-based re-estimation of unmeasured rows that
  // never goes through resizeItem). The estimate→measure waves are not
  // time-bounded, so a budgeted chase can park above a later wave; any spacer
  // size change while the user hasn't scrolled up re-pins instead (the shrink
  // direction harmlessly re-pins to the already-clamped bottom).
  useEffect(() => {
    const spacer = spacerRef.current;
    if (!spacer) return;
    const observer = new ResizeObserver(() => {
      scrollToBottom("auto", "ambient");
    });
    observer.observe(spacer);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // The compaction hint mounts below the last message (after the virtualizer's
  // in-flow spacer). scrollToEnd only accounts for row heights, so a pinned
  // viewport stays short by the hint's own height — the loading text and its
  // streaming tail would sit just below the fold. Re-pin to the true bottom
  // (scrollHeight includes the hint) when compaction starts; the hint is a
  // static one-liner, so no re-pin is needed as its tail grows. Respect an
  // opt-out: a user reading history isn't yanked back down.
  useEffect(() => {
    if (!isCompacting || !mayFollow("ambient")) return;
    pinToTrueBottom();
  }, [isCompacting, mayFollow, pinToTrueBottom]);

  return (
    <div
      ref={containerRef}
      id="messagesContainer"
      className={`messages-container${isStreaming ? " streaming" : ""}${isCompacting ? " compacting" : ""} messages-container--virtual`}
      data-testid="messages-container"
    >
      {/* The scroll surface is the whole pane; the capped, centered column
          lives in this inner wrapper (see MessageList.css). Rows resolve
          against it (position: relative), so its offset from the scroll
          surface must stay 0 — the 10px padding is inside it. */}
      <div className="messages-column">
        {stickyMessage && (
          <div className="sticky-user-wrapper">
            <div className="sticky-user-cap" />
            <div
              className="sticky-user-message"
              data-testid="sticky-user-message"
              onClick={() => scrollToMessage(stickyMessage.id)}
            >
              <div className="sticky-user-content">{stickyMessage.text}</div>
            </div>
            <div className="sticky-user-scrim" />
          </div>
        )}
        <>
          {/* In-flow spacer carrying the virtualized total height. The
              virtualizer writes its height directly (directDomUpdates); it
              must keep its space in the flex column (flex-shrink: 0). */}
          <div
            ref={(node) => {
              virtualizer.containerRef(node);
              spacerRef.current = node;
            }}
            className="virtual-spacer"
          />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = visibleMessages[virtualRow.index];
            const runClass = timelineRuns.classes[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-measured-message-id={message.id}
                ref={measureRow}
                className={`virtual-row${runClass ? ` ${runClass}` : ""}`}
                style={{
                  paddingBottom: timelineRuns.paddings[virtualRow.index],
                }}
              >
                <Message
                  key={message.id}
                  message={message}
                  vscode={vscode}
                  onRewindToMessage={onRewindToMessage}
                  workdir={workdir}
                  onOpenPreview={onOpenPreview}
                  onOpenFile={onOpenFile}
                />
              </div>
            );
          })}
        </>
        {/* Compaction hint: blinking cursor + label pinned to the end of the
            message list, independent of isStreaming (auto-compaction runs between
            turns, after the streaming cursor is gone). */}
        {isCompacting && (
          <div className="compaction-hint" data-testid="compaction-hint">
            <span className="compaction-hint-cursor">▋</span>正在压缩对话
            {compactionStream && (
              <span
                className="compaction-hint-tail"
                data-testid="compaction-hint-tail"
              >
                {streamingTail(compactionStream)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
