import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { Message } from "./Message";
import { TranscriptOutline } from "./TranscriptOutline";
import {
  OUTLINE_QUESTION_LIMIT,
  type TranscriptOutlineItem,
} from "../utils/transcriptOutline";
import { EMPTY_TRANSCRIPT_FIND, TranscriptFindBar } from "./TranscriptFindBar";
import type { TranscriptFindState } from "./TranscriptFindBar";
import { streamingTail } from "../utils/streamingText";
import { countTimelineBlocks, rendersNothing } from "../utils/timelineBlocks";
import {
  buildFindRegex,
  clearFindMarks,
  countMessageHits,
  findRanges,
  FIND_HIT_CLASS,
  FIND_HIT_CURRENT_CLASS,
  wrapTextRange,
} from "../utils/transcriptFind";
import { estimateRowHeight } from "../virtual/estimateRowHeight";
import { useVirtualRows } from "../virtual/useVirtualRows";
import type { MessageListProps } from "../types";
import type { Message as MessageType } from "wave-agent-sdk/types";
import "../styles/MessageList.css";

// 行坐标的原点：行绝对定位在 `.messages-column` 的 padding box 上，spacer 在流里
// 从 content box 起算，两者的差就是这一列 10px 的 padding。内核对这个偏移一无所
// 知，由这里告诉它（与 CSS 里 `.messages-column { padding: 10px }` 同源）。
const COLUMN_PADDING_PX = 10;
/**
 * 正文列宽 = 列宽 − 左右内边距（`.messages-column` 的 10px ×2）− 行内正文自己的
 * 横向内边距（共 12px，实测：390px 视口 ⇒ 正文 358px；800px 列 ⇒ 768px）。估算
 * 折行必须按这个宽度算，见 `estimateRowHeight` 的说明。
 */
const TEXT_WIDTH_INSET_PX = 32;

// 滚到离顶这么近就要下一页更早的。留一点余量而不是严格的 0：触摸惯性把
// scrollTop 拉过顶时浏览器会直接 clamp 到 0，那一刻的位移是 0，判定必须能接受
// 「已经在顶部」这个状态本身。
const EARLIER_TRIGGER_PX = 160;

