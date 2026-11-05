import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessageActionButton } from "./MessageActionButton";
import { copyToClipboard } from "../utils/clipboard";
import { markdownToClipboardHtml } from "../utils/messageCopyText";

/** 复制成功后对勾停留多久（spec: 复制按钮场景 5）。 */
export const COPY_FEEDBACK_MS = 1500;

/**
 * 助手消息右上角那颗复制按钮（spec: ui/message-rendering-system.md「助手消息的
 * 复制按钮」）。
 *
 * 它**不是**另一种形态的按钮：位置、底色、圆角、hover 显隐、tooltip 全部复用
 * 右上角那组动作按钮（回滚 / 转后台）的 `MessageActionButton`——三颗按钮是同一类
 * 动作，长一样、显隐时机也一样（悬停该消息才出现，触控档由 tap 建立粘滞悬停）。
 *
 * 与那两颗唯一不同的是**按下之后**的反馈：图标由 `copy` 换成 `check`、可访问名
 * 换成「已复制」，1.5s 后自己回来；两条复制路径都失败时**不给**成功反馈。
 */
export const MessageCopyButton: React.FC<{
  /** 这条消息可复制的正文（由 `assistantCopyText` 算好传进来）。 */
  text: string;
}> = ({ text }) => {
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

  return (
    <>
      <MessageActionButton
        icon={copied ? "check" : "copy"}
        label={label}
        testId="assistant-copy"
        onClick={handleCopy}
      />
      {/* 读屏的播报口：图标本身不承载状态，状态由这一行说出去。 */}
      <span role="status" className="message-copy-status">
        {copied ? "已复制" : ""}
      </span>
    </>
  );
};
