import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/Tooltip.css";
import { isDesktopHost } from "../utils/platform";

/**
 * 悬停提示的「委托版」：专供 **`dangerouslySetInnerHTML` 生成的 DOM** 用。
 *
 * 存在的理由只有一个：那块 DOM 不是 React 节点，`<Tooltip>` 挂不上（它靠包裹层
 * 自己的 `onMouseEnter` 触发）。消息正文里的代码块正是这种地方——`.md-code-block`
 * 里的复制按钮是 marked 渲染器拼出来的 HTML 字符串（见 `Message.tsx`
 * `renderer.code`），点击靠容器事件委托接住，提示也只能同样走委托。
 *
 * 口径与 `<Tooltip>` 一致，好让两套入口长出来的是同一颗气泡：
 * - 皮肤直接复用 `.tooltip-box.tooltip-bottom`，不另写一份颜色/内衬/圆角；
 * - 间距跟宿主档走（桌面 4px / 插件端 8px），视口四边留 4px 防裁；
 * - 只认 `[data-tip]` 这个属性——调用方**桌面端**把它写进生成的 HTML，插件端
 *   仍写原生 `title`（原生提示在桌面端的 webview 里看不到，设计师 1029 评论：
 *   「我这还是看不到，换成桌面端自绘的 Tooltip」，同 `CodeCommentEntry` 的判据）。
 *
 * 挂在 `document` 上而不是某个容器上：一个页面只有一份，不用给每个正文容器再传
 * ref；`[data-tip]` 只由桌面端生成，插件端这个组件整个不渲染。
 */
export const DelegatedTooltip: React.FC = () => {
  const [tip, setTip] = useState<{
    el: Element;
    text: string;
    rect: DOMRect;
  } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const enabled = isDesktopHost();

  useEffect(() => {
    if (!enabled) return;
    const anchorOf = (event: Event): Element | null => {
      const target = event.target as Element | null;
      return target?.closest?.("[data-tip]") ?? null;
    };
    const show = (el: Element) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      setTip({ el, text, rect: el.getBoundingClientRect() });
    };
    const onOver = (event: MouseEvent) => {
      const el = anchorOf(event);
      if (el) show(el);
    };
    const onOut = (event: MouseEvent) => {
      const el = anchorOf(event);
      if (!el) return;
      // 在元素内部换目标（图标 → 文字）不算离开，否则气泡会闪。
      const to = event.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      setTip(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      const el = anchorOf(event);
      if (el) show(el);
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    // 滚动会让气泡脱开锚点（气泡是 `position: fixed`），直接收掉。
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [enabled]);

  // 气泡挂着的时候文案可能被就地改掉：代码块的复制按钮复制成功后把 `data-tip` 换成
  // 「已复制」、1.5s 后再换回。跟着改——否则指针一直没动，气泡里还写着旧文案。
  const anchorEl = tip?.el ?? null;
  useEffect(() => {
    if (!enabled || !anchorEl) return;
    const update = () => {
      const next = anchorEl.getAttribute("data-tip");
      if (!next) return;
      setTip((prev) =>
        prev && prev.text !== next ? { ...prev, text: next } : prev,
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(anchorEl, {
      attributes: true,
      attributeFilter: ["data-tip"],
    });
    return () => observer.disconnect();
  }, [enabled, anchorEl]);

  // 先量气泡自身再定位：`<Tooltip>` 用的是 rAF，这里用 `useLayoutEffect`（同一帧内
  // 落位、首帧不闪）。锚点在下方 4px 处居中，出界后往视口内收。
  useLayoutEffect(() => {
    if (!tip) {
      setPos(null);
      return;
    }
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const gap = isDesktopHost() ? 4 : 8;
    const margin = 4;
    const left = tip.rect.left + tip.rect.width / 2 - rect.width / 2;
    const top = tip.rect.bottom + gap;
    setPos({
      left: Math.min(
        Math.max(left, margin),
        Math.max(window.innerWidth - rect.width - margin, margin),
      ),
      top: Math.min(
        Math.max(top, margin),
        Math.max(window.innerHeight - rect.height - margin, margin),
      ),
    });
  }, [tip]);

  if (!enabled || !tip) return null;

  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="tooltip-box tooltip-bottom visible"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
    >
      {tip.text}
    </div>,
    document.body,
  );
};

export default DelegatedTooltip;
