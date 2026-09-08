import React from "react";
import { renderFileMarkdown } from "./FilePane";
import { PanelKindIcon } from "./PanelKindIcon";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import "../styles/PlanPane.css";

export interface PlanPaneProps {
  /** Plan markdown content; null = no plan has been shown yet. */
  content: string | null;
  width: number;
}

/**
 * Desktop plan panel (spec: 计划内容在编辑器区域预览): shows the ExitPlanMode
 * plan full text next to the conversation. The host's showConfirmation carries
 * the plan markdown; the pane opens automatically on ExitPlanMode and keeps the
 * plan after approval/rejection until the user closes it (like the VSCE
 * claudePlanPreview panel and the JB editor column).
 */
export const PlanPane: React.FC<PlanPaneProps> = ({ content, width }) => (
  <PaneShell
    kind="plan-pane"
    dataTestId="plan-pane"
    width={width}
    toolbar={<span className="desktop-panel-toolbar-title">计划</span>}
    bodyClassName="preview-pane-body"
  >
    {content ? (
      <div
        className="message-content markdown-content plan-pane-markdown"
        data-testid="plan-pane-content"
        dangerouslySetInnerHTML={{ __html: renderFileMarkdown(content) }}
      />
    ) : (
      <PanePlaceholder className="plan-pane-placeholder-empty">
        {/* 计划 pane 空态（评论 2026-09）：与文件/预览 pane 空态同格式
            ——图标在上、文案在下竖排居中，图标 24px。 */}
        <PanelKindIcon
          kind="plan"
          size={24}
          className="plan-pane-placeholder-icon"
        />
        <span>等待计划生成…</span>
      </PanePlaceholder>
    )}
  </PaneShell>
);

export default PlanPane;
