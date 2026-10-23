import React, { useEffect, useRef, useState } from "react";
import "../styles/SessionRenameDialog.css";

export interface SessionRenameResult {
  ok: boolean;
  error?: string;
}

interface SessionRenameDialogProps {
  /** 打开弹窗时的会话标题：输入框预填它并全选。 */
  title: string;
  /** 保存回调；返回失败时弹窗不关闭，错误就地显示在输入框下方。 */
  onSave: (next: string) => Promise<SessionRenameResult>;
  onCancel: () => void;
}

/**
 * 会话重命名弹窗（居中模态）：预填当前会话名并全选，保存即改写该行标题。
 *
 * 为什么是模态而不是行内编辑：会话行只有 36px 高、标题还带省略号，行内输入框
 * 塞不下完整标题；模态里有足够宽度展示长名，也才能把「名称不能为空」的提示
 * 放在输入框下面（行内没有位置）。
 */
export const SessionRenameDialog: React.FC<SessionRenameDialogProps> = ({
  title,
  onSave,
  onCancel,
}) => {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  // 保存中：挡住 Enter 连打与按钮连点，避免同一次改名发两条请求。
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 自动聚焦 + 内容全选：改名的常见动作是「整段替换」。
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (saving) return;
    const next = draft.trim();
    // 纯空格视为空：不予保存，就地提示（弹窗保持打开，用户可直接改）。
    if (!next) {
      setError("会话名称不能为空");
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    // 成功由调用方关弹窗；失败把宿主的失败原因留在弹窗里。
    if (!result.ok) setError(result.error ?? "重命名失败");
  };

  return (
    <div
      className="session-rename-overlay"
      data-testid="session-rename-overlay"
    >
      <div
        className="session-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="重命名"
        data-testid="session-rename-dialog"
      >
        <div className="session-rename-title">重命名</div>
        {/* 1023 评论（她：「报错的间距远了点」+ 参考
            `form-colors-review` 页里「校验错误」那一组的间距）⇒ 输入框与它下面那行
            错误提示合成一组，组内 4px、组与标题/页脚仍是弹层的 14px 节奏。
            改前错误行直接挂在弹层 flex 列里 ⇒ 与字段之间整整 14px，看起来像两条
            不相干的元素；参考件里字段底到说明行盒顶是 4.5px（12/20 行高，
            本弹窗错误行是 12/16 ⇒ 实际墨迹间距 5px，与参考件差 0.5px）。 */}
        <div className="session-rename-field">
          <input
            ref={inputRef}
            className="session-rename-input"
            data-testid="session-rename-input"
            value={draft}
            aria-label="会话名称"
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              // 重新输入即清掉上一次的校验提示。
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              // 焦点在输入框内：按键不外泄给侧栏的行级快捷键。
              e.stopPropagation();
              // 组合输入中的 Enter 是「上屏」，不是保存。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
          {error && (
            <div
              className="session-rename-error"
              role="alert"
              data-testid="session-rename-error"
            >
              {error}
            </div>
          )}
        </div>
        <div className="session-rename-actions">
          <button
            type="button"
            className="session-rename-btn session-rename-btn--ghost"
            data-testid="session-rename-cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="session-rename-btn session-rename-btn--primary"
            data-testid="session-rename-save"
            disabled={saving}
            onClick={() => void submit()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionRenameDialog;
