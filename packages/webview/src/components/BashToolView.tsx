import React, { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./ChevronIcon";
import type { ToolBlock } from "../types";
import { getToolStatusColor } from "../utils/statusColors";

interface BashToolViewProps {
  block: ToolBlock;
  /**
   * 收起行里的单行摘要。AI 调用时是 `compactParams`（`description` 优先，否则
   * 命令本身）；streaming 阶段沿用父组件的「原始参数末 30 字」。
   */
  summary: string;
  /** 命令 + 输出的那一坨 DOM；`null` = 没有可展开内容。 */
  body: React.ReactNode;
  /** 工具自身报的错（`.tool-error`）：不属于可折叠正文，任何折叠态都常显。 */
  error: React.ReactNode;
  /** 是否给折叠入口：`!` bash 模式（用户消息）常显、不给入口。 */
  collapsible: boolean;
}

/**
 * Bash 工具块（specs/ui/message-rendering-system.md「Bash 工具块默认收起」）。
 *
 * Bash 是本仓唯一把完整输入与输出无条件下沉进消息流的工具（Write/Edit 给差异、
 * Read 给一行统计），所以只有它需要折叠：
 *
 * - **已结束且成功**（`stage === "end"` 且 `success !== false` 且无 `error`）→ 默认
 *   收起，只留一行（状态点 + 工具名 + 单行摘要）。收起态**不渲染**正文节点（不是
 *   `display:none`），页内查找与屏幕阅读器都碰不到它。
 * - **运行中**（`start` / `streaming` / `running`）→ 保持展开，实时输出是这段等待
 *   期唯一的反馈；阶段首次进入 `end` 时自动收起一次（与 `ReasoningBlockView` 同一
 *   策略），用户手动收起的不会被重新展开。
 * - **失败**（`success === false` 或带 `error`）→ 不自动收起：红掉的命令与输出留在
 *   屏幕上，省掉「先点一下才知道为什么变红」。
 * - **`!` bash 模式**（用户消息）→ 常显、无折叠入口：命令是用户自己敲的，紧接着就
 *   要看结果。
 * - 展开态**不持久化**（不进 `SessionUiStore`）：初值只由块的 `stage` 决定，切会话 /
 *   回放历史 / 重连后重新拉取都会回到收起态。
 *
 * 收起行刻意**不带**结果末几行：那是 CLI 在「终端里没法逐块点开」约束下的替代品
 * （`packages/code/src/components/ToolDisplay.tsx`），webview 有逐块点击，不做补偿。
 */
export const BashToolView: React.FC<BashToolViewProps> = ({
  block,
  summary,
  body,
  error,
  collapsible,
}) => {
  const expandable = collapsible && body !== null && body !== undefined;
  const failed = block.success === false || !!block.error;
  const statusColor = getToolStatusColor(block);

  // 历史 / 回放的块挂载时就已经是 end 了，初值直接取「是否该收起」。
  const [collapsed, setCollapsed] = useState(
    expandable && block.stage === "end" && !failed,
  );
  const prevStageRef = useRef(block.stage);

  // 阶段首次进入 end 时自动收起一次（只置 true，从不自动展开）。
  useEffect(() => {
    if (
      prevStageRef.current !== "end" &&
      block.stage === "end" &&
      expandable &&
      !failed
    ) {
      setCollapsed(true);
    }
    prevStageRef.current = block.stage;
  }, [block.stage, expandable, failed]);

  const name = block.name || "Tool";

  return (
    <div className="tool-container">
      {expandable ? (
        <button
          type="button"
          className="tool-block bash-tool-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="tool-status-dot" style={{ color: statusColor }}>
            ●
          </span>{" "}
          <span className="bash-tool-label">
            {name}
            {summary ? (
              <span className="compact-params"> {summary}</span>
            ) : null}
          </span>
          <ChevronIcon
            expanded={!collapsed}
            size={12}
            className="bash-tool-chevron"
          />
        </button>
      ) : (
        <div className="tool-block">
          <span className="tool-status-dot" style={{ color: statusColor }}>
            ●
          </span>{" "}
          {name}
          {summary ? <span className="compact-params"> {summary}</span> : ""}
        </div>
      )}
      {(!expandable || !collapsed) && body}
      {error}
    </div>
  );
};
