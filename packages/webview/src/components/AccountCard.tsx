import React, { useEffect, useRef, useState } from "react";
import type {
  AccountApiQuotaInfo,
  AccountPlanInfo,
  DesktopUpdateState,
} from "wave-webview-fixtures";
import { MoreMenu } from "./MoreMenu";
import "../styles/AccountCard.css";
import "../styles/ConfirmDialog.css";

/**
 * 桌面侧边栏账户卡片 (spec desktop-app.md「账户卡片」). The host pushes a
 * window-global `desktopAccountInfo` snapshot; the card renders a full-width
 * 登录 button when logged out, and an avatar/name hotzone + 更多 menu + update
 * button when logged in. Clicking the hotzone opens the usage popup (套餐用量
 * progress + API 额度); clicking 更多 opens the shared MoreMenu.
 */
export interface AccountCardAccount {
  isAuthenticated: boolean;
  user?: { id: string; email?: string } | null;
  plan?: AccountPlanInfo | null;
  apiQuota?: AccountApiQuotaInfo | null;
  update?: DesktopUpdateState | null;
}

interface AccountCardProps {
  account: AccountCardAccount | null;
  /** Remote hosts annotate the card (local leaves it blank). */
  hostLabel?: string;
  onLogin: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onOpenHelpDocs: () => void;
  onUpdateApp: () => void;
  onRestartApp: () => void;
}

/** Display name: email prefix, falling back to a neutral label. */
export function displayNameFor(
  user?: { id: string; email?: string } | null,
): string {
  const email = user?.email;
  if (email) {
    const at = email.indexOf("@");
    return at > 0 ? email.slice(0, at) : email;
  }
  return "已登录";
}

/** First character of the display name for the avatar circle. */
export function initialFor(name: string): string {
  return (name.trim()[0] ?? "U").toUpperCase();
}

/** 套餐余量百分比：max(0, round((1 − used/(monthlyQuota×months)) × 100)). */
export function planRemainingPercent(plan: AccountPlanInfo): number {
  const total = plan.monthlyQuota * plan.months;
  if (total <= 0) return 0;
  return Math.max(0, Math.round((1 - plan.used / total) * 100));
}

