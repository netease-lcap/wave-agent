/**
 * 自研虚拟列表内核（React 层）。几何在 `./geometry.ts`，这里只管四件事：
 *
 * 1. **量**：行挂载时读一次高度，之后由共用的 ResizeObserver 盯着（流式增长、
 *    折叠展开、宽度变化都走同一条路）；
 * 2. **锚**：任何一次高度账本变化之前记下「视口顶是哪一行的哪个位置」，变化之后
 *    把视口搬回同一个位置——行长高、上方插进一页更早的消息、窗口变窄导致全体重新
 *    测量，三种变化是同一件事故，同一个补偿；
 * 3. **钉**：到底就跟着长（`pinned`），用户一次真实的上滚就松手；只有「到底」和
 *    「用户自己发消息」两条路能重新钉上。滚动事件按 own / clamp / foreign 分类，
 *    只有 foreign 能改钉状态；
 * 4. **记**：离开会话时把「锚点 + 是否钉底」按会话 id 存下，切回来接着读（CC 的
 *    `scrollRestore`，LRU 32 份）。
 *
 * 与 tanstack 的三处口径差异（对着 CC 桌面端 `shared-4-CF5qF0Y3.js` 的 `gT` 抄）：
 * overscan 是像素预算、离末尾两屏内整段渲染、位置靠锚点而不是逐行补偿。逐条的
 * 理由见 `geometry.ts` 的文件头。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  anchorAt,
  buildRowMetrics,
  compensationFor,
  offsetForAnchor,
  rangeFor,
  rowAtOffset,
  EMPTY_RANGE,
  type Anchor,
  type RowMetrics,
  type RowRange,
} from "./geometry";

/** 上下各缓冲多少像素。CC 的会话列表就是 600/600（`c1c1ec7b9-fHtdZ7Yb.js` 的 `$9`）。 */
export const DEFAULT_OVERSCAN_PX = 600;
/** 首屏窗口：挂载后先只往下渲染 600px，两帧之后再放开正常缓冲。 */
export const DEFAULT_INITIAL_WINDOW_PX = 600;
/** 离末尾不足两屏就整段渲染到末尾（CC 的 `2 * viewport`，`shared-4:3074`）。 */
export const DEFAULT_NEAR_TAIL_SCREENS = 2;
/** 「到底」的容差。CC 用 2px（`c1c1ec7b9-fHtdZ7Yb.js` 的 pinned 判定）。 */
export const BOTTOM_THRESHOLD_PX = 2;
/** 我们自己那次滚动落点的认领窗口与容差（沿用既有实测值）。 */
const OWN_SCROLL_WINDOW_MS = 1500;
const OWN_SCROLL_TOLERANCE_PX = 2;
/** 记多少个会话的阅读位置（CC 的 `XD = 32`）。 */
const SAVED_DOC_LIMIT = 32;

/**
 * 视口高度。浏览器里 `clientHeight` 是准的（扣掉了横向滚动条），但它被 jsdom
 * 恒定为 0 —— 那里退回 `offsetHeight`，单元测试才能算出窗口。
 */
const viewportHeight = (element: HTMLElement): number =>
  element.clientHeight || element.offsetHeight;

interface SavedPosition {
  anchor: Anchor | undefined;
  pinned: boolean;
}

/** 模块级：切会话再切回来时用它接上，不落盘。 */
const savedPositions = new Map<string, SavedPosition>();

function savePosition(docKey: string, position: SavedPosition) {
  savedPositions.delete(docKey);
  savedPositions.set(docKey, position);
  if (savedPositions.size > SAVED_DOC_LIMIT) {
    const oldest = savedPositions.keys().next().value;
    if (oldest !== undefined) savedPositions.delete(oldest);
  }
}

export interface VirtualRow {
  index: number;
  key: string;
  /** 相对滚动容器内容顶的偏移（已含 `originOffsetPx`）。 */
  start: number;
}

