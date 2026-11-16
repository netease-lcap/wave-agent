import React from "react";
import { Box, Text } from "ink";
import { percentOf } from "../remote/remoteNotifications.js";

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
}

export const Notifications: React.FC<NotificationsProps> = ({
  latestTotalTokens = 0,
  contextWindow = 200000,
  maxOutputTokens = 32000,
  showLoginHint = false,
  hint = null,
}) => {
  const percentage =
    latestTotalTokens > 0
      ? percentOf(latestTotalTokens, contextWindow, maxOutputTokens)
      : 0;

  const contextColor =
    percentage > 95 ? "red" : percentage > 80 ? "yellow" : "gray";

  return (
    <Box gap={1}>
      {hint && <Text color="gray">{hint}</Text>}
      {showLoginHint && <Text color="gray">Type /login to authenticate</Text>}
      {percentage > 0 && (
        <Text color={contextColor}>{percentage}% context</Text>
      )}
    </Box>
  );
};
