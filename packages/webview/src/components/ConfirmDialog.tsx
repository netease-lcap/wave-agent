import React, { useEffect, useRef } from "react";
import "../styles/ConfirmDialog.css";

export interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Block confirmation while the action's consequences are still unknown
   *  (e.g. counting what deleting a worktree would destroy). Cancel stays
   *  available so the dialog is never a dead end. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered modal dialog for destructive-action confirmation (Figma 2294:1496).
 * Esc = cancel, Enter = confirm; clicking the scrim does NOT dismiss.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  // Whether the primary action was un-actionable on the previous render.
  const wasConfirmDisabledRef = useRef(confirmDisabled);

  // Focus the primary action. `autoFocus` only applies at mount, so a dialog
  // that opens with the confirm button disabled (the worktree loss check is
  // still in flight — see DesktopSidebar) would never take focus: the sidebar
  // row that opened it keeps focus, and Enter there re-opens that row's menu
  // instead of confirming. Once the button becomes actionable we pull focus in
  // — unless the user already moved it inside the dialog (e.g. Tabbed to
  // Cancel), which must not be yanked away.
  useEffect(() => {
    const becameActionable = wasConfirmDisabledRef.current && !confirmDisabled;
    wasConfirmDisabledRef.current = confirmDisabled;
    if (!becameActionable) return;
    if (dialogRef.current?.contains(document.activeElement)) return;
    confirmBtnRef.current?.focus();
  }, [confirmDisabled]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        // A focused button fires its own click on Enter — let it win. A
        // disabled confirm button cannot hold focus, so Enter reaches this
        // branch and must be ignored explicitly.
        if (document.activeElement instanceof HTMLButtonElement) return;
        if (confirmDisabled) return;
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel, confirmDisabled]);

  return (
    <div
      className="confirm-dialog-overlay"
      data-testid="confirm-dialog-overlay"
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="confirm-dialog-message-row">
          <i
            className="codicon codicon-warning confirm-dialog-icon"
            aria-hidden="true"
          ></i>
          <div className="confirm-dialog-message-content">
            <div className="confirm-dialog-title">{title}</div>
            {description && (
              <div className="confirm-dialog-description">{description}</div>
            )}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="confirm-dialog-confirm"
            disabled={confirmDisabled}
            onClick={onConfirm}
            autoFocus={!confirmDisabled}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