export interface UseVirtualRowsOptions {
  /** 行 key（消息 id），与 `estimate` 的下标一一对应。 */
  keys: readonly string[];
  /** 未测量过时的估算高度。 */
  estimate: (index: number) => number;
  overscanTop?: number;
  overscanBottom?: number;
  nearTailScreens?: number;
  initialWindowBottomPx?: number;
  /**
   * 行坐标原点相对容器内容顶的偏移：行绝对定位在 `.messages-column` 的 padding
   * box 上，而 spacer 在流里从 content box 起算，两者差的就是列的 padding。
   */
  originOffsetPx?: number;
  /** 会话 id：切回来恢复阅读位置。 */
  docKey?: string;
}

export interface VirtualRows {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  rows: VirtualRow[];
  /** spacer 该写多高（行的总高 + 原点偏移 + 末尾留白）。 */
  totalSize: number;
  measureRow: (node: HTMLDivElement | null) => void;
  scrollToEnd: (behavior?: ScrollBehavior) => void;
  scrollToIndex: (
    index: number,
    align?: "start" | "center" | "end",
    behavior?: ScrollBehavior,
  ) => void;
  /** 容器滚动坐标 → 行号。用于「视口顶是哪条消息」这类判断。 */
  indexAtOffset: (offset: number) => number;
  /** 行的上沿在容器滚动坐标里的位置；越界返回 0。 */
  rowStart: (index: number) => number;
  isPinned: () => boolean;
  pin: () => void;
  unpin: () => void;
  /** 内容区之外还有东西（压缩提示）时，钉底要按真实 scrollHeight 落。 */
  pinToTrueBottom: () => void;
}

