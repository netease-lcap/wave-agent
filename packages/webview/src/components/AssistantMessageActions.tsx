import React, { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import { copyTextToClipboard } from "../utils/clipboard";
import "../styles/Message.css";

/** 复制成功后对勾停留多久（spec: 复制按钮场景 5）。 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * 助手消息底部的动作行（spec: ui/message-rendering-system.md「助手消息底部的
 * 复制按钮」，对齐 claude.ai 桌面端 `MessageActions` 里的 `CopyAction`）。
 *
 * 三件事与右上角那组按钮（回滚 / 转后台）刻意不同：
 *
 * 1. **位置**：在正文之后的正常文档流里、左对齐，不叠在内容上；
 * 2. **显隐**：动作行**始终占位**，只切换按钮本身 —— 最后一条消息上常驻可见，
 *    历史消息悬停 / 键盘聚焦才显现，两种状态下都不会在悬停时把下面的内容顶走；
 * 3. **反馈**：复制成功后图标由 `copy` 换成 `check`、可访问名换成「已复制」，
 *    1.5s 后自己回来；两条复制路径都失败时**不给**成功反馈。
 */
export const AssistantMessageActions: React.FC<{
  /** 这条消息可复制的正文（由 `assistantCopyText` 算好传进来）。 */
  text: string;
  /** 最后一条消息上常驻可见；历史消息悬停才显现。 */
  alwaysVisible?: boolean;
}> = ({ text, alwaysVisible }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [text]);

  const label = copied ? "已复制" : "复制";

  return (
    <div
      className="assistant-message-actions"
      data-always-visible={alwaysVisible ? "true" : undefined}
      data-testid="assistant-message-actions"
    >
      <Tooltip text={label} position="bottom">
        <button
          type="button"
          className="message-copy-btn"
          aria-label={label}
          data-testid="assistant-copy"
          data-copied={copied ? "true" : undefined}
          onClick={handleCopy}
        >
          <i className={`codicon codicon-${copied ? "check" : "copy"}`}></i>
        </button>
      </Tooltip>
      {/* 读屏的播报口：图标本身不承载状态，状态由这一行说出去。 */}
      <span role="status" className="message-copy-status">
        {copied ? "已复制" : ""}
      </span>
    </div>
  );
};
