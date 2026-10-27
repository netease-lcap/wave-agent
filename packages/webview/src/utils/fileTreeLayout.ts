/**
 * 文件树列的几何规则（spec desktop-file-panel.md「文件面板工作区目录树」场景 1-3）。
 *
 * 树是**并排**的一列（不是覆盖层），所以它必须让正文有下限，并且在面板窄到根本
 * 没有并排余地时自己让位——否则用户把分屏拖窄后，正文会被挤成一条缝。口径参照
 * Claude 桌面端的文件查看器：列宽 160–640 但 `max-width` 还受 `100% - 160px`
 * 约束、容器窄于 400px 时树由容器查询隐藏、拖到一半就收起。
 *
 * 这些是纯函数：命中哪条分支只由宽度与状态决定，方便直接断言边界值。
 */

/** 拖拽下限（与既有手感一致）。 */
export const TREE_MIN_WIDTH = 140;
/** 拖拽上限。 */
export const TREE_MAX_WIDTH = 420;
/** 正文保底：树列最多只能吃到「面板宽 - 这个值」。 */
export const CONTENT_MIN_WIDTH = 160;
/** 面板正文区比这还窄，就不再并排显示树。 */
export const TREE_AUTO_HIDE_BELOW = 400;
/** 分隔条拖到比这还窄 = 想收起树（松手即收）。 */
export const TREE_COLLAPSE_BELOW = 80;

/** 树列宽度的硬上限：面板宽度扣掉正文保底。 */
export function treeWidthCeiling(available: number): number {
  return Math.max(0, available - CONTENT_MIN_WIDTH);
}

/**
 * 把目标宽度夹进 [MIN, MAX]，并且不让正文窄于 `CONTENT_MIN_WIDTH`。
 *
 * `available <= 0` 表示还没量到面板宽度（首帧、没有 ResizeObserver 的环境如
 * jsdom）：此时只夹 MIN/MAX，不按「面板 0 宽」把树压成 0。
 */
export function clampTreeWidth(desired: number, available: number): number {
  const bounded = Math.max(TREE_MIN_WIDTH, Math.min(TREE_MAX_WIDTH, desired));
  if (available <= 0) return bounded;
  return Math.min(bounded, treeWidthCeiling(available));
}

/** 面板够不够并排一条树。宽度未知（<= 0）时当成够，免得没量到就先闪一下没了。 */
export function treeFits(available: number): boolean {
  return available <= 0 || available >= TREE_AUTO_HIDE_BELOW;
}

/** 拖动过程中越过收起阈值（松手时按「收起」处理）。 */
export function draggedTooNarrow(width: number): boolean {
  return width < TREE_COLLAPSE_BELOW;
}

export interface TreeVisibilityInput {
  /** 宿主给了工作目录根、且是能发消息的宿主（老宿主不给根就没有树）。 */
  hasTree: boolean;
  /** 用户的手动开关（按会话记住）。 */
  wantsTree: boolean;
  /** 面板正文区宽度；<= 0 = 还没量到。 */
  available: number;
  /** 当前有没有打开的文件——一个都没打开时树就是这一格的主界面。 */
  hasOpenFile: boolean;
}

/**
 * 树到底显不显示。三个来源叠加，缺一不可：
 * 用户没关它（不被自动让位改写）、有树可放、且（没打开文件 或 放得下）。
 */
export function shouldShowTree({
  hasTree,
  wantsTree,
  available,
  hasOpenFile,
}: TreeVisibilityInput): boolean {
  if (!hasTree || !wantsTree) return false;
  if (!hasOpenFile) return true;
  return treeFits(available);
}

/**
 * 「想要但暂时让位」：用户没关树，只是面板太窄放不下。工具条据此把开关画成
 * 不可用并写明原因，而不是让人点了没反应。
 */
export function treeDeferredForSpace({
  hasTree,
  wantsTree,
  available,
  hasOpenFile,
}: TreeVisibilityInput): boolean {
  return hasTree && wantsTree && hasOpenFile && !treeFits(available);
}
