/**
 * 会话消息大纲的数据与几何（spec `ui/transcript-outline.md`）。
 *
 * 大纲本身只是一个「用户消息列表 + 它该多高多密」的推导，没有自己的状态：
 * 哪些消息能成为刻度、每格画多长、列窄到什么时候整体消失，全是纯函数，
 * 组件只负责画和收事件。放在 utils 里是为了这四条判据都能被单元测试钉住
 * ——几何一旦写进组件，就只能靠 e2e 量 rect 才发现算错。
 */
/**
 * 刻度住的地方：内容列左侧的留白（800px 列居中后两侧的空白）。留白不足这个
 * 宽度就整体不显示 —— 刻度必须与消息列有实际的间距，挤在一起时它既不像目录、
 * 又会压到正文上（spec 场景 10）。
 */
export const OUTLINE_MIN_GUTTER_PX = 40;
/**
 * 少于两条用户消息不显示：一条刻度没有导航价值，留着只是占位噪声
 * （spec 场景 2）。
 */
export const OUTLINE_MIN_ITEMS = 2;
/**
 * 预览卡里的问题文本上限。用户消息可能几万字符，原样塞进 DOM 既白渲染又拖慢
 * 悬停；卡片最多显示 3 行（截断），400 字已经远超。
 */
export const OUTLINE_QUESTION_LIMIT = 400;
/**
 * 一个刻度的盒高。视觉上只是 2px 的短横，但盒子要留出能点中的高度（悬停与
 * 点击都落在按钮上）——CSS 里 `.outline-tick` 的 min-height 必须与这里同源，
 * 否则间距算出来和画出来对不上。
 */
export const OUTLINE_TICK_BOX_PX = 8;
/** 间距下限：几十轮以上时靠它继续压缩，而不是让大纲溢出视口。 */
export const OUTLINE_GAP_MIN_PX = 2;
/**
 * 间距上限。对齐 Codex 桌面端：刻度是一列**密排**的短横，相邻两条之间的视觉
 * 距离约 20px（本常数 + OUTLINE_TICK_BOX_PX），太疏就不像「目录」而像几个散点。
 */
export const OUTLINE_GAP_MAX_PX = 12;
/**
 * 上下各留出的高度。刻度垂直居中，首/末刻度因此离视口边缘 ≥ 80px，预览卡
 * （约 120px 高，以刻度为中心）不会溢出视口顶端/底端 —— 这是用布局保证的
 * 夹取，不需要在悬停时再测一次位置去挪卡片。
 */
export const OUTLINE_VERTICAL_RESERVE_PX = 160;
/**
 * 刻度的画法（设计师 1110 评论：「参考 codex 的实现，希望间距始终固定 10px，
 * 刻度 2px*8px，hover 上去以后才有宽度梯度变化，最宽 24px」，随后又收到
 * 「刻度间距改为 8px」——间距指两条短横之间的空白，节距随之 10px）。
 *
 *   常态短横 8×2 → hover 宽度渐变到 24（CSS transition，不是瞬间切换）
 *   两条短横之间留 8px 空白 ⇒ **节距恒为 10px**，与视口高、条数都无关。
 *
 * 节距固定意味着条数一多就一定会超出刻度条的上限：列高 = 8 + 10(n−1)，上限
 * 654 时 n = 66 起出滚动箭头（见下方 `OUTLINE_RAIL_ARROW_SLOT_PX`）。
 */
/**
 * 常态短横：宽 6px、高 2px（设计师 1110 第 15 轮：「短的那条也再短一点点」，
 * 8 → 6）。
 */
export const OUTLINE_TICK_LINE_W_PX = 6;
export const OUTLINE_TICK_LINE_H_PX = 2;
/** hover 后的最大宽度（渐变结束值）。 */
export const OUTLINE_TICK_HOVER_W_PX = 24;
/** 相邻两条短横之间的视觉空白。 */
export const OUTLINE_TICK_AIR_PX = 8;
/** 节距 = 短横 2 + 空白 8 = 10。 */
export const OUTLINE_TICK_PITCH_PX =
  OUTLINE_TICK_LINE_H_PX + OUTLINE_TICK_AIR_PX;
/**
 * 布局用的 flex gap：命中盒 8px 高（OUTLINE_TICK_BOX_PX）比短横高，所以 gap 要
 * 用「节距 − 命中盒高」= 2px，两条**短线**之间才是 8px 空白。
 */
export const OUTLINE_TICK_GAP_PX = OUTLINE_TICK_PITCH_PX - OUTLINE_TICK_BOX_PX;

