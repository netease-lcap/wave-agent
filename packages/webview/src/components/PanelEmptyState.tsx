import React from "react";
import type { DesktopPanelKind } from "../types";
import { PANEL_ITEMS } from "./PanelToggleMenu";

/** Panel-type icons, matching the tab strip labels (DesktopPanelTabs). */
const PANEL_EMPTY_ICONS: Record<DesktopPanelKind, string> = {
  preview: "codicon-browser",
  plan: "codicon-list-unordered",
  diff: "codicon-diff",
  terminal: "codicon-terminal",
  file: "codicon-file-code",
};

/** Per-capability description on the empty-state card. */
const PANEL_EMPTY_DESC: Record<DesktopPanelKind, string> = {
  preview: "预览网页应用",
  plan: "查看实施计划",
  diff: "查看代码改动",
  terminal: "打开终端",
  file: "查看文件内容",
};

export interface PanelEmptyStateProps {
  /** Panels unavailable right now (e.g. diff/terminal without a workdir). */
  disabled: DesktopPanelKind[];
  /** Open the matching tab; multi-instance kinds add a fresh instance,
   *  single-instance kinds open-or-activate (same routing as the "＋" menu). */
  onOpen: (kind: DesktopPanelKind) => boolean;
}

/**
 * Desktop panel empty state (spec「面板空态」): shown when the right-hand panel
 * is expanded but no tab is open. Guides the user through the five panel
 * capabilities — clicking one opens the matching tab, or returns false when
 * the space guard refuses.
 */
export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({
  disabled,
  onOpen,
}) => (
  <div className="desktop-panel-empty" data-testid="panel-empty-state">
    <div className="desktop-panel-empty-title">还没有打开任何面板</div>
    <div className="desktop-panel-empty-sub">点击下方功能页打开对应面板</div>
    <div className="desktop-panel-empty-grid">
      {PANEL_ITEMS.map(({ kind, label, shortcut }) => {
        const isDisabled = disabled.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            className="desktop-panel-empty-item"
            disabled={isDisabled}
            onClick={() => onOpen(kind)}
            data-testid={`panel-empty-item-${kind}`}
            title={isDisabled ? "当前会话不可用" : PANEL_EMPTY_DESC[kind]}
          >
            <i className={`codicon ${PANEL_EMPTY_ICONS[kind]}`} />
            <span className="desktop-panel-empty-item-label">{label}</span>
            {shortcut ? (
              <span className="desktop-panel-empty-shortcut">{shortcut}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  </div>
);

export default PanelEmptyState;
