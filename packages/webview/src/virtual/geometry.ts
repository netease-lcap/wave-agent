/**
 * 虚拟滚动的纯几何：从「每行多高」推到「该渲染哪几行、该停在哪个偏移」。
 *
 * 对着 Claude Code 桌面端的内核口径抄的（`~/github/claude-ai` 的 build
 * `0a9973a010`，core 在 `shared-4-CF5qF0Y3.js` 的 `gT`）。三条语义差别值得先说，
 * 因为它们决定了这套 API 的形状：
 *
 * 1. **overscan 是像素预算，不是行数。** tanstack 的 `overscan: 20` 是「上下各多
 *    渲染 20 行」，一行 40px 时那只有 800px、一行 300px 时就是 6000px，缓冲区随
 *    行高漂移；CC 按像素走（chat 列表上下各 600px，见 `c1c1ec7b9-fHtdZ7Yb.js` 的
 *    `$9`），累加到预算为止（`shared-4:3073`）。会话列表的行高从一行 40px 的任务
 *    通知到一屏高的 diff，只有像素预算能给出稳定的缓冲。
 * 2. **离末尾不足两屏就整段渲染到末尾**（`shared-4:3074`）。末尾是流式增长的那
 *    一头，多渲染几行换掉「每帧都在改末尾行位置」的抖动，比省这几行划算。
 * 3. **位置靠锚点（行 + 行内偏移）维持，不靠逐行补偿。** 行变高变矮、上面插进一
 *    页更早的消息、容器宽度变化导致全体重新测量——三种变化在锚点账本里是同一件
 *    事：锚点行搬了多远，视口就跟着搬多远。
 */
export interface RowMetrics {
  /** 行 key，与宿主的消息 id 一一对应。 */
  keys: readonly string[];
  /** `offsets[i]` 是第 i 行的起始偏移，`offsets[n]` 是总高。长度 = n + 1。 */
  offsets: number[];
  sizes: number[];
  total: number;
}

/** 锚点：视口顶那一行，以及顶边落在这一行的哪个位置。 */
export interface Anchor {
  key: string;
  /** 视口顶边在这行里偏移了多少 px。 */
  offsetInItem: number;
  /**
   * 紧挨在锚点行**之后**那一行的 key，以及它记账那一刻的起点（绝对偏移）。锚点行
   * 自己换了身份时靠它认回原位 —— 抄的是 CC 的 `nextKey` / `nextStart`
   * （`shared-4-CF5qF0Y3.js:2927` 记、`:2910` 用）。末行没有下一行，两个字段都缺。
   */
  nextKey?: string;
  nextStart?: number;
}

export interface RangeOptions {
  /** 视口高度（px）。 */
  viewport: number;
  /** 向上多渲染多少 px。 */
  overscanTop: number;
  /** 向下多渲染多少 px。 */
  overscanBottom: number;
  /**
   * 距末尾不足这么多屏就整段渲染到末尾（CC 用 2）。传 0 关掉。
   */
  nearTailScreens?: number;
}

/** 闭区间行号；空列表返回 `{ start: -1, end: -1 }`。 */
export interface RowRange {
  start: number;
  end: number;
}

export const EMPTY_RANGE: RowRange = { start: -1, end: -1 };

export function buildRowMetrics(
  keys: readonly string[],
  sizeOf: (key: string, index: number) => number,
): RowMetrics {
  const count = keys.length;
  const offsets = new Array<number>(count + 1);
  const sizes = new Array<number>(count);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) {
    const size = Math.max(0, sizeOf(keys[i], i));
    sizes[i] = size;
    offsets[i + 1] = offsets[i] + size;
  }
  return { keys, offsets, sizes, total: offsets[count] };
}

/**
 * 偏移落在哪一行。二分，`offset < 0` 取第 0 行，超出末尾取最后一行（浏览器
 * 会把 scrollTop 夹回可滚范围，读取时晚于夹取的调用方不该拿到越界行号）。
 */