export function useVirtualRows(options: UseVirtualRowsOptions): VirtualRows {
  const {
    keys,
    estimate,
    overscanTop = DEFAULT_OVERSCAN_PX,
    overscanBottom = DEFAULT_OVERSCAN_PX,
    nearTailScreens = DEFAULT_NEAR_TAIL_SCREENS,
    initialWindowBottomPx = DEFAULT_INITIAL_WINDOW_PX,
    originOffsetPx = 0,
    docKey,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);

  // 估算函数每次渲染都是新闭包，放进 ref，免得它把账本重算和布局效应一起带飞。
  const estimateRef = useRef(estimate);
  estimateRef.current = estimate;

  /** 量到的行高，按 key 存。 */
  const sizesRef = useRef(new Map<string, number>());
  /** 触发账本重算的计数器：量出新高度时 +1。 */
  const [measureVersion, setMeasureVersion] = useState(0);

  const metrics = useMemo(
    () =>
      buildRowMetrics(
        keys,
        (key, index) => sizesRef.current.get(key) ?? estimateRef.current(index),
      ),
    // 估算函数走 ref（每次渲染都是新闭包），所以账本只在「换了一批行」或「量出新高
    // 度」时重算，不跟着渲染次数走。
    [keys, measureVersion],
  );

  // 首屏窗口：挂载后两帧内只按 initialWindowBottomPx 往下缓冲，之后放开。
  const [initialPhase, setInitialPhase] = useState(true);
  const initialPhaseRef = useRef(true);
  initialPhaseRef.current = initialPhase;

  const [range, setRange] = useState<RowRange>(EMPTY_RANGE);

  const metricsRef = useRef<RowMetrics>(metrics);
  const anchorRef = useRef<Anchor | undefined>(undefined);
  const savedRef = useRef<SavedPosition | undefined>(
    docKey === undefined ? undefined : savedPositions.get(docKey),
  );
  const restoredRef = useRef(false);
  const pinnedRef = useRef(savedRef.current ? savedRef.current.pinned : true);
  /** 上一次我们自己的滚动落点；用于认出「这个滚动事件是我们造成的」。 */
  const ownScrollRef = useRef<{ top: number; at: number } | undefined>(
    undefined,
  );
  /** 没能落地的补偿量（撞顶被夹负、钉底被夹正）。 */
  const creditRef = useRef(0);
  const prevScrollTopRef = useRef<number | undefined>(undefined);
  const prevScrollHeightRef = useRef(0);
  const prevClientHeightRef = useRef(0);
  /** 行节点，按 key 存：卸载时要按 key 取消观察。 */
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | undefined>(undefined);
  const rangeFrameRef = useRef<number | undefined>(undefined);

  const computeRange = useCallback((): RowRange => {
    const container = containerRef.current;
    if (!container) return EMPTY_RANGE;
    return rangeFor(metricsRef.current, container.scrollTop - originOffsetPx, {
      viewport: viewportHeight(container),
      overscanTop: initialPhaseRef.current ? 0 : overscanTop,
      overscanBottom: initialPhaseRef.current
        ? initialWindowBottomPx
        : overscanBottom,
      nearTailScreens,
    });
  }, [
    originOffsetPx,
    overscanTop,
    overscanBottom,
    initialWindowBottomPx,
    nearTailScreens,
  ]);

  const flushRange = useCallback(() => {
    rangeFrameRef.current = undefined;
    const next = computeRange();
    setRange((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, [computeRange]);

  const scheduleRange = useCallback(() => {
    if (rangeFrameRef.current !== undefined) return;
    rangeFrameRef.current = requestAnimationFrame(flushRange);
  }, [flushRange]);

  /**
   * 写 scrollTop。落点记进 `ownScrollRef`——'scroll' 事件在更晚的任务里派发，
   * 「这次事件是不是我造成的」只能靠「它是否正落在我瞄准的位置」回答（计数法会
   * 被「没有移动就没事件」透支）。撞到上下界时把差记进 credit，等下一次补偿还。
   */
  const writeScroll = useCallback(
    (top: number, behavior: ScrollBehavior = "auto") => {
      const container = containerRef.current;
      if (!container) return;
      const target = Math.max(0, top);
      ownScrollRef.current = { top: target, at: performance.now() };
      container.scrollTo({ top: target, behavior });
      // 撞到上下界的部分记成欠账：撞顶时后续的向下补偿先还这笔，钉底被夹住的
      // 那一截也不必再来一次（浏览器已经在下界了）。平滑滚动还没走完，读到的
      // scrollTop 是旧值，这时不记——它自己会落到底。
      if (behavior !== "smooth") {
        creditRef.current = target - container.scrollTop;
      }
    },
    [],
  );

  /**
   * 内容的真实底：`scrollHeight` 含 spacer 之外的东西（压缩提示），比行长总和准；
   * jsdom 里它恒为 0，退回「按账本算」。两者都取最大值，首帧没有布局时也安全。
   */
  const contentBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0;
    const viewport = viewportHeight(container);
    const fromMetrics = metricsRef.current.total + originOffsetPx;
    return Math.max(container.scrollHeight, fromMetrics) - viewport;
  }, [originOffsetPx]);

  const pinToTrueBottom = useCallback(() => {
    writeScroll(contentBottom(), "auto");
  }, [contentBottom, writeScroll]);

  const scrollToEnd = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      writeScroll(contentBottom(), behavior);
    },
    [contentBottom, writeScroll],
  );

  const scrollToIndex = useCallback(
    (
      index: number,
      align: "start" | "center" | "end" = "start",
      behavior: ScrollBehavior = "auto",
    ) => {
      const container = containerRef.current;
      if (!container) return;
      const current = metricsRef.current;
      if (index < 0 || index >= current.sizes.length) return;
      const start = current.offsets[index];
      const size = current.sizes[index];
      const viewport = viewportHeight(container);
      const slack =
        align === "center"
          ? (viewport - size) / 2
          : align === "end"
            ? viewport - size
            : 0;
      // 行在容器坐标里的上沿 = 原点 + 账本偏移（与渲染出来的 `top` 同一套坐标）。
      writeScroll(originOffsetPx + start - slack, behavior);
    },
    [originOffsetPx, writeScroll],
  );

  const indexAtOffset = useCallback(
    (offset: number) =>
      rowAtOffset(metricsRef.current, offset - originOffsetPx),
    [originOffsetPx],
  );

  const rowStart = useCallback(
    (index: number) =>
      originOffsetPx + (metricsRef.current.offsets[index] ?? 0),
    [originOffsetPx],
  );

  const pin = useCallback(() => {
    pinnedRef.current = true;
  }, []);
  const unpin = useCallback(() => {
    pinnedRef.current = false;
  }, []);
  const isPinned = useCallback(() => pinnedRef.current, []);

  // 账本变化之后：先按钉底或锚点把视口搬回去，再重算该渲染哪几行。
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previous = metricsRef.current;
    const next = metrics;
    const changed =
      previous !== next &&
      (previous.sizes.length !== next.sizes.length ||
        previous.total !== next.total ||
        previous.keys !== next.keys);
    metricsRef.current = next;
    if (!container) return;
    if (changed) {
      if (pinnedRef.current) {
        // 钉着就永远贴底：这一条同时覆盖「追加了新消息」「流式行长高」「估算变
        // 实测」三件事，不需要单独的窗口观察者不停重钉。
        scrollToEnd("auto");
      } else {
        const anchor = anchorRef.current;
        const delta = anchor ? compensationFor(previous, next, anchor) : 0;
        if (delta === undefined) {
          // 锚点行没了（rewind 截断、整表替换）：认不回原位，按末尾重新定位。
          // CC 也是这个退法，只多记一条 rec-lost。
          pinnedRef.current = true;
          scrollToEnd("auto");
        } else if (delta !== 0) {
          writeScroll(container.scrollTop + delta + creditRef.current, "auto");
        }
      }
    }
    prevScrollTopRef.current = container.scrollTop;
    prevScrollHeightRef.current = container.scrollHeight;
    prevClientHeightRef.current = viewportHeight(container);
    anchorRef.current = anchorAt(next, container.scrollTop - originOffsetPx);
    flushRange();
  }, [metrics, flushRange, scrollToEnd, writeScroll, originOffsetPx]);

  // 滚动：分类 own / clamp / foreign，只有 foreign 改钉状态。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const now = performance.now();
      const stamp = ownScrollRef.current;
      let own = false;
      if (stamp) {
        if (now - stamp.at > OWN_SCROLL_WINDOW_MS)
          ownScrollRef.current = undefined;
        else
          own =
            Math.abs(container.scrollTop - stamp.top) <=
            OWN_SCROLL_TOLERANCE_PX;
      }
      // 内容变矮 / 容器变高时浏览器会把 scrollTop 夹下来：那是夹取，不是用户意图。
      const clamped =
        container.scrollHeight < prevScrollHeightRef.current ||
        viewportHeight(container) > prevClientHeightRef.current;
      if (!own && !clamped) {
        const atBottom =
          container.scrollTop + viewportHeight(container) >=
          container.scrollHeight - BOTTOM_THRESHOLD_PX;
        if (atBottom) {
          pinnedRef.current = true;
        } else if (
          prevScrollTopRef.current !== undefined &&
          container.scrollTop < prevScrollTopRef.current
        ) {
          pinnedRef.current = false;
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = viewportHeight(container);
      anchorRef.current = anchorAt(
        metricsRef.current,
        container.scrollTop - originOffsetPx,
      );
      scheduleRange();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [originOffsetPx, scheduleRange]);

  // 容器尺寸变化（窗口缩放、面板开合）：重算窗口，并把光标位置重新记下来——
  // 行宽变了会全体重新测量，那批补偿依赖锚点，锚点不能是过期的。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = viewportHeight(container);
      anchorRef.current = anchorAt(
        metricsRef.current,
        container.scrollTop - originOffsetPx,
      );
      flushRange();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [originOffsetPx, flushRange]);

  // 首屏窗口两帧后放开。
  useEffect(() => {
    if (!initialPhase) return;
    let frame = 0;
    let handle = requestAnimationFrame(function tick() {
      frame += 1;
      if (frame >= 2) setInitialPhase(false);
      else handle = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(handle);
  }, [initialPhase]);

  // 首次有行之后恢复阅读位置（只有「离开时没钉底」才恢复；钉底本来就要落到底）。
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    if (keys.length === 0) return;
    restoredRef.current = true;
    const saved = savedRef.current;
    if (!saved || saved.pinned) return;
    const offset = saved.anchor
      ? offsetForAnchor(metrics, saved.anchor)
      : undefined;
    if (offset === undefined) {
      // 锚点那一行不在切回后的首屏一页里：按首屏默认位置（钉底）呈现，不为恢复
      // 位置去重读更早的页。留在 scrollTop 0 会更糟——那是这一页的顶，下面还有
      // 一屏多没读过的内容，用户既没回到原处也没跟上新消息。
      pinnedRef.current = true;
      scrollToEnd("auto");
      return;
    }
    pinnedRef.current = false;
    writeScroll(offset + originOffsetPx, "auto");
  }, [keys.length, metrics, originOffsetPx, scrollToEnd, writeScroll]);

  // 离开会话时记下位置。
  useEffect(() => {
    if (docKey === undefined) return;
    return () => {
      savePosition(docKey, {
        anchor: anchorRef.current,
        pinned: pinnedRef.current,
      });
    };
  }, [docKey]);

  const applyHeight = useCallback((key: string, height: number) => {
    if (!(height > 0)) return;
    const previous = sizesRef.current.get(key);
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return;
    sizesRef.current.set(key, height);
    setMeasureVersion((version) => version + 1);
  }, []);

  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const key = node.dataset.virtualKey;
      if (!key) return;
      nodesRef.current.set(key, node);
      if (!observerRef.current) {
        observerRef.current = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const element = entry.target as HTMLElement;
            const entryKey = element.dataset.virtualKey;
            if (!entryKey) continue;
            applyHeight(
              entryKey,
              Math.round(
                entry.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight,
              ),
            );
          }
        });
      }
      observerRef.current.observe(node);
      applyHeight(key, Math.round(node.offsetHeight));
    },
    [applyHeight],
  );

  // 卸载的行要停止观察，否则被 RO 攥着不放。
  useLayoutEffect(() => {
    const live = new Set<string>();
    for (let i = range.start; i <= range.end; i++) {
      const key = keys[i];
      if (key !== undefined) live.add(key);
    }
    for (const [key, node] of nodesRef.current) {
      if (live.has(key)) continue;
      observerRef.current?.unobserve(node);
      nodesRef.current.delete(key);
    }
  }, [range, keys]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = undefined;
      if (rangeFrameRef.current !== undefined) {
        cancelAnimationFrame(rangeFrameRef.current);
        rangeFrameRef.current = undefined;
      }
    },
    [],
  );

  const rows = useMemo((): VirtualRow[] => {
    if (range.start < 0) return [];
    const out: VirtualRow[] = [];
    for (let index = range.start; index <= range.end; index++) {
      const key = keys[index];
      if (key === undefined) continue;
      out.push({
        index,
        key,
        start: originOffsetPx + metrics.offsets[index],
      });
    }
    return out;
  }, [range, keys, metrics, originOffsetPx]);

  return {
    containerRef,
    rows,
    totalSize: metrics.total + originOffsetPx,
    measureRow,
    scrollToEnd,
    scrollToIndex,
    indexAtOffset,
    rowStart,
    isPinned,
    pin,
    unpin,
    pinToTrueBottom,
  };
}
