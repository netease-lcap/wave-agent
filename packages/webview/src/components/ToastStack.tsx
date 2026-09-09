import React, { useEffect, useLayoutEffect, useState } from "react";
import type { ToastKind, UpdateToast } from "../types";
import { CloseIcon } from "./HeaderIcons";
import "../styles/ToastStack.css";

/**
 * 语义图标：16px 描边圆 + 内部笔画，stroke 1.4 与 wave 官方工具图标同规格。
 * 成功=对勾 / 错误=× / 信息=i（对齐 codex toast 的描边圆勾样式）。图标仅
 * toast 使用，按 skill icon policy「单次用途 keep local」内嵌本组件。
 */
const ToastGlyph: React.FC<{ kind: Exclude<ToastKind, "info"> | "info" }> = ({
  kind,
}) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    className="toast-kind-icon"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
    {kind === "success" && (
      <path
        d="M5 8.35 7.05 10.4 11 5.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
    {kind === "error" && (
      <path
        d="M5.9 5.9 10.1 10.1M10.1 5.9 5.9 10.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    )}
    {kind === "info" && (
      <path
        d="M8 7.1V10.4M8 5.25V5.45"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    )}
  </svg>
);

interface ToastStackProps {
  toasts: UpdateToast[];
  onDismiss: (id: string) => void;
  onAction: (toast: UpdateToast) => void;
  /** 定位锚点：toast 条水平居中于该选择器容器的中心（如设置页内容列 /
   *  桌面工作区），缺省回退视口水平中心。传 null 时始终回退视口中心。 */
  anchorSelector?: string | null;
}

/**
 * How long a button-less toast stays up before auto-dismissing (ms). ~1s:
 * informational toasts are fleeting (spec「账户卡片」场景 7); actionable toasts
 * never auto-dismiss.
 */
const AUTO_DISMISS_MS = 1000;

/** Semantic toast (codex-style): kind icon + message text + optional action + close. */
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
    <div
      className={`toast toast--${toast.type ?? "info"}`}
      role="status"
      data-testid="toast"
    >
      {toast.loading ? (
        <span className="toast-spinner" aria-hidden="true" />
      ) : (
        <ToastGlyph kind={toast.type ?? "info"} />
      )}
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel && toast.action && !toast.loading && (
        <button className="toast-action" onClick={() => onAction(toast)}>
          {toast.actionLabel}
        </button>
      )}
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="关闭"
      >
        <CloseIcon className="toast-close-icon" />
      </button>
    </div>
  );
};

/** Top-center toast bar. 位置水平锚定由 anchorSelector 容器决定（右侧界面/内容列
 *  中心），保持 fixed 顶部展示，不随布局滚动。 */
export const ToastStack: React.FC<ToastStackProps> = ({
  toasts,
  onDismiss,
  onAction,
  anchorSelector,
}) => {
  // 锚点容器中心 x：设置页打开时 = 内容列中心（避开 240px 左导航），普通桌面
  // 模式 = 工作区中心（避开会话侧栏）。容器尺寸/出现变化时随 ResizeObserver
  // 更新；缺省（无锚点）交给 CSS left:50% 回退视口中心。
  const [centerX, setCenterX] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (toasts.length === 0 || !anchorSelector) {
      setCenterX(null);
      return;
    }
    const el = document.querySelector(anchorSelector);
    if (!el) {
      setCenterX(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setCenterX(Math.round(r.left + r.width / 2));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [toasts.length, anchorSelector]);

  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-stack"
      data-testid="toast-stack"
      style={centerX !== null ? { left: centerX } : undefined}
    >
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
