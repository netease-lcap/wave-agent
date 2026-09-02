import React, { useRef } from "react";
import { renderFileMarkdown } from "./FilePane";
import "../styles/PlanPane.css";

const MIN_WIDTH = 320;

export interface PlanPaneProps {
  /** Plan markdown content; null = no plan has been shown yet. */
  content: string | null;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
}

/**
 * Desktop plan panel (spec: 计划内容在编辑器区域预览): shows the ExitPlanMode
 * plan full text next to the conversation. The host's showConfirmation carries
 * the plan markdown; the pane opens automatically on ExitPlanMode and keeps the
 * plan after approval/rejection until the user closes it (like the VSCE
 * claudePlanPreview panel and the JB editor column).
 */
export const PlanPane: React.FC<PlanPaneProps> = ({
  content,
  width,
  onWidthChange,
  maxWidth,
}) => {
  const asideRef = useRef<HTMLElement>(null);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--vscode-focusBorder, #007fd4)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      ref={asideRef}
      className="preview-pane plan-pane"
      style={{ width }}
      data-testid="plan-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="desktop-panel-toolbar-title">计划</span>
        </div>
        <div className="preview-pane-body">
          {content ? (
            <div
              className="message-content markdown-content plan-pane-markdown"
              data-testid="plan-pane-content"
              dangerouslySetInnerHTML={{ __html: renderFileMarkdown(content) }}
            />
          ) : (
            <div className="desktop-panel-placeholder">
              <i className="codicon codicon-note plan-pane-placeholder-icon" />
              <span>等待计划生成…</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PlanPane;
