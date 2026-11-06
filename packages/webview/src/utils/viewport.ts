/**
 * `fixed` 定位的取景尺寸。
 *
 * 初始包含块 = 视口，但要**扣掉经典滚动条**：`documentElement.clientWidth` /
 * `clientHeight` 才是它，`window.innerWidth` / `innerHeight` 把滚动条也算进来，
 * 贴右缘的浮层/菜单就凭空多一条 8–12px 的缝（2026-11-05 用量浮层与个人信息菜单
 * 各踩过一次，故收成一处，别再各写一遍）。
 *
 * jsdom 没有布局，这两个值恒为 0，回退到 `innerWidth` / `innerHeight`，让无布局
 * 环境（单测）里的坐标仍按视口算。
 */
export function viewportSize(): { width: number; height: number } {
  const docEl = document.documentElement;
  return {
    width: docEl.clientWidth || window.innerWidth,
    height: docEl.clientHeight || window.innerHeight,
  };
}
