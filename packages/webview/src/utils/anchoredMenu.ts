import { CSSProperties, RefObject, useLayoutEffect, useState } from "react";
import { viewportSize } from "./viewport";

/** 菜单与视口边缘之间保留的最小留白（上下左右同值）。 */
export const MENU_VIEWPORT_MARGIN = 8;
/** 菜单与触发按钮之间的缝隙：向下展开时在按钮底下，翻上去时贴在按钮顶上。 */
export const MENU_ANCHOR_GAP = 4;

/**
 * 下拉选择器（设置页 / 创作集「查看者版本」/ 会话看板筛选）那一族的缝隙。
 * 设计师 0921 定的就是「下拉列表出现在选择器下方 **2px**」，与菜单族的 4px 不同，
 * 因此这个值由调用方按族传入，默认仍是菜单族的 4。
 */
export const SELECT_MENU_ANCHOR_GAP = 2;

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
  /** 锚点与菜单之间的缝隙；默认菜单族 4px，选择器族传 `SELECT_MENU_ANCHOR_GAP`(2)。 */
  gap: number = MENU_ANCHOR_GAP,
): MenuPlacement {
  const { width, height } = size;
  const maxLeft = viewport.width - width - MENU_VIEWPORT_MARGIN;
  const wantedLeft = align === "right" ? anchor.right - width : anchor.left;
  const left = Math.max(MENU_VIEWPORT_MARGIN, Math.min(wantedLeft, maxLeft));

  // 可用高度：向下 = 按钮底到视口底；向上 = 视口顶到按钮顶（都扣掉缝隙与留白）。
  const spaceBelow =
    viewport.height - anchor.bottom - gap - MENU_VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - gap - MENU_VIEWPORT_MARGIN;

  // height 为 0 表示还没量到（首帧 / 无布局环境，如 jsdom）：按「放得下」处理，
  // 保持向下展开的默认形态，量到真实高度后再重算。
  if (height === 0 || height <= spaceBelow) {
    return { top: anchor.bottom + gap, left };
  }
  if (height <= spaceAbove) {
    return { top: anchor.top - gap - height, left };
  }
  if (spaceBelow >= spaceAbove) {
    return {
      top: anchor.bottom + gap,
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

/** 两个锚点矩形是否在同一位置（亚像素抖动不算移动，避免每帧重渲）。 */
function sameRect(a: MenuAnchorRect | null, b: MenuAnchorRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5
  );
}

/**
 * 打开期间持续跟踪触发器位置，返回它的视口矩形（关闭时为 `null`）。
 *
 * 只量一次是不够的：分享弹层里的成员候选列表是**异步**拉回来的，回来后弹层内容
 * 撑高、触发器往下走 ~70px，而菜单是 `fixed`，不会自己跟着走 —— 结果面板压在触发器
 * 头上（2026-11-19 实测 `topGap` 从 +2 变成 −69）。所以打开期间逐帧比对触发器矩形，
 * 只在数值真的变了才写 state；关闭即停。
 *
 * 逐帧而不是只听 `scroll`/`resize`：内容回流（兄弟节点撑高、字体加载、折叠展开）
 * 不派发这两个事件，却会移动触发器。`scroll` 仍用捕获监听兜住**任何**祖先滚动容器，
 * 让面板在滚动的同一帧就跟上，不必等下一帧。
 */
export function useAnchorRect(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
): MenuAnchorRect | null {
  const [rect, setRect] = useState<MenuAnchorRect | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const read = (): MenuAnchorRect | null => {
      const r = anchorRef.current?.getBoundingClientRect();
      return r
        ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
        : null;
    };
    let last = read();
    setRect(last);
    const sync = () => {
      const next = read();
      if (sameRect(next, last)) return;
      last = next;
      setRect(next);
    };
    let raf = requestAnimationFrame(function tick() {
      sync();
      raf = requestAnimationFrame(tick);
    });
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [anchorRef, open]);

  return rect;
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
  gap: number = MENU_ANCHOR_GAP,
): CSSProperties {
  const [menuHeight, setMenuHeight] = useState(0);
  const [viewport, setViewport] = useState(viewportSize);
  // 菜单常常是「打开后才挂载」的（`{open && <div ref=…>}`），调用方传进来的 ref 在
  // 首次渲染时还是空的。所以每轮渲染把节点同步进 state：节点没变时 setState 不触发
  // 重渲，变成节点后下面那个测量 effect 才会跑起来（只依赖 ref 的话永远量不到）。
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setMenuEl(menuRef.current);
  });

  useLayoutEffect(() => {
    if (!menuEl) return;
    const sync = () => setMenuHeight(naturalHeight(menuEl));
    // 挂载即同步量一次：layout effect 在绘制前跑完，用户看不到「高度 0」的中间态。
    sync();
    // 无布局能力的环境（jsdom 等没有 ResizeObserver）只靠上面这次同步测量。
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(menuEl);
    return () => observer.disconnect();
  }, [menuEl]);

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
    gap,
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