/**
 * hover 涟漪（设计师 1110 追加：「被 hover 刻度的上下几个刻度宽度也希望有个梯度
 * 变化」）：悬停时不止那一条变宽，上下相邻的几条按距离递减，形成一个围绕指针的
 * 渐变簇——指针在刻度间移动时每条只走一档，宽度 transition 于是连续流动。
 *
 * 取值 = 从最宽 24 到常态 6 的递减档：24 / 19 / 13，第 3 格起回到常态（6 或长档 10）。
 * 只变宽度、不动节距与左缘对齐，所以整列仍是「一竖列短线」，不是散点。
 */
export const OUTLINE_TICK_RIPPLE_W_PX = [
  OUTLINE_TICK_HOVER_W_PX,
  19,
  13,
] as const;

/**
 * 未选中刻度「一长一短」的节奏（设计师 1110：「把没选中的刻度做成一长一短，和
 * Codex 有点区分；短就用现在的长度，长在短和选中态之间」，随后「长的部分宽度
 * 减少 4px」，再随后「一长一短刻度长的那条再短一点」，第 15 轮「短的那条也再短
 * 一点点」）。
 *
 * 偶数格 = 长（**10**，16 → 12 → 10），奇数格 = 短（**6**，8 → 6）。
 * 两次收短的方向一致：整列的总墨迹越短，越不容易把注意力从正文拽走（长短差
 * 10 − 6 = 4px，比例上仍读得出相间）。
 */
export const OUTLINE_TICK_ALT_LONG_W_PX = 10;

/**
 * 某个刻度该画多宽。
 *
 * `distance` 是与悬停刻度的格距（负 = 没有悬停）。优先吃涟漪（0/1/2 格 →
 * 24/19/13），再往外回到「一长一短」的节奏；悬停是瞬态，指针离开后整列回到节奏。
 */
export function outlineTickWidth(distance: number, index: number): number {
  if (distance >= 0) {
    const ripple = OUTLINE_TICK_RIPPLE_W_PX[distance];
    if (ripple !== undefined) return ripple;
  }
  return index % 2 === 0 ? OUTLINE_TICK_ALT_LONG_W_PX : OUTLINE_TICK_LINE_W_PX;
}

/**
 * 刻度条自身的滚动（设计师 1110 追加：「给整个刻度条一个最大高度，会话过多超出
 * 高度时上下出箭头用于滚动，也支持鼠标滚轮」）。
 *
 * 分工：可滚区只放刻度，箭头住在它外面的上下两格；整条（箭头 + 可滚区）仍垂直
 * 居中，上限 `滚动面高 − OUTLINE_VERTICAL_RESERVE_PX`，于是预览卡任何情况下都
 * 不会溢出视口。条数超过上限就从「排不下」变成「滚着看」——上一版让它溢出滚动面
 * 的做法（首末刻度被裁）随之作废。
 */
/** 一支箭头占的高度：按钮盒 20 + 与刻度之间再留 8 的空白（她要「距离刻度再远一点」）。 */
export const OUTLINE_RAIL_ARROW_SLOT_PX = 28;

/**
 * 整条大纲占可用高度的比例（设计师 1110：「刻度整体的高度可以再减少 1/3 左右」）。
 *
 * 「可用高度」= 滚动面高 − 上下余量（814 高时是 654），再取 2/3 ⇒ **436**。
 * 按比例而不是减固定像素：窗口拉高时整条跟着变高，1/3 这个分寸在任何滚动面高度
 * 下都成立；改成减一个定值，小窗口里就成了「几乎占满」，大窗口里又几乎没变。
 *
 * 连带变化（814 高）：可滚区 `436 − 2×28 = 380`、可见 38 格、
 * 出箭头的门槛从 66 条降到 **44 条**（`8 + 10(n−1) > 436`）。
 */
export const OUTLINE_RAIL_HEIGHT_RATIO = 2 / 3;

/** 整条大纲最多能占多高：滚动面高减去上下各留的余量，再按比例收一档。 */
export function outlineRailBudget(viewportHeight: number): number {
  const available = viewportHeight - OUTLINE_VERTICAL_RESERVE_PX;
  return Math.max(
    OUTLINE_TICK_BOX_PX,
    Math.round(available * OUTLINE_RAIL_HEIGHT_RATIO),
  );
}

/** 刻度列的自然高度（不含箭头）：首条 8，之后每条一个节距。 */
export function outlineColumnHeight(itemCount: number): number {
  return (
    OUTLINE_TICK_BOX_PX + Math.max(0, itemCount - 1) * OUTLINE_TICK_PITCH_PX
  );
}

/** 是否需要滚动：自然高度超过整条的上限。 */
export function outlineRailOverflows(
  itemCount: number,
  viewportHeight: number,
): boolean {
  return outlineColumnHeight(itemCount) > outlineRailBudget(viewportHeight);
}