// 离内容末尾超过这么远就浮出「回到最新」入口。与参考物（Claude 桌面端的
// jump-to-latest）同档：比「已离开底部」的个位数阈值宽得多——这里问的是「远到
// 需要一个入口了吗」，不是「还要不要跟着新内容走」。
const JUMP_TO_BOTTOM_THRESHOLD_PX = 200;

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
// (i.e. that carry a timeline dot) so the group can decide whether it has a single
// lone dot (no connecting line) or multiple dots (draw the line). The predicate lives
// in utils/timelineBlocks — Message uses the same one to mark the first/last row.
function timelineDotCount(message: MessageType): number {
  return countTimelineBlocks(message.blocks ?? []);
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
    initialFind,
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
  // at the top of the list as a context hint (设计稿 2236-3792). `index` is the
  // same candidate the 大纲 uses to highlight its current tick — both read this
  // one value, so the sticky bar and the outline can never point at two
  // different rounds.
  const [stickyMessage, setStickyMessage] = useState<{
    id: string;
    text: string;
    index: number;
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
    index: number;
  } | null>(null);

  // Filter out user messages with isMeta (hidden from the list). Both the
  // sticky computation and the virtualizer index this filtered list.
  //
  // 渲染不出任何节点的消息也在这里滤掉（判据见 utils/timelineBlocks 的
  // rendersNothing）——这里是唯一的入口，一个 filter 同时解决三件事：
  // 不再有空的 `.message` 外壳、不再有占位/占底部间距的虚拟行、时间线 run 的
  // 起止规则自然落在真实消息上（空行既接不到 `--end` 也不会把线截断）。
  //
  // 流式刚开始那一刻就出现这种消息：codechat 网关上的 Claude 思考明文恒为空
  // （只回 signature），第一个 `thinking_delta` 是空串，SDK 于是在真内容到达前
  // 几百毫秒到几秒就先建出一条 `blocks: []` 的助手消息。它拿到真内容后自然
  // 回到列表里。
  const visibleMessages = useMemo(() => {
    const out: MessageType[] = [];
    for (const msg of messages) {
      if (msg.role === "user" && msg.isMeta) continue;
      if (rendersNothing(msg)) continue;
      out.push(msg);
    }
    return out;
  }, [messages]);

  const keys = useMemo(
    () => visibleMessages.map((message) => message.id),
    [visibleMessages],
  );

  /**
   * 正文列的实际宽度。估算必须按它折行——同一个「62 字/行」的常量在手机列上会
   * 把正文估矮一半，在桌面列上又估高一倍，两头都要在行第一次被量到时修正几百 px
   * （实测手机 358px 列：`est 830 → real 1135`）。列宽变了（窗口缩放、面板开合、
   * 横竖屏）估算也得跟着变，否则未挂载那批行会停在上一个列宽的高度上。
   */
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [textWidth, setTextWidth] = useState<number | undefined>(undefined);
  /**
   * 内容列宽度，只给大纲判断「窄到该不该整体隐藏」。与 `textWidth` 是两件事：
   * 那一个是正文折行宽度（量不到就留 undefined，估算用它自己的兜底），这一个
   * 必须**总有个数**——所以 `getBoundingClientRect` 之外用 `offsetWidth` 兜底
   * （jsdom 不做排版，rect 恒 0，tests/setup.ts 把 offsetWidth 固定成 800）。
   */
  const [columnWidth, setColumnWidth] = useState(0);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const measure = () => {
      const width =
        Math.round(column.getBoundingClientRect().width) || column.offsetWidth;
      setColumnWidth((prev) => (prev === width ? prev : width));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = Math.max(
        0,
        Math.round(column.getBoundingClientRect().width) - TEXT_WIDTH_INSET_PX,
      );
      setTextWidth((prev) => (prev === width ? prev : width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  const estimate = useCallback(
    (index: number) => estimateRowHeight(visibleMessages[index], { textWidth }),
    [visibleMessages, textWidth],
  );

  /** 行的定位容器，手势期的视觉补偿写在这上面（见 useVirtualRows）。 */
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // 虚拟化内核（自研，见 `src/virtual/`）。它自己管滚动分类、钉底状态、锚点补偿
  // 与阅读位置记录；这里只管「什么时候该钉/松手」和行内渲染。
  const list = useVirtualRows({
    keys,
    // 估算闭包依赖正文列宽：列宽一变它就是个新闭包，账本里那批「按旧列宽估算」的
    // 未挂载行跟着重算（见 `estimate` 选项的注释）。
    estimate,
    originOffsetPx: COLUMN_PADDING_PX,
    docKey,
    canvasRef,
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
    visualOffset,
    isPinned,
    pin,
    unpin,
  } = list;

  // Refs mirroring the current data for stable callbacks (event handlers and
  // the imperative handle must not capture a stale render).
  const visibleMessagesRef = useRef(visibleMessages);
  visibleMessagesRef.current = visibleMessages;

  /**
   * 滚动容器的可视高度，只给大纲算刻度间距与垂直居中位置。内核自己有视口
   * 高度（`viewportHeight` 在 useVirtualRows 里是个局部函数），但它不外露，
   * 而且这里要的是「React 能跟着变化重渲染」的那一份。
   */
  const [listViewportHeight, setListViewportHeight] = useState(0);
  /**
   * 内容列左边缘相对滚动容器的距离 —— 800px 列居中后左侧那片留白。大纲的刻度
   * 就住在这里（对齐 Codex：目录与消息列之间要有间距，不贴着气泡画）；留白不
   * 够时大纲整体不显示，见 `shouldShowOutline`。列宽封顶后列本身不再变宽，所以
   * 必须观察**容器**，只看列是测不出窗口变宽的。
   */
  const [columnInset, setColumnInset] = useState(0);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      // jsdom 里 clientHeight 恒 0，offsetHeight 由 tests/setup.ts 兜底。
      const height = container.clientHeight || container.offsetHeight;
      setListViewportHeight((prev) => (prev === height ? prev : height));
      const column = columnRef.current;
      // 容器不横向滚动（overflow-x: hidden），rect 之差就是列左侧的留白。
      const inset = column
        ? Math.round(
            column.getBoundingClientRect().left -
              container.getBoundingClientRect().left,
          )
        : 0;
      setColumnInset((prev) => (prev === inset ? prev : inset));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  // ---- 会话内查找（spec ui/transcript-find.md）------------------------------
  // 计数与跳转走消息数据、高亮画在渲染后的文本节点上，两层分开的理由见
  // `utils/transcriptFind.ts` 的文件头：虚拟列表只挂载可见行，只搜 DOM 会让
  // 「共几个命中」漏掉整段未挂载的历史。
  const [find, setFind] = useState<TranscriptFindState & { open: boolean }>({
    ...EMPTY_TRANSCRIPT_FIND,
    open: false,
  });

  const findRegex = useMemo(
    () =>
      buildFindRegex(find.query, {
        caseSensitive: find.caseSensitive,
        wholeWord: find.wholeWord,
        regex: find.regex,
      }),
    [find.query, find.caseSensitive, find.wholeWord, find.regex],
  );

  // 命中数按消息对象引用缓存：流式每来一个 chunk 都会换掉尾巴那条消息的对象，
  // 其余消息的引用不变，于是长会话每次只重算真正变了的那一条。
  const findHitCacheRef = useRef<{
    regex: RegExp | null;
    counts: WeakMap<MessageType, number>;
  }>({ regex: null, counts: new WeakMap() });

  const findHits = useMemo(() => {
    const regex = findRegex.regex;
    if (!find.open || !regex) return [];
    if (findHitCacheRef.current.regex !== regex) {
      findHitCacheRef.current = { regex, counts: new WeakMap() };
    }
    const counts = findHitCacheRef.current.counts;
    const hits: Array<{ messageId: string; indexInMessage: number }> = [];
    for (const message of visibleMessages) {
      let count = counts.get(message);
      if (count === undefined) {
        count = countMessageHits(message, regex);
        counts.set(message, count);
      }
      for (let i = 0; i < count; i++) {
        hits.push({ messageId: message.id, indexInMessage: i });
      }
    }
    return hits;
  }, [find.open, findRegex, visibleMessages]);

  const findTotal = findHits.length;
  // 1-based 的 `current` 永远夹在有效区间里：命中数会随流式增长/查询变化而变，
  // 越界不作夹取的话，计数会显示成「7/3」。
  const findCurrentIndex =
    findTotal === 0 ? -1 : Math.min(Math.max(find.current, 1), findTotal) - 1;
  const findCurrentHit =
    findCurrentIndex >= 0 ? findHits[findCurrentIndex] : undefined;

  // 已经滚到过哪一处。只有「查询 / 开关 / 当前序号」变了才允许再动视口——命中
  // 列表本身每来一个 chunk 都会重算，拿它当触发条件会在流式期间把读者按在原地。
  const findLocatedRef = useRef("");
  useEffect(() => {
    if (!find.open || !findCurrentHit) {
      findLocatedRef.current = "";
      return;
    }
    const key = [
      find.query,
      find.caseSensitive ? 1 : 0,
      find.wholeWord ? 1 : 0,
      find.regex ? 1 : 0,
      findCurrentIndex,
    ].join("\u0000");
    if (findLocatedRef.current === key) return;
    const index = visibleMessagesRef.current.findIndex(
      (m) => m.id === findCurrentHit.messageId,
    );
    // 找不到就**不记**这个 key：侧栏跳进来的种子可能在消息还没恢复时就先到了，
    // 记下来的话数据到齐后这次落位永远不会补做。
    if (index < 0) return;
    findLocatedRef.current = key;
    // 与点吸顶条同一条路：先松开钉底再落位，否则下一个流式 chunk 立刻把视口
    // 拽回底部，命中还没看清就被搬走。
    unpin();
    scrollToIndex(index, "center", "auto");
  }, [
    find.open,
    find.query,
    find.caseSensitive,
    find.wholeWord,
    find.regex,
    findCurrentIndex,
    findCurrentHit,
    scrollToIndex,
    unpin,
  ]);

  /**
   * Paint the marks over whatever rows are mounted right now.
   *
   * No dependency array on purpose: React rebuilds a row's nodes whenever its
   * markdown changes (every streaming chunk), which drops the marks painted on
   * the previous frame — the pass has to re-run after each commit or the
   * highlight flickers off. It is cheap only because it bails out unless the
   * bar is open, and a frame-throttled rAF keeps a burst of chunks to one pass.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handle = requestAnimationFrame(() => {
      clearFindMarks(container);
      const regex = findRegex.regex;
      if (!find.open || !regex) return;
      const current = findCurrentHit;
      container.querySelectorAll<HTMLElement>(".virtual-row").forEach((row) => {
        const text = row.textContent ?? "";
        if (!text) return;
        const isCurrentRow =
          !!current && row.dataset.measuredMessageId === current.messageId;
        findRanges(regex, text).forEach((range, i) => {
          const isCurrent = isCurrentRow && current?.indexInMessage === i;
          wrapTextRange(
            row,
            range.start,
            range.length,
            isCurrent
              ? `${FIND_HIT_CLASS} ${FIND_HIT_CURRENT_CLASS}`
              : FIND_HIT_CLASS,
          );
        });
      });
    });
    return () => cancelAnimationFrame(handle);
  });

  const closeFind = useCallback(() => {
    setFind({ ...EMPTY_TRANSCRIPT_FIND, open: false });
    // 关掉之后焦点回到正文（场景 5）：留在输入框里的话，下一次键盘滚动会被它吃掉。
    containerRef.current?.focus();
  }, [containerRef]);

  const stepFind = useCallback(
    (delta: number) => {
      const total = findHits.length;
      if (total === 0) return;
      setFind((prev) => {
        const base = Math.min(Math.max(prev.current || 1, 1), total);
        const next = ((((base - 1 + delta) % total) + total) % total) + 1;
        return { ...prev, current: next };
      });
    },
    [findHits],
  );

  // `Ctrl/Cmd+F` 打开（场景 1）。焦点可能在任何地方（输入框、消息行、工具行），
  // 所以监听挂在 window 上；文件/预览面板有自己的查找条（spec
  // desktop-file-panel.md），事件源落在那边时这条不接管，否则会同时开两个。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inAuxPanel =
        target instanceof Element &&
        !!target.closest(
          '[data-testid="preview-pane"], .file-pane-layout, .file-pane-find',
        );
      if (inAuxPanel) return;
      const accel = event.ctrlKey || event.metaKey;
      if (accel && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFind((prev) => ({ ...prev, open: true }));
        return;
      }
      if (event.key === "Escape") {
        setFind((prev) => {
          if (!prev.open) return prev;
          return { ...EMPTY_TRANSCRIPT_FIND, open: false };
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 换会话就关掉：新会话的命中与旧的关键词无关，留下的高亮还会指向已被卸载的行。
  useEffect(() => {
    setFind({ ...EMPTY_TRANSCRIPT_FIND, open: false });
  }, [docKey]);

  // 侧栏「内容命中」跳进来（spec desktop/desktop-sessions.md 场景 6）：把种子变成
  // 一次真正的查找。`nonce` 让连点同一处也能重新落位。消息还没到时 `findHits` 为空、
  // 落位那一步会因为找不到行直接返回且不记 key，等数据到齐后会自己补上。
  const initialFindNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialFind) return;
    if (initialFindNonceRef.current === initialFind.nonce) return;
    initialFindNonceRef.current = initialFind.nonce;
    setFind((prev) => ({
      ...prev,
      open: true,
      query: initialFind.query,
      current: initialFind.hitIndex + 1,
    }));
  }, [initialFind]);

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
        dots += timelineDotCount(m);
      } else {
        flushRun(i - 1);
        classes[i] = "";
        paddings[i] = 14;
      }
    });
    flushRun(visibleMessages.length - 1);
    return { classes, paddings };
  }, [visibleMessages]);

  /**
   * 大纲的刻度数据（spec ui/transcript-outline.md）：一条**带文本**的用户消息
   * = 一个刻度。判据复用 `stickyAnchorText`——「哪些消息能当锚点」只允许有这
   * 一份定义，否则吸顶条认它、大纲不认它这种分叉迟早会出现。
   *
   * 刻度只带问题、不带助手回答（spec 场景 5）：卡片里只放一条消息的文本，两段
   * 内容在这么小的一块地方只会显得重复。
   */
  const outlineItems = useMemo((): TranscriptOutlineItem[] => {
    const items: TranscriptOutlineItem[] = [];
    for (let index = 0; index < visibleMessages.length; index++) {
      const message = visibleMessages[index];
      if (message.role !== "user") continue;
      const question = stickyAnchorText(message);
      if (!question) continue;
      items.push({
        id: message.id,
        index,
        question: question.slice(0, OUTLINE_QUESTION_LIMIT),
      });
    }
    return items;
  }, [visibleMessages]);

  const computeSticky = useCallback(() => {
    const container = containerRef.current;
    // setSticky compares against stickyRef (synced from stickyMessage every
    // render) and skips the state update entirely when the computed value is
    // unchanged — see the stickyRef comment. This keeps the sticky computation
    // off React's nested-passive-update accounting on the streaming hot path.
    const setSticky = (
      next: { id: string; text: string; index: number } | null,
    ) => {
      const prev = stickyRef.current;
      const same =
        prev === null
          ? next === null
          : next !== null &&
            prev.id === next.id &&
            prev.text === next.text &&
            prev.index === next.index;
      if (!same) setStickyMessage(next);
    };
    if (!container) {
      setSticky(null);
      return;
    }
    // 手势期画布带着视觉偏移，屏幕上真正的视口顶是 `scrollTop - 偏移`；不折算的话
    // 上翻加载更早一页时粘性条会挑到屏幕外几行以外的那条消息。
    const scrollTop = container.scrollTop - visualOffset();
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
    setSticky({
      id: rows[candidate].id,
      text: candidateText,
      index: candidate,
    });
  }, [containerRef, indexAtOffset, rowStart, visualOffset]);

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

  /**
   * 「回到最新」入口的显示判据：视口底到内容末尾的距离。取 200px 与参考物
   * （Claude 桌面端的 jump-to-latest）同档——比「已离开底部」的个位数阈值宽得多，
   * 因为这里问的不是「要不要继续跟随」，而是「读者离末尾是不是已经远到需要一个
   * 入口」。离得近就收回，免得这颗按钮在正常阅读时一直晃。
   *
   * 判据只能读几何，不能读钉底状态：钉底在用户一上翻就松手，可内容还在继续长，
   * 「松手了」并不等于「离末尾很远」。
   */
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // `updateJumpToBottom` runs on every scroll event and every content change;
  // the ref keeps those calls from scheduling a render when nothing changed.
  const showJumpToBottomRef = useRef(false);

  const updateJumpToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // 手势期画布带着 `translateY`（见 `visualOffset`）：屏幕上内容底比
    // `scrollHeight - scrollTop` 读出来的低这一截，不补上的话手指刚往上拖一点
    // 就会因为「补偿量还没折算回 scrollTop」而误判成离末尾更近。
    const distance =
      container.scrollHeight -
      (container.scrollTop - visualOffset()) -
      container.clientHeight;
    const next = distance > JUMP_TO_BOTTOM_THRESHOLD_PX;
    if (next === showJumpToBottomRef.current) return;
    showJumpToBottomRef.current = next;
    setShowJumpToBottom(next);
  }, [containerRef, visualOffset]);

  const jumpToBottom = useCallback(() => {
    // 与「用户自己发消息」同一条路：先重新钉上再滚，否则滚到底之前到来的流式
    // chunk 会按旧的松手状态把视口留在原地，用户看到的是「点了一下没反应」。
    followToBottom("smooth", true);
  }, [followToBottom]);

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
    // 内容增长不会派发滚动事件（流式追加、压缩提示出现、行高从估算变实测），
    // 所以「回到最新」入口的显隐必须在这里也读一次几何——只挂 scroll 会让
    // 「读者停在远处、下面又长了一大段」这种情况一直不更新。
    updateJumpToBottom();
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
    updateJumpToBottom,
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

    // 显隐要读 scrollHeight / clientHeight（一次布局读）。滚动一帧可能派发多次
    // 事件，合并到下一帧只读一次，也别让读数落在这次事件的渲染中途。
    let jumpRaf = 0;
    const handleScroll = () => {
      maybeRequestEarlier();
      computeSticky();
      if (jumpRaf !== 0) return;
      jumpRaf = requestAnimationFrame(() => {
        jumpRaf = 0;
        updateJumpToBottom();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (jumpRaf !== 0) cancelAnimationFrame(jumpRaf);
    };
  }, [computeSticky, containerRef, updateJumpToBottom]);

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
      // 程序性焦点目标（关闭查找条后把焦点还给正文）：-1 不进入 Tab 序列，
      // 只是让 `focus()` 有落点。
      tabIndex={-1}
    >
      {/* The scroll surface is the whole pane; the capped, centered column
          lives in this inner wrapper (see MessageList.css). Rows resolve
          against it (position: relative), so its offset from the scroll
          surface must stay 0 — the 10px padding is inside it. */}
      {/* 左边缘的刻度大纲（spec ui/transcript-outline.md）。零高度、粘在滚动
          面上，住在内容列左侧的留白里；不是列的子元素（列 overflow-x: clip
          会把越出列的刻度裁掉）。 */}
      <TranscriptOutline
        items={outlineItems}
        activeId={stickyMessage?.id}
        columnWidth={columnWidth}
        columnInset={columnInset}
        viewportHeight={listViewportHeight}
        onJump={scrollToMessage}
      />
      <div className="messages-column" ref={columnRef}>
        {find.open && (
          <TranscriptFindBar
            find={{ ...find, current: findCurrentIndex + 1 }}
            total={findTotal}
            error={findRegex.error}
            onQueryChange={(query) =>
              setFind((prev) => ({ ...prev, query, current: 1 }))
            }
            onStep={stepFind}
            onToggle={(key) =>
              setFind((prev) => ({ ...prev, [key]: !prev[key], current: 1 }))
            }
            onClose={closeFind}
          />
        )}
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
          {/* 行的定位容器。绝对定位、铺满列的 padding box ⇒ 行坐标与直接挂在
              列上完全一致；手势期内核在这个节点上写 translateY 顶替 scrollTop
              补偿（见 useVirtualRows 的 commitVisualOffset）。它盖在粘性条之上，
              所以只让行自己收事件（.virtual-canvas / .virtual-row 的
              pointer-events）。 */}
          <div className="virtual-canvas" ref={canvasRef}>
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
          </div>
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
        {/* 「回到最新」入口（spec: 离开底部时的「回到最新」入口）。挂在内层正文
            列的末尾：这一层是 sticky 且零高度，所以它贴的是滚动的视口底而不是内
            容底，也不给任何一行加高度——出现/收回都不会让列表跳动一下。 */}
        <div
          className="jump-to-bottom-layer"
          data-visible={showJumpToBottom}
          data-testid="jump-to-bottom-layer"
        >
          <div className="jump-to-bottom-fade" aria-hidden="true" />
          <button
            type="button"
            className="jump-to-bottom-button"
            data-testid="jump-to-bottom"
            aria-label="回到最新"
            title="回到最新"
            // 收回时既不接点击也不占 Tab 序列，但节点留着做淡出（display: none
            // 会把过渡吃掉）。
            aria-hidden={!showJumpToBottom}
            tabIndex={showJumpToBottom ? 0 : -1}
            onClick={jumpToBottom}
          >
            <span className="codicon codicon-arrow-down" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
});