export function rowAtOffset(metrics: RowMetrics, offset: number): number {
  const count = metrics.sizes.length;
  if (count === 0) return -1;
  if (offset <= 0) return 0;
  const { offsets } = metrics;
  if (offset >= metrics.total) return count - 1;
  // 找最后一个满足 offsets[i] <= offset 的 i。
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * 该渲染哪几行。上界算到「视口底边 - 1px」所在行（滚到某一行的接缝上时，底边
 * 正好落在下一行的起点，那一行还没露出来，不该算进来）。
 */
export function rangeFor(
  metrics: RowMetrics,
  scrollTop: number,
  options: RangeOptions,
): RowRange {
  const count = metrics.sizes.length;
  if (count === 0) return EMPTY_RANGE;
  const { offsets, sizes, total } = metrics;
  const viewport = Math.max(0, options.viewport);
  const top = Math.max(0, Math.min(scrollTop, Math.max(0, total - viewport)));

  let start = rowAtOffset(metrics, top);
  let end = rowAtOffset(metrics, Math.max(top, top + viewport - 1));

  let budget = 0;
  while (start > 0 && budget < options.overscanTop) {
    start -= 1;
    budget += sizes[start];
  }
  budget = 0;
  while (end < count - 1 && budget < options.overscanBottom) {
    end += 1;
    budget += sizes[end];
  }

  const nearTail = (options.nearTailScreens ?? 0) * viewport;
  if (nearTail > 0) {
    if (total - offsets[end + 1] <= nearTail) end = count - 1;
    if (offsets[start] <= nearTail) start = 0;
  }

  return { start, end };
}

export interface AnchorOptions {
  /** 这一行有没有实测高度。缺省当成「都有」。 */
  isMeasured?: (key: string) => boolean;
  /**
   * 视口高度：另找一个「量过的行」当锚点时，只在这个范围内找。缺省不设限。
   */
  viewport?: number;
}

/**
 * 视口顶的锚点；空列表返回 undefined。
 *
 * 锚点默认是「视口顶落在哪一行、落在这行的第几 px」。**但这一行还没量过时，行内
 * 偏移指不进内容**：它的高度此刻只是估算，等真被量出来（差几百 px 是常态），行内
 * 那一段会整块平移，而补偿只算锚点**上方**那些行（锚点自己的变化按定义不算），差
 * 额原样留在屏幕上。上滑翻页每次都踩这个坑——新一页插在顶部之后，视口顶刚好落在
 * 新一页最后一行的身上，而那一行必然还没量过，于是用户正在读的那一行被它的估算
 * 误差顶走（实测：早一页尾巴是 120 行代码块 ⇒ 位移 1046px）。
 *
 * 所以这一行没量过时，锚点退到**视口里第一行量过的行**的起点：起点的位置只受它
 * 上方那些行影响，不受自己高度影响，补偿因此是精确的，屏幕上已有的内容一寸不动。
 * 视口里一行量过的都没有（首屏刚挂载）就照旧用视口顶那一行——那时没有「原先的
 * 位置」可保，按行内偏移呈现反而自然。
 */
export function anchorAt(
  metrics: RowMetrics,
  scrollTop: number,
  options: AnchorOptions = {},
): Anchor | undefined {
  const index = rowAtOffset(metrics, scrollTop);
  if (index < 0) return undefined;
  const containing = metrics.keys[index];
  const { isMeasured, viewport } = options;
  if (isMeasured && !isMeasured(containing)) {
    const limit = scrollTop + (viewport ?? Number.POSITIVE_INFINITY);
    for (let i = index + 1; i < metrics.keys.length; i++) {
      if (metrics.offsets[i] > limit) break;
      if (isMeasured(metrics.keys[i]))
        return anchorWithNext(metrics, i, scrollTop - metrics.offsets[i]);
    }
  }
  return anchorWithNext(metrics, index, scrollTop - metrics.offsets[index]);
}

/**
 * 把「第几行 + 行内偏移」补齐成完整锚点：顺手记下下一行是谁、起点在哪。锚点行
 * 自己换了 key 时（见 `compensationFor`）就靠这一份邻位信息认回原位。
 */
function anchorWithNext(
  metrics: RowMetrics,
  index: number,
  offsetInItem: number,
): Anchor {
  const anchor: Anchor = { key: metrics.keys[index], offsetInItem };
  const nextKey = metrics.keys[index + 1];
  if (nextKey !== undefined) {
    anchor.nextKey = nextKey;
    anchor.nextStart = metrics.offsets[index + 1];
  }
  return anchor;
}

/** 锚点在新账本里的偏移；锚点行不在了返回 undefined（见 `compensationFor`）。 */
export function offsetForAnchor(
  metrics: RowMetrics,
  anchor: Anchor,
): number | undefined {
  const index = metrics.keys.indexOf(anchor.key);
  if (index < 0) return undefined;
  return metrics.offsets[index] + anchor.offsetInItem;
}

/**
 * 内容/尺寸变化要让视口搬多少；**连下一行都认不回来**时返回 undefined。
 *
 * 锚点行自己不在新账本里，不等于「认不回原位」：锚点还记着紧挨其后那一行的起点，
 * 拿它当基准同样能把视口钉住（CC 的 `nextKey` / `nextStart`，`shared-4-CF5qF0Y3.js`
 * `:2910`）。上翻取回一页正是这个形状 —— 上面插进一页、视口下面一行都没动，只有
 * 视口顶那一行换了身份（聚焦视图的折叠卡 key 取这一轮的用户消息，而这一页正好把
 * 它带回来）。没有这条退路时会一路掉到「按末尾重钉」，读者被从顶部甩到底部（真机
 * 实测远控页 `scrollTop` 0 → 1157 即末尾，2026-11-27）。
 */
export function compensationFor(
  previous: RowMetrics,
  next: RowMetrics,
  anchor: Anchor,
): number | undefined {
  const before = offsetForAnchor(previous, anchor);
  if (before === undefined) return undefined;
  const after = offsetForAnchor(next, anchor);
  if (after !== undefined) return after - before;
  if (anchor.nextKey === undefined || anchor.nextStart === undefined) {
    return undefined;
  }
  const nextIndex = next.keys.indexOf(anchor.nextKey);
  if (nextIndex < 0) return undefined;
  return next.offsets[nextIndex] - anchor.nextStart;
}
