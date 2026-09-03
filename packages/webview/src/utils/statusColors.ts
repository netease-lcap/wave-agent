import type { ToolBlock } from "../types";

/**
 * 工具/思考/文本块的圆点状态色（codechat 语义色）：
 * 成功 #16A34A / 失败 #D92D20 / 流式 #E6A23C / 运行 #2F5EDB。
 * 时间线行首节点（.timeline-row::before）与块内圆点共用同一套映射。
 */
export const TOOL_STATUS_COLORS = {
  /** 参数/内容流式传输中 */
  streaming: "#E6A23C",
  /** 工具执行中 */
  running: "#2F5EDB",
  /** 成功完成 */
  success: "#16A34A",
  /** 失败 */
  error: "#D92D20",
  /** 未知/中立（无状态标记的历史记录） */
  idle: "var(--vscode-descriptionForeground, #888)",
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
