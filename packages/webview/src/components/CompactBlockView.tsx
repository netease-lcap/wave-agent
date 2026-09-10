import React, { useState } from "react";
import { QueueChevronIcon } from "./HeaderIcons";
import type { CompactBlock } from "../types";

interface CompactBlockViewProps {
  block: CompactBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const CompactBlockView: React.FC<CompactBlockViewProps> = ({
  block,
  renderContent,
}) => {
  // Compact summaries are always collapsed by default — show a hint line, expand on click.
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="reasoning-block compact-block">
      {/* F-11（WCAG 2.1.1 / 4.1.2）：同 ReasoningBlockView，折叠标题由
          <div onClick> 改为 button，键盘可达并暴露 aria-expanded；默认折叠
          （对话已压缩起始即 collapsed）策略不变。 */}
      <button
        type="button"
        className="reasoning-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="reasoning-dot compact-dot" />
        <span className="reasoning-title">对话已压缩</span>
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      </button>
      {!collapsed && (
        <div className="reasoning-content">
          {renderContent(block.content || "")}
        </div>
      )}
    </div>
  );
};
