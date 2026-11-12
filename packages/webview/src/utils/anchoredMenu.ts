import { CSSProperties, RefObject, useLayoutEffect, useState } from "react";
import { viewportSize } from "./viewport";

/** 菜单与视口边缘之间保留的最小留白（上下左右同值）。 */
export const MENU_VIEWPORT_MARGIN = 8;
/** 菜单与触发按钮之间的缝隙：向下展开时在按钮底下，翻上去时贴在按钮顶上。 */
export const MENU_ANCHOR_GAP = 4;

export interface MenuAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  /** 上下都放不下整个菜单时的可用高度（此时菜单内部滚动）；undefined = 不设限。 */
  maxHeight?: number;
}

/**
 * 把挂在触发按钮旁边的菜单摆进视口（spec desktop-sessions.md「会话行菜单完整
 * 可见」场景 1/2，与 desktop-file-panel.md 场景 11 的「不出视口」同一口径）。
 *
 * 纵向三个分支按优先级：
 * 1. 锚点下方放得下 ⇒ 向下展开（top = 按钮底 + 缝隙）；
 * 2. 下方放不下、上方放得下 ⇒ **整个翻到按钮上方**（菜单底边贴按钮顶 − 缝隙）。
 *    不选「只把 top 往上夹」：那样菜单会盖住触发它的那一行与「⋯」按钮本身，
 *    行越靠下盖得越多，看起来像是上一条会话的菜单；
 * 3. 上下都放不下 ⇒ 取空间大的一侧，把 `maxHeight` 收到该侧可用高度，菜单内部
 *    滚动。宁可让用户滚菜单，也不留一截滚不到的菜单在视口外。
 *
 * 水平方向沿用既有口径：右对齐锚点（`align: "right"`，默认）或左对齐（`"left"`），
 * 再夹进视口。
 */
export function placeAnchoredMenu(
  anchor: MenuAnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: "right" | "left" = "right",
): MenuPlacement {
  const { width, height } = size;
  const maxLeft = viewport.width - width - MENU_VIEWPORT_MARGIN;
  const wantedLeft = align === "right" ? anchor.right - width : anchor.left;
  const left = Math.max(MENU_VIEWPORT_MARGIN, Math.min(wantedLeft, maxLeft));

  // 可用高度：向下 = 按钮底到视口底；向上 = 视口顶到按钮顶（都扣掉缝隙与留白）。
  const spaceBelow =
    viewport.height - anchor.bottom - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - MENU_ANCHOR_GAP - MENU_VIEWPORT_MARGIN;

  // height 为 0 表示还没量到（首帧 / 无布局环境，如 jsdom）：按「放得下」处理，
  // 保持向下展开的默认形态，量到真实高度后再重算。
  if (height === 0 || height <= spaceBelow) {
    return { top: anchor.bottom + MENU_ANCHOR_GAP, left };
  }
  if (height <= spaceAbove) {
    return { top: anchor.top - MENU_ANCHOR_GAP - height, left };
  }
  if (spaceBelow >= spaceAbove) {
    return {
      top: anchor.bottom + MENU_ANCHOR_GAP,
      left,
      maxHeight: Math.max(0, spaceBelow),
    };
  }
  return {
    top: MENU_VIEWPORT_MARGIN,
    left,
    maxHeight: Math.max(0, spaceAbove),
  };
}

/**
 * 菜单的**自然外框高度**：`scrollHeight` 是内容高度（不被 `maxHeight` 夹短），
 * 加上 `offsetHeight - clientHeight`（边框）就是完整外框。
 *
 * 不能直接用 `offsetHeight`：夹取分支会给菜单设 `maxHeight`，菜单因此变矮 →
 * 下一次量到的是变矮后的高度 → 看起来「下方放得下」→ 放开 `maxHeight` → 又变高，
 * 形成来回跳的反馈环。用与 `maxHeight` 无关的量，环就断在源头。
 */
function naturalHeight(el: HTMLElement): number {
  return el.scrollHeight + (el.offsetHeight - el.clientHeight);
}

/**
 * 锚定菜单的 `fixed` 内联样式：横向夹取 + 纵向「下 → 翻上 → 夹取并内部滚动」。
 *
 * 菜单高度只有渲染完才知道，所以先按高度 0 渲一帧默认形态，`useLayoutEffect` 里
 * 量到真实高度立刻重渲一次——layout effect 在浏览器绘制前跑完，用户看不到中间态。
 * 之后由 `ResizeObserver` 盯着菜单：菜单项增减导致高度变化时会重新量。窗口缩放
 * 时先更新取景尺寸，避免开着的菜单被新视口挤出边界。
 *
 * 调用方保持自己的 `menuRef`（同一个 ref 还要交给键盘漫游与点外部关闭）。
 */
export function useAnchoredMenuStyle(
  menuRef: RefObject<HTMLElement | null>,
  anchorRect: MenuAnchorRect,
  width: number,
  align: "right" | "left" = "right",
): CSSProperties {
  const [menuHeight, setMenuHeight] = useState(0);
  const [viewport, setViewport] = useState(viewportSize);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const sync = () => setMenuHeight(naturalHeight(el));
    // 首帧同步量一次：layout effect 在绘制前跑完，用户看不到「高度 0」的中间态。
    sync();
    // 无布局能力的环境（jsdom 等没有 ResizeObserver）只靠上面这次同步测量。
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [menuRef]);

  useLayoutEffect(() => {
    const onResize = () => setViewport(viewportSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const placement = placeAnchoredMenu(
    anchorRect,
    { width, height: menuHeight },
    viewport,
    align,
  );

  return {
    position: "fixed",
    top: placement.top,
    left: placement.left,
    width,
    maxHeight: placement.maxHeight,
    overflowY: placement.maxHeight === undefined ? undefined : "auto",
  };
}
