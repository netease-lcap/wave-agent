import React, {
  useState,
  useId,
  ReactElement,
  RefObject,
  useRef,
  useCallback,
} from "react";
import "../styles/Tooltip.css";
import { isDesktopHost } from "../utils/platform";

interface TooltipProps {
  text: string;
  children: ReactElement;
  position?:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right"
    | "top-left"
    | "top-right";
  /** 不传则按宿主取默认值：桌面端 4px、IDE 8px（见组件内 `gap` 注释）。 */
  offset?: number;
  disabled?: boolean;
  className?: string;
  /**
   * 长内容折行：`text` 里的 `\n` 原样换行，超宽内容按宽度折行（默认 `false` = 单行
   * `nowrap` + 超宽省略号）。含长路径 / 多个换行段落的文案要开，否则会被截成省略号
   * （如插件作用域气泡里的工程根目录——路径正是工程重名时唯一的区分依据）。
   */
  multiline?: boolean;
  /**
   * Optional external anchor: the tooltip positions against this element
   * instead of the wrapper span (e.g. a row's hover-highlight container, so
   * the hint starts at the row's visual edge rather than the content's).
   */
  anchorRef?: RefObject<HTMLElement>;
}

export const Tooltip: React.FC<TooltipProps> = ({
  text,
  children,
  position = "top",
  offset,
  disabled = false,
  className = "",
  multiline = false,
  anchorRef,
}) => {
  // 气泡↔触发的间距：桌面端按 skill 的下拉契约收成 4px（design-system.md:142
  // 「poppers carry no arrow、trigger-to-panel gap 4px」，桌面档角标已在
  // host-desktop.css 里去掉）；IDE 档保留 base 的 8px（角标还在，逐值不变）。
  // 显式传 offset 的调用方仍以后者为准。
  const gap = offset ?? (isDesktopHost() ? 4 : 8);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const calculatePosition = useCallback(() => {
    const anchor = anchorRef?.current ?? containerRef.current;
    if (!anchor || !tooltipRef.current) return;

    const containerRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let left = 0;
    let top = 0;

    switch (position) {
      case "top":
        left =
          containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.top - tooltipRect.height - gap;
        break;
      case "bottom":
        left =
          containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.bottom + gap;
        break;
      case "left":
        left = containerRect.left - tooltipRect.width - gap;
        top =
          containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        left = containerRect.right + gap;
        top =
          containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "top-left":
        left = containerRect.right - tooltipRect.width;
        top = containerRect.top - tooltipRect.height - gap;
        break;
      case "top-right":
        left = containerRect.left;
        top = containerRect.top - tooltipRect.height - gap;
        break;
      case "bottom-left":
        left = containerRect.right - tooltipRect.width;
        top = containerRect.bottom + gap;
        break;
      case "bottom-right":
        left = containerRect.left;
        top = containerRect.bottom + gap;
        break;
    }

    // Keep the tooltip inside the viewport (webview bounds); if it would
    // overflow an edge, shift it inward so it never gets clipped.
    const margin = 4;
    const maxLeft = Math.max(
      window.innerWidth - tooltipRect.width - margin,
      margin,
    );
    const maxTop = Math.max(
      window.innerHeight - tooltipRect.height - margin,
      margin,
    );
    left = Math.min(Math.max(left, margin), maxLeft);
    top = Math.min(Math.max(top, margin), maxTop);

    setTooltipStyle({ left, top });
  }, [position, gap, anchorRef]);

  // When disabled, render children without tooltip wrapper
  if (disabled) {
    return children;
  }

  const handleShow = () => {
    setIsVisible(true);
    // Calculate position after tooltip is rendered
    requestAnimationFrame(calculatePosition);
  };
  const handleHide = () => setIsVisible(false);

  return (
    <span
      className={`tooltip-container ${className}`}
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
      ref={containerRef}
    >
      {React.cloneElement(children, {
        "aria-describedby": id,
      })}
      <div
        id={id}
        role="tooltip"
        ref={tooltipRef}
        className={`tooltip-box tooltip-${position} ${isVisible ? "visible" : ""} ${multiline ? "tooltip-multiline" : ""}`}
        style={tooltipStyle}
      >
        {text}
      </div>
    </span>
  );
};
