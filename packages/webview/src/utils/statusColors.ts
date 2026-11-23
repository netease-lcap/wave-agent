import type { MessageBlock, ToolBlock } from "../types";

/**
 * 工具/思考/文本块的状态色（codechat 语义色，F-08 起接入 --cc-state-*）：
 * 成功 / 失败 / 流式 / 运行 / 中性。工具卡的图标色与时间线圆点共用同一套映射。
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
  // `start` = 模型已点名工具、参数还没开始流，与 `streaming` 同属「进行中」，共用橙色。
  // 它过去没有自己的档位、落到下面的 `success === false` 分支被染成失败红：`start`
  // 帧本身不带 success，而 webview 新建块时把缺失的 success 当成了 false。遥控页上
  // 这段红点肉眼可见——start 帧离散直发，streaming 帧要等 150 ms 合并窗口。
  if (toolBlock.stage === "start" || toolBlock.stage === "streaming")
    return TOOL_STATUS_COLORS.streaming;
  if (toolBlock.stage === "running") return TOOL_STATUS_COLORS.running;
  if (toolBlock.success === true) return TOOL_STATUS_COLORS.success;
  if (toolBlock.error || toolBlock.success === false)
    return TOOL_STATUS_COLORS.error;
  return TOOL_STATUS_COLORS.idle;
};

/**
 * 一条助手消息在时间线上的**聚合**状态（spec ui/message-rendering-system.md
 * 「时间线圆点按助手回合出现（行级）」场景 2）：一条消息只有一个圆点，块各自
 * 的状态先聚合成一档，不允许同一行里两个点各自变色。
 *
 * 优先级（高 → 低）：流式中 > 执行中 > 失败 > 未知 > 已完成。
 * 进行中再分流式（橙）/ 执行（蓝）两档，是为了保留块级时代已有的观感——它们
 * 对用户是同一个「进行中」，只是先后出现的子阶段。
 *
 * 「进行中」压过「失败」是对齐 CC 扩展 2.1.330 的判据（webview/index.js 的
 * `MPn`：`NPt(e,t)!==null || thinkingStreaming || agentCallRunning` → progress，
 * 否则才看 `errorCount>0` → failure）。差别只在瞬时窗口：一个回合里已经有块失败了、
 * 但还有块在跑，此时圆点仍表示「还在进行」；回合落定后才变红。反过来（失败优先）
 * 会让一个正在继续跑的回合看起来已经结束。
 */
export function getMessageTimelineStatus(blocks: MessageBlock[]): {
  color: string;
  running: boolean;
} {
  let streaming = false;
  let running = false;
  let failed = false;
  let unknown = false;
  let hasCompact = false;
  let hasPlainContent = false;

  for (const block of blocks) {
    switch (block.type) {
      case "compact":
        hasCompact = true;
        break;
      case "text":
      case "reasoning":
        // 空块不渲染（判据同 timelineBlocks.blockRendersContent），也就不参与聚合。
        if (!(block.content || "").trim()) break;
        hasPlainContent = true;
        if (block.stage === "streaming") streaming = true;
        break;
      case "tool": {
        hasPlainContent = true;
        const stage = block.stage;
        if (stage === "start" || stage === "streaming") streaming = true;
        else if (stage === "running") running = true;
        else if (block.error || block.success === false) failed = true;
        else if (block.success !== true) unknown = true;
        break;
      }
      default:
        break;
    }
  }

  if (streaming) return { color: TOOL_STATUS_COLORS.streaming, running: true };
  if (running) return { color: TOOL_STATUS_COLORS.running, running: true };
  if (failed) return { color: TOOL_STATUS_COLORS.error, running: false };
  if (unknown) return { color: TOOL_STATUS_COLORS.idle, running: false };
  if (!hasPlainContent && hasCompact) {
    // 只有压缩块的消息：与块内 .compact-dot 同一个链接色。
    return {
      color:
        "var(--vscode-textLink-foreground, var(--vscode-descriptionForeground))",
      running: false,
    };
  }
  return { color: TOOL_STATUS_COLORS.success, running: false };
}
