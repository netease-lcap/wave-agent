/**
 * 自研虚拟列表内核（React 层）。几何在 `./geometry.ts`，这里只管三件事：
 *
 * 1. **量**：行挂载时读一次高度，之后由共用的 ResizeObserver 盯着（流式增长、
 *    折叠展开、宽度变化都走同一条路）；
 * 2. **锚**：任何一次高度账本变化之前记下「视口顶是哪一行的哪个位置」，变化之后
 *    把视口搬回同一个位置——行长高、上方插进一页更早的消息、窗口变窄导致全体重新
 *    测量，三种变化是同一件事故，同一个补偿；
 * 3. **钉**：到底就跟着长（`pinned`），用户一次真实的上滚就松手；只有「到底」和
 *    「用户自己发消息」两条路能重新钉上。滚动事件按 own / clamp / foreign 分类，
 *    只有 foreign 能改钉状态。
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
/**
 * 判「方向反转」的最小位移。CC 用 2px（`shared-4-CF5qF0Y3.js` 的 `r > 2 / r < -2`），
 * 太小的抖动不算换向——那只是同一段惯性里的噪声。
 */
const DIRECTION_EPSILON_PX = 2;
/**
 * 手势停下多久算「停稳了」，可以把视觉偏移折算回 `scrollTop`。惯性滚动期间浏览器
 * 一直在派发 `scroll` 事件，所以判据是「最近一次 scroll 距今多久」而不是「手指抬起
 * 多久」——手指抬起之后还有一段几百毫秒的惯性。
 */
const GESTURE_SETTLE_MS = 140;
/**
 * 手指最后一次有动静之后过了这么久就当手势结束了。不能只靠 `touchend`：touch 事件
 * 派给按下那一刻的目标，那个目标在滚动中被回收（行卸载）时 `touchend` 根本不冒泡到
 * 容器，只等它会把视觉偏移永久挂住。实测（`e2e/virtual-scroll-drift.e2e.ts` 的手势
 * 用例）：手指按着的期间上层插入一页更早的消息，`touchend` 一次都没到。
 */
const TOUCH_STALE_MS = 400;

/**
 * 视口高度。`clientHeight` 扣掉了横向滚动条，是准的；但它会是 0（首帧、
 * 容器处于隐藏态），那里退回 `offsetHeight`。
 */
const viewportHeight = (element: HTMLElement): number =>
  element.clientHeight || element.offsetHeight;

export interface VirtualRow {
  index: number;
  key: string;
  /** 相对滚动容器内容顶的偏移（已含 `originOffsetPx`）。 */
  start: number;
}

