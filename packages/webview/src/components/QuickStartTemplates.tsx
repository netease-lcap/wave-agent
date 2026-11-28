import React, { useCallback, useEffect, useRef, useState } from "react";
import { QUICK_START_CATEGORIES } from "../utils/quickStartTemplates";
import { QuickStartCategoryIcon } from "./QuickStartCategoryIcon";
import "../styles/QuickStartTemplates.css";

interface QuickStartTemplatesProps {
  /** 点二级分类：把整段模板填进输入框（调用方走 MessageInput 的 loadDraft）。 */
  onApplyTemplate: (prompt: string) => void;
}

/**
 * 空态页「快捷方式」区：一级 12 个开发场景分类 ⇄ 二级「返回 + 该分类的模板」。
 *
 * 整行替换而不是叠一块面板：子分类紧跟着所点分类出现，返回胶囊即当前分类本身
 * （与侧栏选中行同一套选中底）。
 *
 * 位置在输入卡下方（设计师 1022 评论「这块放在输入框下面」）；左右限宽与输入卡
 * 同档，两条边线对齐。
 *
 * 只在空态（尚无消息）出现——它是「第一次怎么开口」的入口，有对话历史后再常驻
 * 只会占掉消息区高度。
 *
 * 各端单行横滚（桌面端 2026-11-16 定稿「单行显示，左右通过箭头按钮滚动，也支持
 * 滚轮横滚，滚动过程中左右两侧出现渐变蒙层」；插件端与远控页同款）：滚动区外面
 * 包一层定位容器，两端各叠一片渐变蒙层 + 一颗箭头键，只在那一侧还有内容可滚时出现。
 */
export const QuickStartTemplates: React.FC<QuickStartTemplatesProps> = ({
  onApplyTemplate,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = QUICK_START_CATEGORIES.find((c) => c.id === activeId) ?? null;
  const rowRef = useRef<HTMLDivElement | null>(null);
  /** 两端是否还有可滚内容 —— 箭头与蒙层共用这一个判据。 */
  const [edges, setEdges] = useState({ start: false, end: false });

  const syncEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    // 1px 容差：高分屏上 scrollLeft 可能是小数
    const start = row.scrollLeft > 1;
    const end = max > 1 && row.scrollLeft < max - 1;
    setEdges((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    syncEdges();
    row.addEventListener("scroll", syncEdges, { passive: true });
    // 内容换层（一级 ⇄ 二级）与窗口变化都会改变「能不能滚」，两侧都得跟。
    const ro = new ResizeObserver(syncEdges);
    ro.observe(row);
    Array.from(row.children).forEach((el) => ro.observe(el));
    return () => {
      row.removeEventListener("scroll", syncEdges);
      ro.disconnect();
    };
  }, [syncEdges, activeId]);

  // 没有触控板时怎么横滚这一行（同创作集分类 tab 的做法，见
  // ArtifactsPage.tsx 里的那段注释）：垂直滚轮翻译成横向滚动，横向滚轮与触控板
  // 横扫交给浏览器；React 的 onWheel 是 passive 的（preventDefault 无效），所以
  // 挂原生监听。区别是**滚到头就放行**——这一行下方没有别的滚动区，不放行等于
  // 把鼠标困在行里、滚不动页面。
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onWheel = (event: WheelEvent) => {
      // ⌘/Ctrl + 滚轮是缩放，横向滚轮（触控板横扫 / 倾斜滚轮）走浏览器默认
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const max = Math.max(0, row.scrollWidth - row.clientWidth);
      if (max <= 0) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? row.clientWidth
            : 1;
      const next = Math.min(
        max,
        Math.max(0, row.scrollLeft + event.deltaY * unit),
      );
      // 已经顶到这一侧的尽头：不吃掉事件，继续滚就带页面走
      if (next === row.scrollLeft) return;
      event.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  /** 箭头步长：一屏减一颗胶囊，翻页后还能看见上一屏的最后一颗（有参照物）。 */
  const scrollByPage = (dir: -1 | 1) => {
    const row = rowRef.current;
    if (!row) return;
    const step = Math.max(160, row.clientWidth - 96);
    row.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <div className="quick-start" data-testid="quick-start">
      <div className="quick-start-scroller">
        <div className="quick-start-row" ref={rowRef}>
          {active === null
            ? QUICK_START_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="quick-start-cat"
                  data-testid={`quick-start-cat-${category.id}`}
                  onClick={() => setActiveId(category.id)}
                >
                  <QuickStartCategoryIcon id={category.id} />
                  {category.label}
                </button>
              ))
            : [
                <button
                  key="back"
                  type="button"
                  className="quick-start-back"
                  data-testid="quick-start-back"
                  aria-label={`返回分类列表（当前：${active.label}）`}
                  onClick={() => setActiveId(null)}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M10 3.5 5.5 8l4.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{active.label}</span>
                </button>,
                <span
                  key="divider"
                  className="quick-start-divider"
                  aria-hidden="true"
                />,
                ...active.templates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="quick-start-sub"
                    data-testid="quick-start-sub"
                    onClick={() => onApplyTemplate(template.prompt)}
                  >
                    {template.label}
                  </button>
                )),
              ]}
        </div>
        <span
          className={`quick-start-fade quick-start-fade--start${edges.start ? " is-visible" : ""}`}
          aria-hidden="true"
        />
        <span
          className={`quick-start-fade quick-start-fade--end${edges.end ? " is-visible" : ""}`}
          aria-hidden="true"
        />
        {edges.start && (
          <button
            type="button"
            className="quick-start-arrow quick-start-arrow--start"
            data-testid="quick-start-arrow-prev"
            aria-label="向左滚动分类"
            onClick={() => scrollByPage(-1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M10 3.5 5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {edges.end && (
          <button
            type="button"
            className="quick-start-arrow quick-start-arrow--end"
            data-testid="quick-start-arrow-next"
            aria-label="向右滚动分类"
            onClick={() => scrollByPage(1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M6 3.5 10.5 8 6 12.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default QuickStartTemplates;
