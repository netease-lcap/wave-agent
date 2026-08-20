import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Message } from "./Message";
import { streamingTail } from "../utils/streamingText";
import type { MessageListProps } from "../types";
import type { Message as MessageType } from "wave-agent-sdk";
import "../styles/MessageList.css";

// Above this many visible messages the list switches to the virtualized
// branch (@tanstack/react-virtual); below it the plain render path stays
// byte-for-byte identical. The threshold keeps small chats (the common case
// for unit tests and demo harnesses) on the plain path.
const VIRTUAL_SCROLL_THRESHOLD = 200;

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  // Briefly true around our own scrollIntoView calls so the scroll handler can
  // ignore those as user intent. Streaming uses 'auto' (instant, single fire),
  // so a one-frame reset via requestAnimationFrame is sufficient.
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

  // Filter out user messages with isMeta (hidden from the list). Extracted from
  // the render path so both the plain and the virtualized branch index the same
  // data.
  const visibleMessages = useMemo(() => {
    const out: MessageType[] = [];
    for (const msg of messages) {
      if (msg.role === "user" && msg.isMeta) continue;
      out.push(msg);
    }
    return out;
  }, [messages]);

  const virtualized = visibleMessages.length > VIRTUAL_SCROLL_THRESHOLD;

  // Refs mirroring the branch state for stable callbacks (event handlers and
  // imperative handle must not capture a stale render).
  const virtualizedRef = useRef(virtualized);
  virtualizedRef.current = virtualized;
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;
  stickyRef.current = stickyMessage;

  const virtualizer = useVirtualizer({
    // count: 0 keeps the virtualizer inert on the plain path (it still mounts
    // its observers, but renders no rows).
    count: virtualized ? visibleMessages.length : 0,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 200,
    overscan: 20,
    // Inter-row spacing is baked into each row's padding-bottom (see
    // timelineRuns) instead of the virtualizer's `gap`: the plain path renders
    // consecutive assistant messages flush (gap 0) so the timeline line is
    // continuous through a run — a uniform `gap` would break the line at every
    // message boundary.
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
  });

  // Per-message timeline run data for the virtualized branch. A run is a
  // maximal sequence of consecutive assistant messages (mirrors the
  // .assistant-group logic of the plain path). Multi-dot runs draw a
  // continuous vertical line: the run's first row starts it at its first dot,
  // the last row ends it at its last dot; single-dot runs hide the line.
  // paddingBottom is the row's bottom spacing: 0 inside a multi-dot run so the
  // line segments abut (flush, like the plain path's gap:0 group), 10 after
  // every other row (the plain path's 10px container gap).
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
    if (virtualizedRef.current) {
      // Virtualized branch: the DOM only holds the visible window, so the
      // sticky candidate is derived from the data + the virtualizer's offset
      // table. The candidate is the last user message whose top edge sits
      // above the viewport top, i.e. the last user message at or before the
      // item currently at the top of the viewport (which is itself a
      // candidate only when its top edge is strictly above the fold).
      const at = virtualizer.getVirtualItemForOffset(scrollTop);
      let idx = at ? at.index : -1;
      if (at && at.start >= scrollTop) idx = at.index - 1;
      const rows = visibleMessagesRef.current;
      let candidate = -1;
      while (idx >= 0) {
        if (rows[idx].role === "user") {
          candidate = idx;
          break;
        }
        idx--;
      }
      if (candidate < 0) {
        setSticky(null);
        return;
      }
      const msg = rows[candidate];
      const text = (msg.blocks ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.content || "")
        .join(" ")
        .trim();
      if (!msg.id || !text) {
        setSticky(null);
        return;
      }
      setSticky({ id: msg.id, text });
      return;
    }
    // Plain path: scan the fully-rendered DOM, as before.
    const nodes = container.querySelectorAll<HTMLElement>(
      '[data-role="user"][data-message-id]',
    );
    let candidateNode: HTMLElement | null = null;
    // Find the last user message whose top edge has scrolled above the viewport top.
    for (const node of nodes) {
      if (node.offsetTop < scrollTop) {
        candidateNode = node;
      } else {
        break;
      }
    }
    if (!candidateNode) {
      setSticky(null);
      return;
    }
    const id = candidateNode.getAttribute("data-message-id") || "";
    const text =
      candidateNode.querySelector(".user-content")?.textContent?.trim() || "";
    if (!id || !text) {
      setSticky(null);
      return;
    }
    setSticky({ id, text });
  }, [virtualizer]);

  const scrollToMessage = useCallback(
    (id: string) => {
      const container = containerRef.current;
      if (!container) return;
      if (virtualizedRef.current) {
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
        return;
      }
      const node = container.querySelector<HTMLElement>(
        `[data-message-id="${id}"]`,
      );
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [virtualizer],
  );

  // Perform a programmatic scroll-to-bottom, guarding it with the
  // isProgrammaticScroll flag so the scroll handler treats the resulting
  // 'scroll' event as ours (not the user's) and leaves userScrolledUp alone.
  const doScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const container = containerRef.current;
      if (!container) return;
      isProgrammaticScrollRef.current = true;
      if (virtualizedRef.current) {
        virtualizer.scrollToEnd({ behavior });
        // The virtualizer's resizeItem compensation and the scrollToEnd above
        // both target offsets computed before the spacer height lands in the
        // DOM (the spacer write happens later in the frame, after the scrollTo
        // was clamped against the stale scrollHeight; the ResizeObserver →
        // animation-frame measurement can even trail by a full frame). Keep
        // re-checking for a few frames and finish the jump once the spacer is
        // in place, so streaming row growth still pins the viewport.
        let attempts = 0;
        const finishPin = () => {
          if (attempts++ >= 8) return;
          // Only chase the bottom while the viewport is still parked there; if
          // the user scrolls away during the compensation window, stop so we
          // don't yank them back to the bottom.
          if (
            container.scrollTop + container.clientHeight <
            container.scrollHeight - 300
          ) {
            return;
          }
          if (
            container.scrollHeight -
              container.scrollTop -
              container.clientHeight >
            2
          ) {
            isProgrammaticScrollRef.current = true;
            virtualizer.scrollToEnd({ behavior: "auto" });
            requestAnimationFrame(() => {
              isProgrammaticScrollRef.current = false;
            });
          }
          requestAnimationFrame(finishPin);
        };
        requestAnimationFrame(finishPin);
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior });
      }
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
      const messagesEnd = messagesEndRef.current;
      if (!container || !messagesEnd) return;

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
    // scrollbar drag) AND our own programmatic scrollIntoView. We distinguish
    // them with isProgrammaticScroll: ignore 'scroll' events we caused, so they
    // can't reset userScrolledUp and yank the user back to the bottom. For real
    // user scrolling, we use DIRECTION to decide intent — any upward scroll
    // (even a few px) suspends following, so a light nudge up is respected
    // instead of being overridden by the bottom-threshold check. Only scrolling
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

  // Plain path (small chats): group consecutive assistant messages into a
  // single .assistant-group wrapper so the timeline vertical line runs
  // continuously through all their dots. User messages break the timeline
  // (rendered as bare bubbles outside any group).
  const renderedPlain = useMemo(() => {
    const renderMessage = (message: MessageType) => {
      return (
        <Message
          key={message.id}
          message={message}
          vscode={vscode}
          onRewindToMessage={onRewindToMessage}
          workdir={workdir}
          onOpenPreview={onOpenPreview}
          onOpenFile={onOpenFile}
        />
      );
    };

    const rendered: React.ReactNode[] = [];
    let group: { message: MessageType }[] = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      const dotCount = group.reduce(
        (sum, g) => sum + countTimelineBlocks(g.message),
        0,
      );
      const single = dotCount <= 1;
      rendered.push(
        <div
          key={group[0].message.id}
          className={`assistant-group${single ? " assistant-group--single" : ""}`}
        >
          {group.map((g) => renderMessage(g.message))}
        </div>,
      );
      group = [];
    };

    visibleMessages.forEach((message) => {
      if (message.role === "assistant") {
        group.push({ message });
      } else {
        flushGroup();
        rendered.push(renderMessage(message));
      }
    });
    flushGroup();

    return rendered;
  }, [
    visibleMessages,
    vscode,
    onRewindToMessage,
    workdir,
    onOpenPreview,
    onOpenFile,
  ]);

  return (
    <div
      ref={containerRef}
      id="messagesContainer"
      className={`messages-container${isStreaming ? " streaming" : ""}${isCompacting ? " compacting" : ""}${virtualized ? " messages-container--virtual" : ""}`}
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
      {virtualized ? (
        <>
          {/* In-flow spacer carrying the virtualized total height. The
              virtualizer writes its height directly (directDomUpdates); it
              must keep its space in the flex column (flex-shrink: 0). */}
          <div ref={virtualizer.containerRef} className="virtual-spacer" />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = visibleMessages[virtualRow.index];
            const runClass = timelineRuns.classes[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
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
      ) : (
        // Plain path (small chats): byte-for-byte the original render, with
        // consecutive assistant messages grouped into a .assistant-group so
        // the timeline line runs continuously through their dots.
        <>{renderedPlain}</>
      )}
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

      {/* Invisible div to scroll to */}
      <div ref={messagesEndRef} />
    </div>
  );
});