export interface UseVirtualRowsOptions {
  /** 行 key（消息 id），与 `estimate` 的下标一一对应。 */
  keys: readonly string[];
  /**
   * 未测量过时的估算高度。**必须由调用方 memo**（`useCallback`/`useMemo`）：它的
   * 标识就是账本的失效钥匙之一——估算依赖的量（正文列宽）变了，调用方会给出一个
   * 新闭包，账本随之重算未挂载行；若每次渲染都给新闭包，账本会整表重算。
   */
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
  /**
   * 行所在的定位容器（`.virtual-canvas`，`position: absolute; inset: 0` 铺满列的
   * padding box，行坐标因此与直接挂在列上完全一致）。给出它，手势期就能把补偿量
   * 写成 `translateY` 而不是 `scrollTop` —— 触控设备上在手势中途写 `scrollTop`
   * 会打断惯性、且读回值是陈旧的，用户看到的就是「滑着滑着定位突变」。
   */
  canvasRef?: React.MutableRefObject<HTMLDivElement | null>;
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
  /**
   * 挂起在手势期的视觉偏移（px，正 = 内容下移）。屏幕上真正的视口顶是
   * `scrollTop - visualOffset()`，拿 `scrollTop` 直接比会差这一截。
   */
  visualOffset: () => number;
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
    canvasRef,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);

  /**
   * 量到的行高。`sizesRef` 供同步读（`applyHeight` 自己判重、本次 commit 后续的
   * 布局效应），`sizes` 是同一份 map 的不可变快照，专门给账本当依赖——写 ref 不
   * 触发渲染，账本要靠 state 才知道「有行量出了新高度」。写的时候先换 ref 再
   * setState，两者指向同一个 map。
   */
  const sizesRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(
    sizesRef.current,
  );

  /**
   * 账本，外加「哪些行是实测高度」。两者必须是**同一份快照**：行在挂载的 ref 回调
   * 里就已经被量到了，`sizesRef` 会抢先一步有值，而账本要到下一次渲染才跟上 ——
   * 拿 `sizesRef` 判「这行量过没有」，会把一行还没进账本的实测当成已量过，锚点
   * 就不肯让开（`anchorAt` 的注释解释了让开为什么是必须的）。
   *
   * 重算的三个触发点都在函数体里读得到：`keys`（换了一批行）、`sizes`（量出新
   * 高度）、`estimate`（估算所依赖的列宽变了，调用方会换一个新闭包）。
   */
  const { metrics, measured } = useMemo(() => {
    const measuredKeys = new Set<string>();
    const next = buildRowMetrics(keys, (key, index) => {
      const size = sizes.get(key);
      if (size === undefined) return estimate(index);
      measuredKeys.add(key);
      return size;
    });
    return { metrics: next, measured: measuredKeys };
  }, [keys, sizes, estimate]);

  // 首屏窗口：挂载后两帧内只按 initialWindowBottomPx 往下缓冲，之后放开。
  const [initialPhase, setInitialPhase] = useState(true);
  const initialPhaseRef = useRef(true);
  initialPhaseRef.current = initialPhase;

  const [range, setRange] = useState<RowRange>(EMPTY_RANGE);

  const metricsRef = useRef<RowMetrics>(metrics);
  /** 与 `metricsRef` 成对的「量过的行」快照，随账本一起在布局效应里换。 */
  const measuredRef = useRef<Set<string>>(measured);
  const anchorRef = useRef<Anchor | undefined>(undefined);
  /** 挂载即钉底：任何一次挂载都是「打开这条列表」，落点一律是真实底部。 */
  const pinnedRef = useRef(true);
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
  /**
   * 手势期累积的视觉偏移（px，正 = 内容整体下移），落在 `canvasRef` 的
   * `translateY` 上。0 表示没有挂起的偏移（此时 `style.transform` 是空的）。
   */
  const visualOffsetRef = useRef(0);
  /** 手指是否按在容器上。 */
  const touchingRef = useRef(false);
  /** 手势还没停稳（手指抬起但惯性还在，或偏移还没折算回 scrollTop）。 */
  const touchPendingRef = useRef(false);
  /** 最近一次 `scroll` 事件的时间，含惯性段。 */
  const lastScrollAtRef = useRef(0);
  /** 最近一次 touch 事件的时间（start / move / end 都算）。 */
  const lastTouchAtRef = useRef(0);
  const settleTimerRef = useRef<number | undefined>(undefined);
  /** 最近一次有效滚动的方向（1 = 往下，-1 = 往上，0 = 还没定向）。 */
  const scrollDirRef = useRef(0);

  const computeRange = useCallback((): RowRange => {
    const container = containerRef.current;
    if (!container) return EMPTY_RANGE;
    // 画布带着视觉偏移时，屏幕上看到的内容区间是 `scrollTop - 偏移`。
    return rangeFor(
      metricsRef.current,
      container.scrollTop - visualOffsetRef.current - originOffsetPx,
      {
        viewport: viewportHeight(container),
        overscanTop: initialPhaseRef.current ? 0 : overscanTop,
        overscanBottom: initialPhaseRef.current
          ? initialWindowBottomPx
          : overscanBottom,
        nearTailScreens,
      },
    );
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
   * 挂上 / 摘掉画布上的视觉偏移。只改 `transform`：行本身是绝对定位的，画布只是
   * 整体平移，既不触发布局也不碰 `scrollTop`。
   */
  const applyVisualOffset = useCallback(
    (next: number) => {
      const rounded = Math.abs(next) < 0.5 ? 0 : next;
      if (rounded === visualOffsetRef.current) return;
      visualOffsetRef.current = rounded;
      const canvas = canvasRef?.current;
      if (!canvas) return;
      canvas.style.transform = rounded === 0 ? "" : `translateY(${rounded}px)`;
    },
    [canvasRef],
  );

  /**
   * 把挂起的视觉偏移折算回 `scrollTop`：向下滚 `-偏移` 再摘掉 `transform`，两步在
   * 同一个任务里做完，中间态不会被绘制，所以视觉上没有跳变。
   *
   * 落点被上下界夹住时（贴底/贴顶），这一截再也兑现不了：**不能**留在 `transform`
   * 上继续抵消——画布整体被顶开，边界处就凭空多出一片空白（真机症状：往上翻过再甩
   * 到底，底部一大块空的），而且下一次折算还是同样被夹，永远还不清。边界上没有需要
   * 锚住的东西（「内容的头/尾」本身就是该显示的位置），所以这一截直接丢掉。
   */
  const commitVisualOffset = useCallback(() => {
    if (settleTimerRef.current !== undefined) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
    }
    const offset = visualOffsetRef.current;
    if (offset === 0) return;
    const container = containerRef.current;
    if (!container) {
      applyVisualOffset(0);
      return;
    }
    const before = container.scrollTop;
    const target = Math.max(0, before - offset);
    ownScrollRef.current = { top: target, at: performance.now() };
    container.scrollTo({ top: target, behavior: "auto" });
    // 没被夹住时 `scrollTop` 正好落在 target 上，残余为 0；非 0 就说明撞界了。
    applyVisualOffset(0);
  }, [applyVisualOffset]);

  /**
   * 手势停稳之后再折算。手指抬起并不代表停下来——惯性段浏览器还在派发 `scroll`，
   * 所以判据是「最近一次 scroll 距今多久」，不够就再等一轮。手指一直有动静（或者
   * 一直按着但没到 TOUCH_STALE_MS）时也不算结束。
   */
  const scheduleSettle = useCallback(() => {
    if (settleTimerRef.current !== undefined) {
      window.clearTimeout(settleTimerRef.current);
    }
    const attempt = () => {
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = undefined;
        const now = performance.now();
        if (
          touchingRef.current &&
          now - lastTouchAtRef.current < TOUCH_STALE_MS
        ) {
          attempt();
          return;
        }
        if (now - lastScrollAtRef.current < GESTURE_SETTLE_MS) {
          attempt();
          return;
        }
        touchingRef.current = false;
        touchPendingRef.current = false;
        commitVisualOffset();
      }, GESTURE_SETTLE_MS);
    };
    attempt();
  }, [commitVisualOffset]);

  /**
   * 写 scrollTop。落点记进 `ownScrollRef`——'scroll' 事件在更晚的任务里派发，
   * 「这次事件是不是我造成的」只能靠「它是否正落在我瞄准的位置」回答（计数法会
   * 被「没有移动就没事件」透支）。撞到上下界时把差记进 credit，等下一次补偿还。
   */
  const writeScroll = useCallback(
    (top: number, behavior: ScrollBehavior = "auto") => {
      const container = containerRef.current;
      if (!container) return;
      // 传进来的是绝对落点，先把挂起的视觉偏移折算掉，否则会按折算前的 scrollTop
      // 定位，差出整个偏移量。
      commitVisualOffset();
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
    [commitVisualOffset],
  );

  /**
   * 内容的真实底：`scrollHeight` 含 spacer 之外的东西（压缩提示），比行长总和准；
   * 容器被隐藏时它会是 0，退回「按账本算」。两者都取最大值，首帧没有布局时也安全。
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
  const visualOffset = useCallback(() => visualOffsetRef.current, []);

  /**
   * 记下「视口顶是哪一行的哪个位置」。三个调用点（账本变化后、滚动、容器尺寸变化）
   * 用同一套判断：视口顶那一行还没量过时，锚点让给视口里第一行量过的行，见
   * `anchorAt` 的注释。
   */
  const captureAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measuredKeys = measuredRef.current;
    // 手势期画布带着 `translateY`，屏幕上真正的视口顶是 `scrollTop - 偏移`；不按
    // 这个算，锚点会落到屏幕外几千像素之外，视口里那几行的修正就没人管了（实测
    // 一次上翻 142px 的位移就是这么漏的）。
    return anchorAt(
      metricsRef.current,
      container.scrollTop - visualOffsetRef.current - originOffsetPx,
      {
        isMeasured: (key) => measuredKeys.has(key),
        viewport: viewportHeight(container),
      },
    );
  }, [originOffsetPx]);

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
    measuredRef.current = measured;
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
          if (
            canvasRef !== undefined &&
            (touchingRef.current || touchPendingRef.current)
          ) {
            // 手势期不写 scrollTop：触控设备上中途改它既打断惯性、读回的
            // scrollTop 又是陈旧值，用户看到的是「滑着滑着定位突变」。把这一截
            // 抬到画布的视觉偏移上，手势（含惯性尾巴）停稳后再折算回去。
            applyVisualOffset(visualOffsetRef.current - delta);
          } else {
            writeScroll(
              container.scrollTop + delta + creditRef.current,
              "auto",
            );
          }
        }
      }
    }
    prevScrollTopRef.current = container.scrollTop;
    prevScrollHeightRef.current = container.scrollHeight;
    prevClientHeightRef.current = viewportHeight(container);
    anchorRef.current = captureAnchor();
    flushRange();
  }, [
    metrics,
    measured,
    flushRange,
    scrollToEnd,
    writeScroll,
    captureAnchor,
    applyVisualOffset,
    canvasRef,
    originOffsetPx,
  ]);

  // 滚动：分类 own / clamp / foreign，只有 foreign 改钉状态。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const now = performance.now();
      lastScrollAtRef.current = now;
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
      const prevTop = prevScrollTopRef.current;
      const delta = prevTop === undefined ? 0 : container.scrollTop - prevTop;
      const atBottom =
        container.scrollTop + viewportHeight(container) >=
        container.scrollHeight - BOTTOM_THRESHOLD_PX;
      // 挂着的偏移什么时候必须当场折算？两个时机都是几何问题，**不看 own/clamped
      // 分类**——自己写出来的滚动一样会把内容推到边界，被当成「夹取」的那一帧也
      // 可能正好到界。claude.ai 的 `scroll` 判据同款（到顶 / 到底 / 方向反转）。
      //
      // ① 撞到边界：这一截再也兑不回来，留着就是把画布顶开、边界处凭空一片空白。
      // ② 方向反转：上翻攒下的偏移如果拖到「掉头往下甩」之后还不折算，它会随着
      //    接近底部变成越来越大的空白（真机实测：偏移 705px、离底 368px 时空白
      //    358px），一直挂到撞底才消失。
      if (visualOffsetRef.current !== 0) {
        const reversed =
          scrollDirRef.current !== 0 &&
          Math.abs(delta) > DIRECTION_EPSILON_PX &&
          Math.sign(delta) !== scrollDirRef.current;
        if (atBottom || container.scrollTop <= 1 || reversed) {
          commitVisualOffset();
        }
      }
      if (Math.abs(delta) > DIRECTION_EPSILON_PX) {
        scrollDirRef.current = Math.sign(delta);
      }
      if (!own && !clamped) {
        if (atBottom) {
          pinnedRef.current = true;
        } else if (prevTop !== undefined && container.scrollTop < prevTop) {
          pinnedRef.current = false;
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = viewportHeight(container);
      anchorRef.current = captureAnchor();
      scheduleRange();
      // 惯性段还在滚：每来一个 scroll 就重新计时，等它真停下来再折算偏移。
      if (touchPendingRef.current) scheduleSettle();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [scheduleRange, captureAnchor, scheduleSettle, commitVisualOffset]);

  // 手势跟踪：只有触控来的位移走 transform。鼠标滚轮 / 程序化滚动没有 touch 事件，
  // 仍旧直接写 scrollTop（桌面端实测本来就 0 跳变，不必多一层）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canvasRef) return;
    const begin = () => {
      touchingRef.current = true;
      touchPendingRef.current = true;
      lastTouchAtRef.current = performance.now();
      scheduleSettle();
    };
    const end = () => {
      touchingRef.current = false;
      // 手指抬起之后还有一段惯性，从这一刻起计时，由 scroll 事件不断推后。
      lastTouchAtRef.current = performance.now();
      lastScrollAtRef.current = performance.now();
      scheduleSettle();
    };
    container.addEventListener("touchstart", begin, { passive: true });
    container.addEventListener("touchmove", begin, { passive: true });
    container.addEventListener("touchend", end, { passive: true });
    container.addEventListener("touchcancel", end, { passive: true });
    return () => {
      container.removeEventListener("touchstart", begin);
      container.removeEventListener("touchmove", begin);
      container.removeEventListener("touchend", end);
      container.removeEventListener("touchcancel", end);
    };
  }, [scheduleSettle, canvasRef]);

  // 容器尺寸变化（窗口缩放、面板开合）：重算窗口，并把光标位置重新记下来——
  // 行宽变了会全体重新测量，那批补偿依赖锚点，锚点不能是过期的。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = viewportHeight(container);
      anchorRef.current = captureAnchor();
      flushRange();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [flushRange, captureAnchor]);

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

  const applyHeight = useCallback((key: string, height: number) => {
    if (!(height > 0)) return;
    const previous = sizesRef.current.get(key);
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return;
    const next = new Map(sizesRef.current).set(key, height);
    // ref 先换（同步读用它），state 再换（账本用它重算）。
    sizesRef.current = next;
    setSizes(next);
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
      // 观测 **border box**，而且必须写在 observe() 的参数里 —— 这是行高账本
      // 正确性的前提，不是优化：
      //
      // 行的盒高有一部分来自 padding-bottom（时间线连线的行间距就是它，见
      // MessageList 的 timelineRuns：一段连续助手消息内部 0、段末 14px）。默认
      // 观测的是 content box，`height: auto` 的行只改 padding 时 content box 一寸
      // 没动 —— RO 一次都不回调，账本永远留着旧值，下一行就按旧高定位：两行之
      // 间空出 14px，时间线竖线在那里断开（切会话再切回来之所以能好，是因为行
      // 重新挂载、重新量了一次）。追这条时实测：`new ResizeObserver(cb, { box })`
      // **构造参数里的 box 被 Chromium 忽略**（只有初次回调，改 padding 后不回调），
      // 而 `observe(node, { box })` 的按调用参数才生效。
      observerRef.current.observe(node, { box: "border-box" });
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
      if (settleTimerRef.current !== undefined) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = undefined;
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
    visualOffset,
    isPinned,
    pin,
    unpin,
    pinToTrueBottom,
  };
}