/** 金额两位小数 + 千位分隔（手写，避免 toLocaleString 的 Intl 环境差异）. */
export function formatAmount(value: number): string {
  const fixed = value.toFixed(2);
  const [intPart, fracPart] = fixed.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fracPart}`;
}

/**
 * API 额度文案（契约 issue #1986）：limit 为空=共用团队余额，used 为本人
 * 累计消耗金额 → 显示「已消耗 ¥x」；limit 为 0 视为已用完；否则剩余 ¥x。
 */
export function apiQuotaText(quota: AccountApiQuotaInfo): string {
  if (quota.limit === null) return `已消耗 ¥${formatAmount(quota.used)}`;
  const remaining = quota.limit - quota.used;
  if (remaining <= 0) return "已用完";
  return `剩余 ¥${formatAmount(remaining)}`;
}

/**
 * 更新确认弹窗（下载确认 / 重启确认共用）. Unlike ConfirmDialog there is NO
 * autoFocus and NO Enter-to-confirm: only Esc / the 取消 button close it, and
 * clicking the scrim does nothing (spec 场景 5「仅 Esc/取消可关闭」).
 */
const UpdateConfirmDialog: React.FC<{
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, description, confirmText, cancelText, onConfirm, onCancel }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="confirm-dialog-overlay"
      data-testid="account-update-dialog-overlay"
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="confirm-dialog-message-row">
          <i
            className="codicon codicon-cloud-download confirm-dialog-icon"
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
            data-testid="account-update-dialog-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="account-update-dialog-confirm"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  hostLabel,
  onLogin,
  onLogout,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onUpdateApp,
  onRestartApp,
}) => {
  const [showUsage, setShowUsage] = useState(false);
  const [usageAnchor, setUsageAnchor] = useState<DOMRect | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const hotzoneRef = useRef<HTMLDivElement | null>(null);
  // Only the downloading→ready transition auto-opens the restart confirm;
  // a ready state arriving from elsewhere (login push, restore replay) does not.
  const prevUpdateRef = useRef<DesktopUpdateState | null | undefined>(
    account?.update,
  );

  useEffect(() => {
    const next = account?.update ?? null;
    if (prevUpdateRef.current === "downloading" && next === "ready") {
      setShowRestartConfirm(true);
    }
    prevUpdateRef.current = next;
  }, [account?.update]);

  const isAuthenticated = account?.isAuthenticated === true;
  const name = displayNameFor(account?.user);
  const plan = account?.plan ?? null;
  const apiQuota = account?.apiQuota ?? null;
  const update = account?.update ?? null;

  // Click-outside + Escape close the usage popup (the MoreMenu owns its own).
  useEffect(() => {
    if (!showUsage) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target)) return;
      // The hotzone toggles itself (its onClick flips the popup) — let it win,
      // otherwise the mousedown close + click reopen double-fire keeps it open.
      if (hotzoneRef.current?.contains(target)) return;
      setShowUsage(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowUsage(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showUsage]);

  // 未登录：登录按钮 + 右侧「更多」按钮同行（对齐设计师原型）。
  if (!isAuthenticated) {
    return (
      <div
        className="account-card account-card--logged-out"
        data-testid="account-card"
      >
        <button
          type="button"
          className="account-card-login"
          data-testid="account-card-login"
          onClick={onLogin}
        >
          登 录
        </button>
        <button
          type="button"
          ref={moreBtnRef}
          className="account-card-more-btn"
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={showMenu}
          data-testid="account-card-more"
          onClick={(e) => {
            setMenuAnchor(e.currentTarget.getBoundingClientRect());
            setShowMenu((v) => !v);
          }}
        >
          <span className="codicon codicon-ellipsis" aria-hidden="true"></span>
        </button>
        {showMenu && menuAnchor && (
          <MoreMenu
            onOpenSettings={onOpenSettings}
            onOpenEnterpriseConsole={onOpenEnterpriseConsole}
            onOpenHelpDocs={onOpenHelpDocs}
            onLogin={onLogin}
            onLogout={onLogout}
            isAuthenticated={false}
            hostLabel={hostLabel}
            anchorRect={menuAnchor}
            triggerRef={moreBtnRef}
            onClose={() => setShowMenu(false)}
          />
        )}
      </div>
    );
  }

  const percent = plan ? planRemainingPercent(plan) : 0;
  const planExhausted = plan !== null && percent <= 0;

  const updateLabel =
    update === "downloading"
      ? "正在下载更新…"
      : update === "ready"
        ? "重启"
        : "更新";

  const handleUpdateButton = () => {
    if (update === "downloading") return;
    if (update === "ready") {
      setShowRestartConfirm(true);
      return;
    }
    setShowDownloadConfirm(true);
  };

  const popupStyle: React.CSSProperties | undefined = usageAnchor
    ? {
        position: "fixed",
        top: "auto",
        bottom: window.innerHeight - usageAnchor.top + 4,
        left: Math.max(8, usageAnchor.left),
        right: "auto",
      }
    : undefined;

  return (
    <div className="account-card" ref={cardRef} data-testid="account-card">
      <div className="account-card-main">
        <div
          ref={hotzoneRef}
          className="account-card-hotzone"
          role="button"
          tabIndex={0}
          aria-expanded={showUsage}
          aria-haspopup="dialog"
          data-testid="account-card-hotzone"
          onClick={(e) => {
            setUsageAnchor(e.currentTarget.getBoundingClientRect());
            setShowUsage((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setUsageAnchor(e.currentTarget.getBoundingClientRect());
              setShowUsage((v) => !v);
            }
          }}
        >
          <span
            className="account-card-avatar"
            aria-hidden="true"
            data-testid="account-card-avatar"
          >
            {initialFor(name)}
          </span>
          <span className="account-card-name" data-testid="account-card-name">
            {name}
          </span>
        </div>
        <button
          type="button"
          ref={moreBtnRef}
          className="account-card-more-btn"
          aria-label="更多"
          aria-haspopup="menu"
          aria-expanded={showMenu}
          data-testid="account-card-more"
          onClick={(e) => {
            setMenuAnchor(e.currentTarget.getBoundingClientRect());
            setShowMenu((v) => !v);
          }}
        >
          <span className="codicon codicon-ellipsis" aria-hidden="true"></span>
        </button>
      </div>
      {update !== null && (
        <button
          type="button"
          className="account-card-update-btn"
          data-testid="account-card-update"
          disabled={update === "downloading"}
          onClick={handleUpdateButton}
        >
          {updateLabel}
        </button>
      )}
      {showUsage && (
        <div
          ref={popupRef}
          className="account-usage-popup"
          style={popupStyle}
          role="dialog"
          aria-label="账户用量"
          data-testid="account-usage-popup"
        >
          {hostLabel && (
            <div
              className="account-usage-host"
              data-testid="account-usage-host"
            >
              {hostLabel}
            </div>
          )}
          {plan !== null && (
            <div className="account-usage-section" data-testid="account-plan">
              <div className="account-usage-title">
                <span>套餐用量</span>
                <span
                  className={
                    planExhausted
                      ? "account-usage-percent is-empty"
                      : "account-usage-percent"
                  }
                >
                  {percent}%
                </span>
              </div>
              <div
                className="account-usage-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className={
                    planExhausted
                      ? "account-usage-bar-fill is-empty"
                      : "account-usage-bar-fill"
                  }
                  style={{ width: `${percent}%` }}
                />
              </div>
              {planExhausted && (
                <div
                  className="account-usage-exhausted"
                  data-testid="account-plan-exhausted"
                >
                  套餐余量已用完，请联系销售人员充值
                </div>
              )}
            </div>
          )}
          {apiQuota !== null && (
            <div
              className="account-usage-section"
              data-testid="account-api-quota"
            >
              <div className="account-usage-title">
                <span>API 额度</span>
              </div>
              <div
                className={
                  apiQuota.limit !== null && apiQuota.used >= apiQuota.limit
                    ? "account-usage-value is-empty"
                    : "account-usage-value"
                }
              >
                {apiQuotaText(apiQuota)}
              </div>
            </div>
          )}
          {plan === null && apiQuota === null && (
            <div
              className="account-usage-empty"
              data-testid="account-usage-empty"
            >
              暂无用量数据
            </div>
          )}
        </div>
      )}
      {showMenu && menuAnchor && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onOpenHelpDocs={onOpenHelpDocs}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated
          hostLabel={hostLabel}
          anchorRect={menuAnchor}
          triggerRef={moreBtnRef}
          onClose={() => setShowMenu(false)}
        />
      )}
      {showDownloadConfirm && (
        <UpdateConfirmDialog
          title="发现新版本"
          description="是否下载更新？下载完成后可重启安装。"
          confirmText="下载"
          cancelText="取消"
          onConfirm={() => {
            setShowDownloadConfirm(false);
            onUpdateApp();
          }}
          onCancel={() => setShowDownloadConfirm(false)}
        />
      )}
      {showRestartConfirm && (
        <UpdateConfirmDialog
          title="更新已就绪"
          description="新版本已下载完成，重启应用以完成安装。"
          confirmText="重启"
          cancelText="稍后"
          onConfirm={() => {
            setShowRestartConfirm(false);
            onRestartApp();
          }}
          onCancel={() => setShowRestartConfirm(false)}
        />
      )}
    </div>
  );
};

export default AccountCard;
