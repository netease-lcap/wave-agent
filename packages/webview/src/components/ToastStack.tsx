import React, { useEffect, useLayoutEffect, useState } from "react";
import type { ToastKind, UpdateToast } from "../types";
import { CloseIcon } from "./HeaderIcons";
import "../styles/ToastStack.css";

/**
 * 语义图标（**仅顶部位置的 app 级 toast 渲染**）：16px 描边圆 + 内部笔画，
 * stroke 1.4 与 wave 官方工具图标同规格。成功=对勾 / 失败=× / 信息=i（对齐
 * codex toast 的描边圆勾样式）。**无类型（中性）不渲染图标**——没有成功/失败
 * 语义时圆勾/叉都不合适，只出文字。图标仅 toast 使用，按 skill icon policy
 * 「单次用途 keep local」内嵌本组件。
 */
const ToastGlyph: React.FC<{ kind: ToastKind }> = ({ kind }) => (
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
  /** 定位锚点（**只作用于顶部 toast 栈**）：toast 条水平居中于该选择器容器的
   *  中心（如设置页内容列 / 桌面工作区），缺省回退视口水平中心。传 null 时
   *  始终回退视口中心。右下角栈固定定位，不使用锚点。 */
  anchorSelector?: string | null;
}

/**
 * How long a button-less toast stays up before auto-dismissing (ms). ~1s:
 * informational toasts are fleeting (spec「账户卡片」场景 7); actionable toasts
 * never auto-dismiss.
 */
const AUTO_DISMISS_MS = 1000;

/**
 * One toast row. `position` selects the visual family (from the toast's explicit
 * `position` field, never inferred from the presence of an action):
 * - `"top"` — 应用级全局提示：桌面端顶部居中形态，语义图标 + 可选中性 / 彩色底；
 * - `"bottomRight"` — 后台会话确认提示：VS Code 风格右下角通知（保持改动前
 *   形态），仅 loading 时出 spinner、不渲染语义图标。
 */
const Toast: React.FC<{
  toast: UpdateToast;
  position: "top" | "bottomRight";
  onDismiss: (id: string) => void;
  onAction: (toast: UpdateToast) => void;
}> = ({ toast, position, onDismiss, onAction }) => {
  // Informational toasts (no action) disappear on their own; actionable ones
  // stay until the user acts or closes them.
  useEffect(() => {
    if (toast.action) return;
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.action, onDismiss]);

  const isTop = position === "top";
  // 语义色只标在顶部（app 级）toast 上；无 type = 中性（不套语义类）。
  const kindClass = isTop && toast.type ? ` toast--${toast.type}` : "";
  return (
    <div
      className={`toast toast--${position}${kindClass}`}
      role="status"
      data-testid="toast"
    >
      {toast.loading ? (
        <span className="toast-spinner" aria-hidden="true" />
      ) : isTop && toast.type ? (
        <ToastGlyph kind={toast.type} />
      ) : null}
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

/** 锚点容器中心 x（顶部 toast 栈专用）：容器尺寸/出现变化时随 ResizeObserver
 *  更新；缺省（无锚点/无顶部 toast）交给 CSS left:50% 回退视口中心。 */
function useAnchorCenterX(
  anchorSelector: string | null | undefined,
  active: boolean,
): number | null {
  const [centerX, setCenterX] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active || !anchorSelector) {
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
  }, [active, anchorSelector]);
  return centerX;
}

/**
 * In-app toast host. Two separate stacks rendered side by side, grouped by the
 * toast's explicit `position` (2026-09-10 拍板):
 * - `"top"`（缺省）→ `.toast-stack--top`：顶部居中新形态（应用级全局提示）；
 * - `"bottomRight"` → `.toast-stack--bottomRight`：既有右下角通知形态（后台会话
 *   确认提示），两栈可同屏共存、各自定位与动效互不干扰。
 */
export const ToastStack: React.FC<ToastStackProps> = ({
  toasts,
  onDismiss,
  onAction,
  anchorSelector,
}) => {
  const bottomRightToasts = toasts.filter((t) => t.position === "bottomRight");
  const topToasts = toasts.filter((t) => t.position !== "bottomRight");
  const topCenterX = useAnchorCenterX(anchorSelector, topToasts.length > 0);

  if (bottomRightToasts.length === 0 && topToasts.length === 0) return null;
  return (
    <>
      {bottomRightToasts.length > 0 && (
        <div
          className="toast-stack toast-stack--bottomRight"
          data-testid="toast-stack--bottomRight"
        >
          {bottomRightToasts.map((toast) => (
            <Toast
              key={toast.id}
              toast={toast}
              position="bottomRight"
              onDismiss={onDismiss}
              onAction={onAction}
            />
          ))}
        </div>
      )}
      {topToasts.length > 0 && (
        <div
          className="toast-stack toast-stack--top"
          data-testid="toast-stack--top"
          style={topCenterX !== null ? { left: topCenterX } : undefined}
        >
          {topToasts.map((toast) => (
            <Toast
              key={toast.id}
              toast={toast}
              position="top"
              onDismiss={onDismiss}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </>
  );
};
