import type { ToolBlock } from "../types";

/**
 * 工具/思考/文本块的圆点状态色（codechat 语义色，F-08 起接入 --cc-state-*）：
 * 成功 / 失败 / 流式 / 运行 / 中性。时间线行首节点（.timeline-row::before）与
 * 块内圆点共用同一套映射。
 *
 * 值走语义 token：桌面端由 host-desktop.css 的 --cc-state-* 提供浅/深两档
 * （权威 = codechat theme/desktop-colors.css :78-83 / :173-178），切主题自动换档；
 * 插件端不定义这些 token → 回落 fallback 的现值 hex，观感零回归。
 */
export const TOOL_STATUS_COLORS = {
  /** 参数/内容流式传输中 */
  streaming: "var(--cc-state-streaming, #E6A23C)",
  /** 工具执行中 */
  running: "var(--cc-state-running, #2F5EDB)",
  /** 成功完成 */
  success: "var(--cc-state-succeeded, #16A34A)",
  /** 失败 */
  error: "var(--cc-state-failed, #D92D20)",
  /** 未知/中立（无状态标记的历史记录） */
  idle: "var(--cc-state-idle, var(--vscode-descriptionForeground, #888))",
} as const;

/** 工具块状态圆点颜色（流式橙 / 运行蓝 / 成功绿 / 失败红）。 */
export const getToolStatusColor = (
  toolBlock: Pick<ToolBlock, "stage" | "success" | "error">,
): string => {
  if (toolBlock.stage === "streaming") return TOOL_STATUS_COLORS.streaming;
  if (toolBlock.stage === "running") return TOOL_STATUS_COLORS.running;
  if (toolBlock.success === true) return TOOL_STATUS_COLORS.success;
  if (toolBlock.error || toolBlock.success === false)
    return TOOL_STATUS_COLORS.error;
  return TOOL_STATUS_COLORS.idle;
};

/** 思考/普通文本块节点颜色：流式中橙，结束后绿。 */
export const getStageColor = (stage?: "streaming" | "end"): string =>
  stage === "streaming"
    ? TOOL_STATUS_COLORS.streaming
    : TOOL_STATUS_COLORS.success;
