import React, { useEffect, useRef } from "react";
import "../styles/LineCommentBox.css";

export interface LineCommentBoxProps {
  /** Controlled draft text. */
  draft: string;
  onDraftChange: (value: string) => void;
  /** Enter (without Shift) or the 「添加」 button; a blank draft does nothing. */
  onSubmit: () => void;
  /** Esc or the 「取消」 button. */
  onCancel: () => void;
  /** Right-aligned context in the footer — the commented file's path. */
  tag?: string;
  placeholder?: string;
}

/**
 * Inline comment box rendered under the commented line, shared by the diff
 * pane and the file pane so the two cannot drift apart. Purely presentational:
 * the caller owns the draft, the open line and the append-to-input action —
 * neither pane keeps the submitted comment around (it lands in the chat input).
 */
export const LineCommentBox: React.FC<LineCommentBoxProps> = ({
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  tag,
  placeholder = "评论这行…",
}) => {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // The box is mounted per opened line, so mounting is the moment to focus it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="line-comment-box" data-testid="line-comment-box">
      <textarea
        ref={inputRef}
        className="line-comment-input"
        data-testid="line-comment-input"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          // IME composing (e.g. Chinese pinyin): Enter confirms the candidate,
          // not a submit. keyCode 229 covers older engines where isComposing
          // is unset.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="line-comment-box-footer">
        <span className="line-comment-box-tag" title={tag ?? ""}>
          {tag}
        </span>
        <button
          className="line-comment-box-cancel"
          data-testid="line-comment-cancel"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="line-comment-box-send"
          title="添加到输入框"
          data-testid="line-comment-submit"
          disabled={draft.trim() === ""}
          onClick={onSubmit}
        >
          添加
        </button>
      </div>
    </div>
  );
};

export default LineCommentBox;
