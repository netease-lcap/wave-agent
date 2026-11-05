import React, { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import { copyToClipboard } from "../utils/clipboard";
import { markdownToClipboardHtml } from "../utils/messageCopyText";
import { formatMessageTime } from "../utils/messageTime";
import "../styles/Message.css";

/** 复制成功后对勾停留多久（spec: 复制按钮场景 5）。 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * 助手消息底部的动作行（spec: ui/message-rendering-system.md「助手消息底部的
 * 复制按钮」与「助手消息底部的时间戳」，对齐 claude.ai 桌面端 `MessageActions`
 * 里的 `CopyAction` / `Timestamp`）。
 *
 * 三件事与右上角那组按钮（回滚 / 转后台）刻意不同：
 *
 * 1. **位置**：在正文之后的正常文档流里、左对齐，不叠在内容上；
 * 2. **显隐**：动作行**始终占位**，只切换行内元素 —— 最后一条消息上常驻可见，
 *    历史消息悬停 / 键盘聚焦才显现，两种状态下都不会在悬停时把下面的内容顶走；
 * 3. **反馈**：复制成功后图标由 `copy` 换成 `check`、可访问名换成「已复制」，
 *    1.5s 后自己回来；两条复制路径都失败时**不给**成功反馈。
 */
export const AssistantMessageActions: React.FC<{
  /** 这条消息可复制的正文（由 `assistantCopyText` 算好传进来）。 */
  text: string;
  /** 消息时间戳（原始 ISO 串）；缺失或解析不了就不显示时间。 */
  timestamp?: string;
  /** 最后一条消息上常驻可见；历史消息悬停才显现。 */
  alwaysVisible?: boolean;
}> = ({ text, timestamp, alwaysVisible }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // 富文本那份在点击时才渲染：每条历史消息都预先 parse 一遍 Markdown 是白烧 CPU
  // （列表里绝大多数消息永远不会被点复制）。降级路径由 `copyToClipboard` 负责——
  // 写不了 html 就只写纯文本，仍然算成功。
  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard({
      text,
      html: markdownToClipboardHtml(text),
    });
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [text]);

  const label = copied ? "已复制" : "复制";
  const time = formatMessageTime(timestamp);

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
      {time && (
        // 右端对齐落在 **Tooltip 的外层 span** 上（`margin-left: auto` 只对 flex
        // 子项生效，而 `<time>` 被包在 span 里面）——写在 time 上不起作用。
        <Tooltip
          text={time.full}
          position="bottom"
          className="message-action-time-slot"
        >
          <time className="message-action-time" dateTime={time.iso}>
            {time.label}
          </time>
        </Tooltip>
      )}
    </div>
  );
};
