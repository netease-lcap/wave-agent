/**
 * 会话消息大纲的数据与几何（spec `ui/transcript-outline.md`）。
 *
 * 大纲本身只是一个「用户消息列表 + 它该多高多密」的推导，没有自己的状态：
 * 哪些消息能成为刻度、每格画多长、列窄到什么时候整体消失，全是纯函数，
 * 组件只负责画和收事件。放在 utils 里是为了这四条判据都能被单元测试钉住
 * ——jsdom 不做排版，几何一旦写进组件就只能靠 e2e 才发现算错。
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
 * `columnWidth` 传 0 表示「还没测到」（jsdom 不做排版、首帧也可能还没量）——
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
 */
export function outlineGap(itemCount: number, viewportHeight: number): number {
  if (itemCount < 2) return OUTLINE_GAP_MAX_PX;
  const available = Math.max(0, viewportHeight - OUTLINE_VERTICAL_RESERVE_PX);
  const raw = (available - itemCount * OUTLINE_TICK_BOX_PX) / (itemCount - 1);
  return Math.round(
    Math.min(OUTLINE_GAP_MAX_PX, Math.max(OUTLINE_GAP_MIN_PX, raw)),
  );
}
