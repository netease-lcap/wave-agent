import React, { useEffect, useRef } from "react";
import "../styles/TranscriptFindBar.css";

export interface TranscriptFindState {
  query: string;
  /** 1-based；0 表示还没定位到任何命中。 */
  current: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const EMPTY_TRANSCRIPT_FIND: TranscriptFindState = {
  query: "",
  current: 0,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface TranscriptFindBarProps {
  find: TranscriptFindState;
  /** 全部命中数（跨整个会话，含虚拟列表未挂载的行）。 */
  total: number;
  /** 表达式编译失败时的可读提示（正则写错）。 */
  error?: string;
  onQueryChange: (query: string) => void;
  onStep: (delta: number) => void;
  onToggle: (key: "caseSensitive" | "wholeWord" | "regex") => void;
  onClose: () => void;
}

// 三个开关的文案与快捷键提示，与文件面板查找条同形（spec
// ui/transcript-find.md 场景 10）。
const TOGGLES = [
  ["caseSensitive", "case", "Aa", "区分大小写"],
  ["wholeWord", "word", "ab", "整词匹配"],
  ["regex", "regex", ".*", "正则表达式"],
] as const;

/**
 * 会话内查找浮层（spec ui/transcript-find.md）。
 *
 * 零占位的悬浮条：`.messages-column` 是虚拟列表的定位父级，进来的流内元素会
 * 改变 spacer 以上的高度，把整张表的绝对坐标推下去，所以这层与吸顶条同法——
 * sticky + height: 0，视觉上浮在右上角，布局上不存在。
 */
export const TranscriptFindBar: React.FC<TranscriptFindBarProps> = ({
  find,
  total,
  error,
  onQueryChange,
  onStep,
  onToggle,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const current = total === 0 ? 0 : Math.min(Math.max(find.current, 1), total);
  const countText = error
    ? error
    : total === 0
      ? find.query
        ? "无匹配结果"
        : "0/0"
      : `${current}/${total}`;

  return (
    <div className="transcript-find-slot">
      <div
        className="transcript-find"
        role="search"
        aria-label="在会话内查找"
        data-testid="transcript-find"
      >
        <input
          ref={inputRef}
          className="transcript-find-input"
          data-testid="transcript-find-input"
          placeholder="在会话内查找…"
          aria-label="查找关键字"
          value={find.query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <span
          className={`transcript-find-count${error ? " transcript-find-count--error" : ""}`}
          data-testid="transcript-find-count"
          aria-live="polite"
        >
          {countText}
        </span>
        <button
          type="button"
          className="transcript-find-btn"
          data-testid="transcript-find-prev"
          aria-label="上一个匹配"
          title="上一个匹配（Shift+Enter）"
          onClick={() => onStep(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="transcript-find-btn"
          data-testid="transcript-find-next"
          aria-label="下一个匹配"
          title="下一个匹配（Enter）"
          onClick={() => onStep(1)}
        >
          ↓
        </button>
        {TOGGLES.map(([key, testId, label, title]) => (
          <button
            key={key}
            type="button"
            title={title}
            className={`transcript-find-btn${find[key] ? " active" : ""}`}
            data-testid={`transcript-find-${testId}`}
            aria-pressed={find[key]}
            aria-label={title}
            onClick={() => onToggle(key)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="transcript-find-btn"
          data-testid="transcript-find-close"
          aria-label="关闭查找"
          title="关闭（Esc）"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
};
