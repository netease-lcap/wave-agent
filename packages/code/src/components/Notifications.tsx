import React from "react";
import { Box, Text } from "ink";
import { remainingPercentOf } from "../remote/remoteNotifications.js";

export interface NotificationsProps {
  latestTotalTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  showLoginHint?: boolean;
  /**
   * 一次性中性提示（插件变更待应用 / 重载完成 / 私有化未授权拦截）。由宿主显式
   * 设置并在数秒后清除，不提供持久可见标识（docs/specs/ecosystem/plugin.md
   * 「插件变更提示」、docs/specs/enterprise/server-managed-config.md「私有化未授权
   * 时给出一次性提示」）。多个来源共用这一个槽位：谁最后设置谁显示。
   */
  hint?: string | null;
  /**
   * 插件贴的持久状态（`$.ui.status(...)`）：`插件名: 文本`，多个用 ` · ` 并排，
   * 超出的收成 `+N`。由 `InputBox` 拼好传入（docs/specs/ecosystem/plugin-mods.md
   * 「状态带、状态行与提示」）。
   */
  modStatus?: string | null;
}

export const Notifications: React.FC<NotificationsProps> = ({
  latestTotalTokens = 0,
  contextWindow = 200000,
  maxOutputTokens = 32000,
  showLoginHint = false,
  hint = null,
  modStatus = null,
}) => {
  // 剩余百分比（分母 = 自动压缩阈值，与图形界面的窗口分母不是一个口径 —— 见
  // docs/specs/ui/notifications.md）。术语照抄 Claude Code 的 CLI：句子里带
  // 「until auto-compact」，用户不会把 76% 读成「窗口用了 76%」。
  const remaining =
    latestTotalTokens > 0 && contextWindow > 0
      ? remainingPercentOf(latestTotalTokens, contextWindow, maxOutputTokens)
      : undefined;

  // 颜色仍按「已用」分档（剩余 5% / 20% 即原 95% / 80%），水位语义不变。
  const usedPercent = remaining === undefined ? 0 : 100 - remaining;
  const contextColor =
    usedPercent > 95 ? "red" : usedPercent > 80 ? "yellow" : "gray";

  return (
    <Box gap={1}>
      {modStatus && <Text color="gray">{modStatus}</Text>}
      {hint && <Text color="gray">{hint}</Text>}
      {showLoginHint && <Text color="gray">Type /login to authenticate</Text>}
      {remaining !== undefined && (
        <Text color={contextColor}>
          {remaining > 0
            ? `${remaining}% until auto-compact`
            : "auto-compact next"}
        </Text>
      )}
    </Box>
  );
};