/** 可滚区的高度：不溢出时就是自然高度，溢出时让位给上下两支箭头。 */
export function outlineRailListHeight(
  itemCount: number,
  viewportHeight: number,
): number {
  const budget = outlineRailBudget(viewportHeight);
  return outlineRailOverflows(itemCount, viewportHeight)
    ? Math.max(OUTLINE_TICK_BOX_PX, budget - 2 * OUTLINE_RAIL_ARROW_SLOT_PX)
    : budget;
}

/**
 * 点一次箭头滚多少格（设计师 1110：「一下不要到顶或者到底，一次 20 个刻度左右」）。
 *
 * 早先是「一屏减一格」—— 814 高的滚动面里一次就是 59 格，按一下就基本贴到其中
 * 一端，读的人反而丢了上下文。改成固定 20 格：翻动幅度与「一屏能装多少」脱钩，
 * 窗口拉高拉矮翻页手感一致，翻完还剩 40 格上下重叠，前后能对上。
 */
export const OUTLINE_RAIL_PAGE_TICKS = 20;

/** 点一次箭头滚多远：固定 20 个刻度（= 20 × 节距 10 = 200px）。 */
export function outlineRailScrollStep(): number {
  return OUTLINE_RAIL_PAGE_TICKS * OUTLINE_TICK_PITCH_PX;
}

/**
 * 悬停预览卡的纵向位置（相对刻度列顶部）：命中盒 8 高、短横在正中，所以第 i 条
 * 的中心是 `i × 节距 + 4`；可滚区滚过多少就往上挪多少。卡片因此长在列外面
 * （`.outline-ticks` 里、可滚区之外）——可滚区 `overflow-y: auto` 会把伸出盒外的
 * 卡片裁掉，卡片不能再挂在刻度按钮里。
 */
export function outlineCardTop(index: number, scrollTop: number): number {
  return index * OUTLINE_TICK_PITCH_PX + OUTLINE_TICK_BOX_PX / 2 - scrollTop;
}

export interface TranscriptOutlineItem {
  /** 目标消息 id（`scrollToMessage` 的入参）。 */
  id: string;
  /** 在 `visibleMessages` 里的下标，仅供调试与断言。 */
  index: number;
  /** 该轮用户消息的文本（截断）。卡片只显示这一条。 */
  question: string;
}

/**
 * 要不要显示大纲。
 *
 * `columnWidth` 传 0 表示「还没测到」（首帧还没量、面板处于隐藏态）——
 * 此时**显示**：宁可首帧出现一次再消失，也不要因为测量缺失让大纲在某些宿主
 * 里永远不出现。
 *
 * `columnInset` 是内容列左边缘到滚动容器左边缘的距离，也就是刻度要住进去的
 * 那片留白。它只有在列**已经撑满最大宽度**之后才会随窗口变宽，所以「留白够
 * 不够」这一条同时表达了「窗口得比内容列再宽一些」—— 列还窄的时候留白是 0，
 * 大纲自然不出现。
 */
export function shouldShowOutline(
  columnWidth: number,
  columnInset: number,
  itemCount: number,
): boolean {
  if (itemCount < OUTLINE_MIN_ITEMS) return false;
  if (columnWidth <= 0) return true;
  return columnInset >= OUTLINE_MIN_GUTTER_PX;
}

/**
 * 刻度间距：等距排布，随条数在 2–40px 之间收缩，让常见长度（几十轮）在视口
 * 里排得完（spec 场景 11）。到下限就不再压缩——再挤刻度就糊成一条线，那时
 * 「一眼看到问过几件事」本身已经不是大纲能解决的问题，宁可让极长的会话略微
 * 溢出可用高，也不改成抽样丢项。
 *
 * @deprecated 2026-11-10 起组件不再调它：设计师要求「间距始终固定 10px」（见
 * `OUTLINE_TICK_PITCH_PX`），刻度节距与条数、视口高都解耦了。函数与它的单测
 * 先留着，等 spec 收口（`docs/specs/ui/transcript-outline.md` 场景 11）时
 * 连同压缩逻辑一起删。
 */
export function outlineGap(itemCount: number, viewportHeight: number): number {
  if (itemCount < 2) return OUTLINE_GAP_MAX_PX;
  const available = Math.max(0, viewportHeight - OUTLINE_VERTICAL_RESERVE_PX);
  const raw = (available - itemCount * OUTLINE_TICK_BOX_PX) / (itemCount - 1);
  return Math.round(
    Math.min(OUTLINE_GAP_MAX_PX, Math.max(OUTLINE_GAP_MIN_PX, raw)),
  );
}
