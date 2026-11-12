import React, { useEffect, useLayoutEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { BtwTurn } from "../utils/sessionUiStore";
import { streamingTail } from "../utils/streamingText";
import { CloseIcon, QueueTrashIcon } from "./HeaderIcons";
import "../styles/BtwPanel.css";

interface BtwPanelProps {
  /** 已发生的每一轮（含正在回答的那轮）。空数组 = 只有空态说明。 */
  turns: BtwTurn[];
  /** 面板输入框的草稿（随会话保存，切换对话再回来还在）。 */
  draft: string;
  onDraftChange: (value: string) => void;
  /** 提交一句新问题（多轮追问走同一条路径）。 */
  onSubmit: (question: string) => void;
  /** 清空侧聊：移除全部轮次（在途答案此后不再落回）。 */
  onClear: () => void;
  onClose: () => void;
}

// Escape closes only the panel (spec scenario 8/9). A capture-phase listener
// with stopPropagation runs before React's synthetic onKeyDown (attached at
// the root container), so the keypress never reaches MessageInput's
// onAbortMessage and the in-flight agent loop keeps running.
const renderMarkdown = (content: string): string => {
  const html = marked.parse(content, { gfm: true, breaks: true });
  const sanitized = DOMPurify.sanitize(html as string, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "hr",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "del",
    ],
    ALLOWED_ATTR: ["href", "title", "align", "src", "alt"],
    ALLOW_DATA_ATTR: false,
  });
  return typeof sanitized === "string" ? sanitized : "";
};

/** 列表离底部多近算「仍停在底部」（behaviour 见 spec 场景 5）。 */
const NEAR_BOTTOM_PX = 48;

export const BtwPanel: React.FC<BtwPanelProps> = ({
  turns,
  draft,
  onDraftChange,
  onSubmit,
  onClear,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  /** 打开面板时没能送出去的那次聚焦（见下面的 effect）。 */
  const pendingFocusRef = useRef(false);

  const isLoading = turns.some((turn) => turn.loading);
  const latestQuestion =
    turns.length > 0 ? turns[turns.length - 1].question : "";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // 打开面板就把光标放进面板输入框：提问入口在这里，不该逼用户先点一下
  // （对齐 CC 桌面端 Side chat：它打开侧聊时也是先把焦点放进追问输入框）。
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.disabled) pendingFocusRef.current = true;
    else input.focus();
  }, []);

  // 首问在途时输入框是禁用的，上面那次聚焦会落空——禁用控件拿不到焦点，光标
  // 留在主输入框，用户接着打字就变成一条主对话消息。所以等它恢复可用的这一刻
  // 补上（CC 靠时序躲过同一件事：它在把状态置成 thinking 之前就聚焦，之后再转
  // 禁用并不会夺走已经到手的焦点）。补之前先看用户有没有自己动过手——焦点落到
  // 面板外、或在面板外按键，都算「他在别处干活」，那就别再抢。
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const input = inputRef.current;
    if (input && !input.disabled) {
      pendingFocusRef.current = false;
      input.focus();
      return;
    }
    const cancel = (event: Event) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      pendingFocusRef.current = false;
    };
    document.addEventListener("focusin", cancel, true);
    document.addEventListener("keydown", cancel, true);
    return () => {
      document.removeEventListener("focusin", cancel, true);
      document.removeEventListener("keydown", cancel, true);
    };
  }, [isLoading]);

  // 「清空侧聊」之后焦点回到输入框（spec 场景 6）：清空前若在等答案，输入框
  // 是 disabled 的，点下按钮那一刻还 focus 不上，所以等轮次清空之后再补。
  const previousTurnCount = useRef(turns.length);
  useEffect(() => {
    if (previousTurnCount.current > 0 && turns.length === 0)
      inputRef.current?.focus();
    previousTurnCount.current = turns.length;
  }, [turns.length]);

  // 新的一轮出现 / 答案增长时贴到底部，除非用户已经上滚看旧轮次
  // （spec「Webview 端继续提问」场景 5）。
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const question = draft.trim();
    if (!question || isLoading) return;
    onSubmit(question);
  };

  return (
    <div className="btw-panel" data-testid="btw-panel" ref={panelRef}>
      <div className="btw-panel-header">
        {/* The prefix is always rendered so the header keeps a title and the
            close button stays on the right even for a bare `/btw` (spec
            scenario 3). */}
        <span className="btw-panel-prefix">/btw </span>
        <span className="btw-panel-question" data-testid="btw-panel-question">
          {latestQuestion}
        </span>
        {turns.length > 0 && (
          <button
            className="btw-panel-icon-btn"
            onClick={onClear}
            aria-label="清空侧聊"
            title="清空侧聊"
            data-testid="btw-panel-clear"
          >
            <QueueTrashIcon className="btw-panel-icon" />
          </button>
        )}
        <button
          className="btw-panel-close"
          onClick={onClose}
          aria-label="关闭"
          data-testid="btw-panel-close"
        >
          <CloseIcon className="btw-panel-close-icon" />
        </button>
      </div>
      <div
        className="btw-panel-turns"
        ref={listRef}
        data-testid="btw-turns"
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        }}
      >
        {turns.length === 0 && (
          <div className="btw-panel-empty" data-testid="btw-panel-empty">
            {"用法：/btw <你的问题>"}
          </div>
        )}
        {turns.map((turn) => (
          <div className="btw-turn" key={turn.requestId} data-testid="btw-turn">
            <div className="btw-turn-question" data-testid="btw-turn-question">
              {turn.question}
            </div>
            {turn.loading ? (
              <div
                className="btw-panel-loading"
                data-testid="btw-panel-loading"
              >
                <span className="btw-loading-indicator">▋</span>
                <span className="btw-loading-text">正在回答</span>
                {turn.answer && (
                  <span
                    className="btw-loading-tail"
                    data-testid="btw-loading-tail"
                  >
                    {streamingTail(turn.answer)}
                  </span>
                )}
              </div>
            ) : (
              <div
                className="btw-panel-answer"
                data-testid="btw-panel-answer"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(turn.answer),
                }}
              />
            )}
          </div>
        ))}
      </div>
      {/* 面板不放发送键：一条 Enter 就能发，再挂一颗箭头按钮既与主输入框
          那颗撞款，单独摆着也像多余的装饰（spec「Webview 端继续提问」场景 1
          把发送方式写进占位文案）。 */}
      <div className="btw-panel-input-row">
        <textarea
          ref={inputRef}
          className="btw-panel-input"
          data-testid="btw-panel-input"
          rows={1}
          value={draft}
          disabled={isLoading}
          placeholder={
            turns.length > 0
              ? "继续提问，Enter 发送"
              : "问个临时问题，Enter 发送"
          }
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </div>
  );
};

export default BtwPanel;
