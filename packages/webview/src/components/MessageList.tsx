import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { Message } from "./Message";
import { streamingTail } from "../utils/streamingText";
import { estimateRowHeight } from "../virtual/estimateRowHeight";
import { useVirtualRows } from "../virtual/useVirtualRows";
import type { MessageListProps } from "../types";
import type { Message as MessageType } from "wave-agent-sdk/types";
import "../styles/MessageList.css";

// 行坐标的原点：行绝对定位在 `.messages-column` 的 padding box 上，spacer 在流里
// 从 content box 起算，两者的差就是这一列 10px 的 padding。内核对这个偏移一无所
// 知，由这里告诉它（与 CSS 里 `.messages-column { padding: 10px }` 同源）。
const COLUMN_PADDING_PX = 10;

// 滚到离顶这么近就要下一页更早的。留一点余量而不是严格的 0：触摸惯性把
// scrollTop 拉过顶时浏览器会直接 clamp 到 0，那一刻的位移是 0，判定必须能接受
// 「已经在顶部」这个状态本身。
const EARLIER_TRIGGER_PX = 160;

/**
 * The text this row contributes to the sticky bar — empty when it cannot be an
 * anchor at all: assistant rows, injected `isMeta` user rows (reminders, rules,
 * hook context) and user rows with no text block (task notifications).
 * computeSticky scrolls up past those to the nearest real question. Every
 * "can this row be the sticky anchor" judgement goes through here — a second
 * copy of this condition IS how the sticky bar disappeared.
 */
