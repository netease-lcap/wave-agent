import type { ModSurfaceMetrics } from "wave-agent-sdk/types";

/**
 * mod 面板的**字符宽高**（spec `ecosystem/plugin-mods.md`「`ui.render` 的
 * `e.props`」：surface 实测上报，不再是插件侧的猜测）。
 *
 * 量的是「这个元素横着能放几个字符、竖着能放几行」：宽度 ÷ 一个字符的宽度、高
 * 度 ÷ 行高。为什么用字符而不是像素 —— mod 的 `e.props.bodyColumns` /
 * `e.viewport.columns` 是 Claude Code 的单位（终端是列数），社区插件拿它算断行与
 * 分页；像素值对它们没有意义。
 *
 * 字宽取自**元素自己的计算字体**（面板是 12px、带是 12px），用 canvas
 * `measureText` 量一个 `0` 的宽度：我们的面板字体是比例字体，没有真正的「一格」，
 * 数字宽度是这个数字最接近的口径，也是社区 mod 断行时用的那个。
 */

/** 一个字符多宽、一行多高（px）。 */
export interface ModCharCell {
  advance: number;
  lineHeight: number;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext;
  measureContext = null;
  if (typeof document === "undefined") return measureContext;
  try {
    measureContext = document.createElement("canvas").getContext("2d");
  } catch {
    measureContext = null;
  }
  return measureContext;
}

/** 一份计算字体下一个字符的宽度与一行的高度；量不出来给 `null`。 */
export function charCellOf(
  style: CSSStyleDeclaration | null,
): ModCharCell | null {
  if (!style) return null;
  const fontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSize) || fontSize <= 0) return null;
  const lineHeight = Number.parseFloat(style.lineHeight);
  const context = canvasContext();
  if (!context) return null;
  const font = [
    style.fontStyle,
    style.fontWeight,
    style.fontSize,
    style.fontFamily,
  ]
    .filter((part) => part && part !== "normal")
    .join(" ");
  // 字体串拼坏了 canvas 会静默沿用上一次的 font：先设成固定的兜底值再设目标值，
  // 两次都失败时下面量到的宽度会明显不对，由 `advance` 的正数校验兜住。
  context.font = `${fontSize}px monospace`;
  if (font) context.font = font;
  const advance = context.measureText("0").width;
  if (!Number.isFinite(advance) || advance <= 0) return null;
  return {
    advance,
    lineHeight:
      Number.isFinite(lineHeight) && lineHeight > 0
        ? lineHeight
        : fontSize * 1.5,
  };
}

/** 一个元素**正文**能放几个字符（`columns` / `rows`）：内衬不算。 */
export function measureElementCells(
  element: Element | null | undefined,
): { columns: number; rows: number } | null {
  if (!element || typeof window === "undefined") return null;
  const style = window.getComputedStyle(element);
  const cell = charCellOf(style);
  if (!cell) return null;
  const rect = element.getBoundingClientRect();
  const padX =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  const padY =
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0);
  const columns = Math.floor((rect.width - padX) / cell.advance);
  const rows = Math.floor((rect.height - padY) / cell.lineHeight);
  if (columns <= 0) return null;
  return { columns, rows: rows > 0 ? rows : 1 };
}

/**
 * 这一端**画布**的字符宽高（`e.viewport.columns` / `rows`）。
 *
 * 量的是 webview 视口而不是某个元素：插件端这一整块就是聊天面板，`viewport`
 * 说的是「这一端多大」，不是「这块面板多宽」—— 后者是 `bodyColumns`。
 * `reference` 只用来取字体（面板的字体与页面正文不是一个字号）。
 */
export function measureViewportCells(
  reference?: Element | null,
): { columns: number; rows: number } | null {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  const width = root.clientWidth;
  const height = root.clientHeight;
  const cell = charCellOf(
    window.getComputedStyle(reference ?? document.body ?? root),
  );
  if (!cell || width <= 0) return null;
  const columns = Math.floor(width / cell.advance);
  const rows = Math.floor(height / cell.lineHeight);
  if (columns <= 0) return null;
  return { columns, rows: rows > 0 ? rows : 1 };
}

/** 把量到的两份数字拼成一次请求带上去的版面事实（缺的字段不带）。 */
export function modSurfaceMetrics(
  viewport: { columns: number; rows: number } | null,
  body: { columns: number } | null,
): ModSurfaceMetrics {
  const metrics: ModSurfaceMetrics = {};
  if (viewport) {
    metrics.columns = viewport.columns;
    metrics.rows = viewport.rows;
  }
  if (body && body.columns > 0) metrics.bodyColumns = body.columns;
  return metrics;
}
