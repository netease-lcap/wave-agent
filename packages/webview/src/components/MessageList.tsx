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
import type { Message as MessageType } from "wave-agent-sdk";
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
  // Briefly true around our own programmatic scrolls (scrollToEnd /
  // scrollToIndex) so the scroll handler can ignore those as user intent.
  // Streaming uses 'auto' (instant, single fire), so a one-frame reset via
  // requestAnimationFrame is sufficient.
  const isProgrammaticScrollRef = useRef(false);
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
    paddingStart: 10, // .messages-container padding
    paddingEnd: 10,
    // Keep the reading position anchored on appends; follow new content only
    // when the user is already at the end (streaming bottom-pin).
    anchorTo: "end",
    followOnAppend: true,
    getItemKey: (i) => visibleMessages[i].id,
    // Skip React re-renders for scroll-only updates: the virtualizer writes
    // row transforms and the spacer height straight to the DOM, re-rendering
    // only when the visible range or isScrolling changes.
    directDomUpdates: true,
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
      isProgrammaticScrollRef.current = true;
      elementScroll(offset, opts, instance);
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
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
  // 0 inside a multi-dot run so the line segments abut (flush), 10 after every
  // other row (the inter-message spacing).
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
          paddings[i] = 10;
        }
      } else {
        classes[runStart] = "timeline-run--start";
        paddings[runStart] = 0;
        classes[end] = "timeline-run--end";
        paddings[end] = 10;
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
        paddings[i] = 10;
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
        virtualizer.scrollToIndex(index, {
          align: "center",
          behavior: "smooth",
        });
      }
    },
    [virtualizer],
  );

  // Perform a programmatic scroll-to-bottom, guarding it with the
  // isProgrammaticScroll flag so the scroll handler treats the resulting
  // 'scroll' event as ours (not the user's) and leaves userScrolledUp alone.
  // scrollToFn writes the spacer height before the scroll (see above), so the
  // browser clamps against the CURRENT total — no stale-height short pin. Any
  // later estimate→measure growth is followed event-driven by the spacer
  // ResizeObserver (see the re-pin effect below) — no frame budget, matching
  // OpenCode's persistent bottom-anchor.
  const doScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const container = containerRef.current;
      if (!container) return;
      isProgrammaticScrollRef.current = true;
      virtualizer.scrollToEnd({ behavior });
      // 'auto' is instant (single 'scroll' fire); reset on the next frame.
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    },
    [virtualizer],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth", force = false) => {
      const container = containerRef.current;
      if (!container) return;

      const isNearBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 300;

      const isUserMessage =
        messages.length > 0 && messages[messages.length - 1].role === "user";
      // Force scroll if it's a new message AND (it's from user OR user is already at bottom)
      const shouldForce =
        force && (isUserMessage || !userScrolledUpRef.current);

      // Always scroll if:
      // 1. It's a brand new message that should be forced
      // 2. We are currently streaming content AND user hasn't scrolled up
      // 3. The user is already near the bottom AND hasn't scrolled up
      if (
        shouldForce ||
        ((isStreaming || isNearBottom) && !userScrolledUpRef.current)
      ) {
        // A new user message means the user wants to follow the upcoming reply:
        // clear any prior opt-out so streaming auto-scrolls into view.
        if (shouldForce && isUserMessage) {
          userScrolledUpRef.current = false;
        }
        doScrollToBottom(behavior);
      }
    },
    [messages, isStreaming, doScrollToBottom],
  );

  // Expose scrollToBottom method to parent component
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = "smooth") => {
      doScrollToBottom(behavior);
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

    // The scroll event fires for user scrolling (wheel, trackpad, keyboard,
    // scrollbar drag) AND our own programmatic scrolls (scrollToEnd etc.). We
    // distinguish them with isProgrammaticScroll: ignore 'scroll' events we
    // caused, so they can't reset userScrolledUp and yank the user back to the
    // bottom. For real user scrolling, we use DIRECTION to decide intent — any
    // upward scroll (even a few px) suspends following, so a light nudge up is
    // respected instead of being overridden by the bottom-threshold check.
    // Only scrolling
    // back down to the bottom region resumes following.
    const handleScroll = () => {
      if (!isProgrammaticScrollRef.current) {
        const isNearBottom =
          container.scrollTop + container.clientHeight >=
          container.scrollHeight - 300;
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
        const viewportGrew =
          container.clientHeight > prevClientHeightRef.current;
        // An upward gesture always opts out of following (covers the "slight
        // nudge up then stop" case that the distance threshold alone missed).
        // A downward gesture to the bottom region opts back in.
        if (scrolledUp && !contentShrank && !viewportGrew) {
          userScrolledUpRef.current = true;
        } else if (isNearBottom) {
          userScrolledUpRef.current = false;
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
    };

    container.addEventListener("scroll", handleScroll);

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
    // chunks so streamed text stays visible), gated by userScrolledUp inside
    // scrollToBottom. A brand-new message forces the scroll.
    scrollToBottom(
      isStreaming || isInitialLoad ? "auto" : "smooth",
      isNewMessage || isInitialLoad,
    );
    computeSticky();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messages, queuedMessages, isStreaming, scrollToBottom, computeSticky]);

  // Re-pin to the true bottom after async content finishes loading (image
  // decode, webfont reflow, mermaid render). 'load' doesn't bubble, so listen in
  // capture phase; re-pin with 'auto' — a smooth re-pin would miss again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repin = () => {
      if (!userScrolledUpRef.current) doScrollToBottom("auto");
    };
    container.addEventListener("load", repin, true);
    document.fonts?.ready.then(repin);
    return () => container.removeEventListener("load", repin, true);
  }, [doScrollToBottom]);

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
      if (!userScrolledUpRef.current) doScrollToBottom("auto");
    });
    observer.observe(spacer);
    return () => observer.disconnect();
  }, [doScrollToBottom]);

  return (
    <div
      ref={containerRef}
      id="messagesContainer"
      className={`messages-container${isStreaming ? " streaming" : ""}${isCompacting ? " compacting" : ""} messages-container--virtual`}
      data-testid="messages-container"
    >
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
  );
});