const stickyAnchorText = (message: MessageType) => {
  if (message.role !== "user" || message.isMeta) return "";
  return (message.blocks ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.content || "")
    .join(" ")
    .trim();
};

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
    onBackgroundCurrentTask,
    workdir,
    onOpenPreview,
    onOpenFile,
    hasEarlier,
    isLoadingEarlier,
    onLoadEarlier,
    docKey,
  },
  ref,
) {
  // 尾锚定判据用的「上一条尾巴」与「上一个长度」，两者都取**可见列表**（见下面的
  // visibleMessages 与 follow effect 里的注释），初值只在本轮 effect 首跑前有效。
  const prevVisibleLengthRef = useRef(0);
  // 「来了新消息」的判据是**尾巴这条消息 id 变了、且列表没变短**，不是「长度变长了」：
  // 追加、重连补差、rewind 截断、整表替换这几种变化里，只有前一种该把视口钉到底；
  // 只比长度会把「截短后又长回原长」误判成新消息，也会漏掉「长度不变但尾巴换了」。
  const prevTailIdRef = useRef<string | undefined>(undefined);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  // True until the first effect run after mount. MessageList only renders once
  // messages exist (empty state shows LoadingLogo/WelcomeView), so the first run
  // IS the initial session load and must force-scroll to the bottom.
  const isFirstEffectRef = useRef(true);
  // 上一页还没回来。父组件也传 `isLoadingEarlier`，但这个 ref 是同步的：滚动事件
  // 一帧里可能连发多次，等到 setState 生效才拦就已经发了两个请求。
  const earlierPendingRef = useRef(false);

  // The most-recent user message that has scrolled above the viewport top; pinned
  // at the top of the list as a context hint (设计稿 2236-3792).
  const [stickyMessage, setStickyMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // Mirror of stickyMessage for computeSticky's pre-comparison. computeSticky
  // runs on every messages update (each streaming chunk) and from the scroll
  // handler. Its setStickyMessage is the only setState on the streaming hot
  // path. With a functional updater React only bails out cheaply when the
  // update queue is empty; during high-frequency dual-stream (reasoning + text)
  // chunks pile up while a render is in flight, the queue is never empty, and
  // every computeSticky call schedules an update — counting toward React's
  // nestedPassiveUpdateLimit and eventually firing "Maximum update depth
  // exceeded". Comparing against the ref and skipping the call entirely when
  // the value is unchanged avoids scheduling altogether.
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

  const keys = useMemo(
    () => visibleMessages.map((message) => message.id),
    [visibleMessages],
  );

  const estimate = useCallback(
    (index: number) => estimateRowHeight(visibleMessages[index]),
    [visibleMessages],
  );

  // 虚拟化内核（自研，见 `src/virtual/`）。它自己管滚动分类、钉底状态、锚点补偿
  // 与阅读位置记录；这里只管「什么时候该钉/松手」和行内渲染。
  const list = useVirtualRows({
    keys,
    estimate,
    originOffsetPx: COLUMN_PADDING_PX,
    docKey,
  });
  const {
    containerRef,
    rows,
    totalSize,
    measureRow,
    scrollToEnd,
    scrollToIndex,
    indexAtOffset,
    rowStart,
    isPinned,
    pin,
    unpin,
  } = list;

  // Refs mirroring the current data for stable callbacks (event handlers and
  // the imperative handle must not capture a stale render).
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;
  // 上翻的开关与回调也走 ref：滚动 handler 挂在 effect 里、依赖里没有它们，
  // 直接闭包会读到挂载那一刻的值（hasEarlier 要到首屏回包之后才翻真）。
  const hasEarlierRef = useRef(false);
  hasEarlierRef.current = !!hasEarlier;
  const isLoadingEarlierRef = useRef(false);
  isLoadingEarlierRef.current = !!isLoadingEarlier;
  const onLoadEarlierRef = useRef(onLoadEarlier);
  onLoadEarlierRef.current = onLoadEarlier;
  stickyRef.current = stickyMessage;

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
    // derived from the data + the offset table. The candidate is the last user
    // message whose top edge sits above the viewport top, i.e. the last user
    // message at or before the item currently at the top of the viewport (which
    // is itself a candidate only when its top edge is strictly above the fold).
    const at = indexAtOffset(scrollTop);
    let idx = at;
    if (at >= 0 && rowStart(at) >= scrollTop) idx = at - 1;
    const rows = visibleMessagesRef.current;
    let candidate = -1;
    let candidateText = "";
    while (idx >= 0) {
      const row = rows[idx];
      if (row.role === "user") {
        // Skip text-less user messages (task notifications): they cannot
        // render a sticky label, so keep scanning upward for an earlier
        // text-bearing user message instead of clearing the bar.
        const text = stickyAnchorText(row);
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
  }, [containerRef, indexAtOffset, rowStart]);

  const scrollToMessage = useCallback(
    (id: string) => {
      const container = containerRef.current;
      if (!container) return;
      const index = visibleMessagesRef.current.findIndex((m) => m.id === id);
      if (index < 0) return;
      // Clicking the sticky bar is an explicit "I'm leaving the bottom" intent,
      // exactly like scrolling up: opt out of following FIRST — otherwise the
      // streaming bottom-pin fires on the next chunk and yanks the viewport
      // straight back down.
      unpin();
      // Land instantly, not smoothly. A smooth jump is computed once and then
      // walked frame by frame; while it walks, the rows entering the viewport
      // are being measured for the first time and their compensation scrolls
      // back to the recorded bottom, cancelling the jump (measured: the click
      // moved 71px and then snapped back). An instant jump lands in one write,
      // so there is nothing left to cancel.
      scrollToIndex(index, "center", "auto");
    },
    [containerRef, scrollToIndex, unpin],
  );

  /**
   * 跟着新内容走到底。这是唯一一处「要不要动视口」的判断，判据只有一个：现在钉着
   * 没有。钉着 = 读者在最底下、想看新东西（首屏、用户刚发消息、已经在底部），于是
   * 追加、流式增长、估算纠正、压缩提示出现全都跟着走；松手了 = 读者正在别处看历
   * 史，谁都不许把他拽回来。
   *
   * `pinFirst` 只给「用户自己发了消息」这一路：它是两条重新钉上的路之一（另一条
   * 是滚回真实底部，由内核的滚动分类认）。
   */
  const followToBottom = useCallback(
    (behavior: ScrollBehavior, pinFirst = false) => {
      if (pinFirst) pin();
      if (!isPinned()) return;
      scrollToEnd(behavior);
    },
    [isPinned, pin, scrollToEnd],
  );

  // Expose ONE explicit "bring me to the bottom" request to the parent (host
  // commands: confirmation shown, pane/session bound, after rewind, settings
  // saved). It is a request, not an order — a user who scrolled up to read
  // history must not be yanked down because a dialog appeared somewhere else
  // (spec: 显式置底请求不得覆盖阅读位置). Restoring follow has exactly two
  // ways: the user scrolls back to the real bottom, or sends a new message.
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = "smooth") => {
      followToBottom(behavior);
    },
  }));

  // Auto-scroll to bottom when messages change, streaming updates, or subagent messages update
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial load scrolls instantly ('auto') — a smooth animation would compute
    // its target once and land short while async content (images, webfonts,
    // mermaid) is still loading. isNewMessage marks messages appended AT THE TAIL:
    // the judgement has to look at the tail's identity, not at the length, because
    // a rewind truncates this list (a shorter list is not "a new message") and a
    // replacement can change the tail without changing the length.
    //
    // The tail is the tail of the VISIBLE list, not of `messages`. Injected meta
    // user messages (task reminder, triggered `.wave/rules` rule, hook
    // additionalContext, changed-files notice, plan mode reminder — `isMeta: true`,
    // appended by the SDK between model requests, hidden from the list) also land
    // at the end of the raw array, and the tail's ROLE is what arms the one reason
    // allowed to lift the opt-out. Reading the raw tail, a mid-turn injection
    // looks exactly like the user having just sent a message: following was
    // re-armed behind an invisible change and the reader in the history was pinned
    // to the bottom — for the rest of the turn, since every later chunk then
    // follows. Judged on the visible list, an injection is not a tail change at
    // all.
    const visibleTail = visibleMessages[visibleMessages.length - 1];
    const isInitialLoad =
      isFirstEffectRef.current && visibleMessages.length > 0;
    isFirstEffectRef.current = false;
    const tailId = visibleTail?.id;
    const isNewMessage =
      (tailId !== prevTailIdRef.current &&
        visibleMessages.length >= prevVisibleLengthRef.current) ||
      (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevVisibleLengthRef.current = visibleMessages.length;
    prevTailIdRef.current = tailId;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;

    followToBottom(
      isStreaming || isInitialLoad ? "auto" : "smooth",
      // 用户自己发的消息是唯一能解除阅读位置锁的一条路。
      !isInitialLoad && isNewMessage && visibleTail?.role === "user",
    );
    computeSticky();
  }, [
    messages,
    // Derived from `messages`, listed because the tail judgement now reads the
    // VISIBLE list (see the comment there).
    visibleMessages,
    queuedMessages,
    isStreaming,
    followToBottom,
    computeSticky,
    containerRef,
  ]);

  // Re-pin to the true bottom after async content finishes loading (image
  // decode, webfont reflow, mermaid render). 'load' doesn't bubble, so listen in
  // capture phase; re-pin with 'auto' — a smooth re-pin would miss again.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repin = () => followToBottom("auto");
    container.addEventListener("load", repin, true);
    document.fonts?.ready.then(repin);
    return () => container.removeEventListener("load", repin, true);
  }, [followToBottom, containerRef]);

  // The compaction hint mounts below the last message (after the spacer).
  // The list is still pinned there, but the hint's own height arrives after the
  // last row's measurement, so pin once it is on screen.
  useEffect(() => {
    if (!isCompacting) return;
    followToBottom("auto");
  }, [isCompacting, followToBottom]);

  // 滚动：上翻取页与吸顶条都跟着读一次。钉底状态由内核自己判（它才是那个能分清
  // 「这次滚动是我们写的 / 浏览器夹的 / 用户滚的」的地方）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 滚到顶就要一页更早的。这一条与「用户意图」无关——程序性滚动也可能把我们带
    // 到顶部（比如整表替换后视口被重新定位），那时只要确实还有更早的内容，把它取
    // 回来就是对的。
    const maybeRequestEarlier = () => {
      if (!hasEarlierRef.current || isLoadingEarlierRef.current) return;
      if (earlierPendingRef.current) return;
      const load = onLoadEarlierRef.current;
      if (!load) return;
      if (container.scrollTop > EARLIER_TRIGGER_PX) return;
      const first = visibleMessagesRef.current[0]?.id;
      if (!first) return;
      earlierPendingRef.current = true;
      load(first);
    };

    const handleScroll = () => {
      maybeRequestEarlier();
      computeSticky();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [computeSticky, containerRef]);

  // Does this gesture belong to a region INSIDE the list that scrolls
  // vertically on its own? Tool output, the diff view, reasoning, the write
  // preview and capped user content each carry a max-height + overflow-y (nine
  // rules across Message.css alone): a wheel or drag there is that region's, not
  // a request to leave the bottom. Detected from layout rather than a
  // hand-maintained marker attribute: the containers live in a dozen CSS rules
  // across components, and "actually overflows vertically" is exactly the
  // condition that decides whether the inner region can consume the gesture (a
  // capped-but-short region does not swallow a wheel, so it must not suppress
  // the list's own reading intent either).
  const ownsVerticalScroll = useCallback(
    (target: EventTarget | null): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      let el = target instanceof Element ? target : null;
      while (el && el !== container) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const overflowY = getComputedStyle(el).overflowY;
          if (overflowY === "auto" || overflowY === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    },
    [containerRef],
  );

  // 手势：上滚的意图在**输入事件**上就落锁，不等浏览器合成的 'scroll' 事件——
  // 那个事件在更晚的渲染帧才派发，一帧密集的流式 chunk 会在它之前把视口钉回底
  // 部，意图就丢了（reasoning 流下体感是「我往上滚它一直把我拽回来」）。捏合缩放
  // 也发负 deltaY 的 wheel，但那没有滚动意图，排除 ctrlKey。锁只在这里加：回到
  // 底部的解锁由内核的滚动分类认（只有落到真实底部才算）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY >= 0) return;
      if (ownsVerticalScroll(e.target)) return;
      unpin();
    };

    // Touch: a finger moving DOWN drags the content UP (earlier history), the
    // same intent as a wheel with deltaY < 0 — latched at the input event for
    // the same reason, since touch scrolling ships no wheel events.
    let lastTouchY: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      if (
        lastTouchY !== null &&
        y > lastTouchY &&
        !ownsVerticalScroll(e.target)
      ) {
        unpin();
      }
      lastTouchY = y;
    };

    // Keyboard scroll keys, for the focus holders inside the list (the table
    // scroll wrapper is a roving stop).
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const up = e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home";
      if (!up || ownsVerticalScroll(e.target)) return;
      unpin();
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef, ownsVerticalScroll, unpin]);

  // 请求失败 / 回包为空时父组件把 loading 落回 false，那一页就到此为止，别把
  // pending 一直挂住——否则这段历史再也翻不动。
  useEffect(() => {
    if (!isLoadingEarlier) earlierPendingRef.current = false;
  }, [isLoadingEarlier]);

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
          {/* In-flow spacer carrying the virtualized total height. It must keep
              its space in the flex column (flex-shrink: 0). */}
          <div
            className="virtual-spacer"
            style={{ height: totalSize }}
            aria-hidden="true"
          />
          {rows.map((row) => {
            const message = visibleMessages[row.index];
            const runClass = timelineRuns.classes[row.index];
            return (
              <div
                key={row.key}
                data-index={row.index}
                data-virtual-key={row.key}
                data-measured-message-id={message.id}
                ref={measureRow}
                className={`virtual-row${runClass ? ` ${runClass}` : ""}`}
                style={{
                  top: row.start,
                  paddingBottom: timelineRuns.paddings[row.index],
                }}
              >
                <Message
                  key={message.id}
                  message={message}
                  vscode={vscode}
                  onRewindToMessage={onRewindToMessage}
                  onBackgroundCurrentTask={onBackgroundCurrentTask}
                  isLastMessage={row.index === visibleMessages.length - 1}
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
