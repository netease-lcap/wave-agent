import React from "react";
import { Box, Text } from "ink";

export interface NotificationsProps {
  latestTotalTokens?: number;
  maxInputTokens?: number;
  showLoginHint?: boolean;
  /**
   * 一次性中性提示（插件变更待应用 / 重载完成）。由宿主显式设置并在数秒后清除，
   * 不提供持久可见标识（docs/specs/ecosystem/plugin.md「插件变更提示」）。
   */
  pluginHint?: string | null;
}

export const Notifications: React.FC<NotificationsProps> = ({
  latestTotalTokens = 0,
  maxInputTokens = 200000,
  showLoginHint = false,
  pluginHint = null,
}) => {
  const percentage =
    latestTotalTokens > 0
      ? Math.min(Math.round((latestTotalTokens / maxInputTokens) * 100), 100)
      : 0;

  const contextColor =
    percentage > 95 ? "red" : percentage > 80 ? "yellow" : "gray";

  return (
    <Box gap={1}>
      {pluginHint && <Text color="gray">{pluginHint}</Text>}
      {showLoginHint && <Text color="gray">Type /login to authenticate</Text>}
      {percentage > 0 && (
        <Text color={contextColor}>{percentage}% context</Text>
      )}
    </Box>
  );
};
