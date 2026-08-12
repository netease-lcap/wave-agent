import React, { useEffect } from "react";
import type { UpdateToast } from "../types";
import "../styles/ToastStack.css";

interface ToastStackProps {
  toasts: UpdateToast[];
  onDismiss: (id: string) => void;
  onAction: (toast: UpdateToast) => void;
}

/** How long a button-less toast stays up before auto-dismissing (ms). */
const AUTO_DISMISS_MS = 8000;

/** One VS Code-style toast: message text + optional action button + close. */
const Toast: React.FC<{
  toast: UpdateToast;
  onDismiss: (id: string) => void;
  onAction: (toast: UpdateToast) => void;
}> = ({ toast, onDismiss, onAction }) => {
  // Informational toasts (no action) disappear on their own; actionable ones
  // stay until the user acts or closes them.
  useEffect(() => {
    if (toast.action) return;
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.action, onDismiss]);

  return (
    <div className="toast" role="status" data-testid="toast">
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel && toast.action && (
        <button className="toast-action" onClick={() => onAction(toast)}>
          {toast.actionLabel}
        </button>
      )}
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭"
      >
        <i className="codicon codicon-close"></i>
      </button>
    </div>
  );
};

/** Bottom-right stacked toast container (VS Code notification style). */
export const ToastStack: React.FC<ToastStackProps> = ({
  toasts,
  onDismiss,
  onAction,
}) => {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
    </div>
  );
};
