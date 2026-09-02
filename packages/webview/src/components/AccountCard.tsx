import React, { useEffect, useRef, useState } from "react";
import type {
  AccountApiQuotaInfo,
  AccountPlanInfo,
  AccountUpdateInfo,
} from "wave-webview-fixtures";
import { MoreMenu } from "./MoreMenu";
import { MoreIcon } from "./HeaderIcons";
import { ConfirmDialog } from "./ConfirmDialog";
import "../styles/AccountCard.css";
import "../styles/ConfirmDialog.css";

/**
 * 桌面侧边栏账户卡片 (spec desktop-app.md「账户卡片」). The host pushes a
 * window-global `desktopAccountInfo` snapshot; the card renders a full-width
 * 登录 button when logged out, and an avatar/name hotzone when logged in.
 *
 * 已登录态双路径（交互设计「用量常驻 + 个人信息菜单」兼容）：
 *  - 用量常驻在卡片上半部分（可经个人信息行右侧 chevron 收起/展开）；
 *  - 点击个人信息热区 → 菜单（设置/企业控制台/帮助文档/退出登录），再次点击
 *    或失焦/Esc 收起；菜单为纯功能菜单，不影响常驻用量区显隐。
 * 更新提示由个人信息行右侧的「更新」按钮承载（交互设计 §4 状态机 S0–S6），
 * 不在热区内——点更新只触发更新流程，不打开菜单。
 */
export interface AccountCardAccount {
  isAuthenticated: boolean;
  user?: { id: string; email?: string } | null;
  plan?: AccountPlanInfo | null;
  apiQuota?: AccountApiQuotaInfo | null;
  update?: AccountUpdateInfo | null;
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
  /** 用户确认下载更新（S2 确认后通知宿主开始下载）。 */
  onDownloadUpdate?: () => void;
  /** 用户确认立即重启（S4 确认后通知宿主安装并重启）。 */
  onRestartApp?: () => void;
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

/** 剩余额度（limit 为数字时）；null = 不限额。 */
export function apiQuotaRemaining(quota: AccountApiQuotaInfo): number | null {
  if (quota.limit === null) return null;
  return quota.limit - quota.used;
}

/**
 * API 余额预警级别（交互设计：余额不足 = 剩余 < 限额 20%）：
 * - "low"：剩余 > 0 但低于限额 20%（金额变色 + 气泡预警）
 * - "exhausted"：剩余 ≤ 0（红色 + 气泡强警示）
 * - null：充足（或 limit=null 不限额，不参与预警）
 */
export function apiQuotaWarningLevel(
  quota: AccountApiQuotaInfo,
): "low" | "exhausted" | null {
  const remaining = apiQuotaRemaining(quota);
  if (remaining === null) return null;
  if (remaining <= 0) return "exhausted";
  if (remaining < quota.limit! * 0.2) return "low";
  return null;
}

/**
 * API 余额行内文案（label 已是「API 余额」，金额不再加「剩余」前缀）：
 * - 限额且未用完 → 「¥x」；用完 → 「已用完」
 * - 不限额（limit=null，共用团队余额）→ 「不限额」（已用金额收进气泡）
 */
export function apiQuotaInlineText(quota: AccountApiQuotaInfo): string {
  const remaining = apiQuotaRemaining(quota);
  if (remaining === null) return "不限额";
  if (remaining <= 0) return "已用完";
  return `¥${formatAmount(remaining)}`;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  hostLabel,
  onLogin,
  onLogout,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onDownloadUpdate,
  onRestartApp,
}) => {
  // 合并菜单（用量 + 更多功能）：点击个人信息热区唤起。
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  // API 余额明细气泡：hover/focus info 图标唤起（移出自动收起）。
  const [showApiPopover, setShowApiPopover] = useState(false);
  const [apiPopoverAnchor, setApiPopoverAnchor] = useState<DOMRect | null>(
    null,
  );
  // 常驻用量区收起/展开。
  const [usageCollapsed, setUsageCollapsed] = useState(false);
  // 更新确认对话框：download = S2 下载二次确认；restart = S4 重启确认。
  const [updateDialog, setUpdateDialog] = useState<
    "download" | "restart" | null
  >(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hotzoneRef = useRef<HTMLDivElement | null>(null);
  const apiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const apiPopoverRef = useRef<HTMLDivElement | null>(null);
  // hover 移出后延迟收起气泡的定时器（避免指针在图标↔气泡间移动时闪烁）。
  const apiHideTimer = useRef<number | null>(null);
  // S4 自动弹窗：status 变为 ready 时自动弹重启确认（仅一次；离开 ready 复位）。
  const [restartPrompted, setRestartPrompted] = useState(false);

  const isAuthenticated = account?.isAuthenticated === true;
  // Figma sidebar-account 显示完整邮箱（admin@corp.netease），非 email 前缀。
  const name = account?.user?.email ?? displayNameFor(account?.user);
  const plan = account?.plan ?? null;
  const apiQuota = account?.apiQuota ?? null;
  const update = account?.update ?? null;
  const updateAvailable = update?.available === true;
  const updateStatus = update?.status ?? "idle";

  // S4：宿主推 status="ready" 时自动弹重启确认（稍后/立即重启）。必须位于
  // 未登录早退之前——React 要求同一组件每次渲染的 hook 数量一致。
  useEffect(() => {
    if (updateAvailable && updateStatus === "ready" && !restartPrompted) {
      setRestartPrompted(true);
      setUpdateDialog("restart");
    }
    if (updateStatus !== "ready") setRestartPrompted(false);
  }, [updateStatus, updateAvailable, restartPrompted]);

  // 卸载时清理气泡延迟收起的定时器（必须在未登录早退之前注册）。apiHideTimer
  // 是稳定的 ref，效果等同 mount-once。
  useEffect(
    () => () => {
      if (apiHideTimer.current !== null) {
        window.clearTimeout(apiHideTimer.current);
        apiHideTimer.current = null;
      }
    },
    [apiHideTimer],
  );

  // API 余额气泡：mousedown 外部或 Esc 强制收起（防止 hover 状态下误留）。
  useEffect(() => {
    if (!showApiPopover) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (apiPopoverRef.current?.contains(target)) return;
      if (apiTriggerRef.current?.contains(target)) return;
      setShowApiPopover(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowApiPopover(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showApiPopover]);

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
          <MoreIcon className="account-card-more-icon" />
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
  // API 余额预警级：null=充足/不限额；"low"=剩余<20%；"exhausted"=剩余≤0。
  const apiWarning = apiQuota ? apiQuotaWarningLevel(apiQuota) : null;

  // 用量区渲染（常驻概要区；唯一的进度条带 progressbar 角色）。
  const renderUsage = () => (
    <>
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
        <div className="account-usage-row" data-testid="account-api-quota">
          <span className="account-usage-label">API 余额</span>
          <span
            className={
              "account-usage-value" +
              (apiWarning === "low"
                ? " is-warning"
                : apiWarning === "exhausted"
                  ? " is-empty"
                  : "")
            }
          >
            <span className="account-usage-value-text">
              {apiQuotaInlineText(apiQuota)}
            </span>
            <button
              ref={apiTriggerRef}
              type="button"
              className="account-api-info-btn"
              aria-label="API 余额明细"
              aria-haspopup="dialog"
              aria-expanded={showApiPopover}
              data-testid="api-quota-info"
              onMouseEnter={openApiPopover}
              onMouseLeave={scheduleHideApiPopover}
              onFocus={openApiPopover}
              onBlur={scheduleHideApiPopover}
            >
              <i className="codicon codicon-info" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      )}{" "}
    </>
  );

  const hasUsage = plan !== null || apiQuota !== null;
  const updateLabel =
    updateStatus === "downloading"
      ? "正在下载更新…"
      : updateStatus === "ready"
        ? "重启"
        : "更新";

  const handleUpdateClick = () => {
    if (updateStatus === "downloading") return;
    setUpdateDialog(updateStatus === "ready" ? "restart" : "download");
  };

  // API 余额明细气泡：hover（或键盘 focus）info 图标时打开，移出图标/气泡后延迟收起。
  // 锚点左缘/宽取整张卡片（气泡与卡片等宽），y 取触发按钮顶部——气泡
  // 底部贴 API 行向上弹出，覆盖上方的套餐用量区。
  const clearApiHideTimer = () => {
    if (apiHideTimer.current !== null) {
      window.clearTimeout(apiHideTimer.current);
      apiHideTimer.current = null;
    }
  };
  const scheduleHideApiPopover = () => {
    clearApiHideTimer();
    apiHideTimer.current = window.setTimeout(() => {
      setShowApiPopover(false);
      apiHideTimer.current = null;
    }, 150);
  };
  const openApiPopover = () => {
    clearApiHideTimer();
    const el = cardRef.current;
    const trigger = apiTriggerRef.current;
    if (el && trigger) {
      const cardRect = el.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      setApiPopoverAnchor(
        new DOMRect(
          cardRect.x,
          triggerRect.top,
          cardRect.width,
          triggerRect.height,
        ),
      );
    }
    setShowApiPopover(true);
  };

  // 个人信息热区：点击开/关合并菜单（再次点击收起；失焦/Esc 由 MoreMenu 处理）。
  // 菜单为纯功能菜单，不影响常驻用量区的显隐（后者由 chevron 独立控制）。
  // 锚点顶部取个人信息行（.account-card-main）顶部并 +4 抵消 MoreMenu 的
  // anchor 上移 4px——菜单底部贴着个人信息行弹出，上方的用量信息被菜单
  // 盖住也没关系（交互确认）。
  const toggleUsageMenu = () => {
    if (!showMenu) {
      const el = cardRef.current;
      if (el) {
        const cardRect = el.getBoundingClientRect();
        const mainEl = el.querySelector<HTMLElement>(".account-card-main");
        const anchorTop =
          (mainEl ? mainEl.getBoundingClientRect().top : cardRect.top) + 4;
        setMenuAnchor(
          new DOMRect(
            cardRect.x,
            anchorTop,
            cardRect.width,
            cardRect.bottom - anchorTop,
          ),
        );
      }
      setShowMenu(true);
    } else {
      setShowMenu(false);
    }
  };

  return (
    <div className="account-card" ref={cardRef} data-testid="account-card">
      {hasUsage && !usageCollapsed && (
        <div
          className="account-card-usage-inline"
          data-testid="account-card-usage"
        >
          {renderUsage()}
        </div>
      )}
      <div className="account-card-main">
        <div
          ref={hotzoneRef}
          className="account-card-hotzone"
          role="button"
          tabIndex={0}
          aria-expanded={showMenu}
          aria-haspopup="menu"
          data-testid="account-card-hotzone"
          onClick={toggleUsageMenu}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleUsageMenu();
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
        {updateAvailable && (
          <button
            type="button"
            className="account-card-update-btn"
            aria-label="应用更新"
            data-testid="account-update-btn"
            disabled={updateStatus === "downloading"}
            onClick={handleUpdateClick}
          >
            {updateLabel}
          </button>
        )}
        {hasUsage && (
          <button
            type="button"
            className="account-card-collapse-btn"
            aria-label={usageCollapsed ? "展开用量" : "收起用量"}
            aria-expanded={!usageCollapsed}
            data-testid="account-usage-collapse"
            onClick={() => setUsageCollapsed((v) => !v)}
          >
            <span
              className={
                usageCollapsed
                  ? "codicon codicon-dashboard"
                  : "codicon codicon-chevron-up"
              }
              aria-hidden="true"
            ></span>
          </button>
        )}
      </div>
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
          triggerRef={hotzoneRef}
          onClose={() => setShowMenu(false)}
        />
      )}
      {showApiPopover && apiQuota !== null && apiPopoverAnchor && (
        <div
          ref={apiPopoverRef}
          className="api-quota-popover"
          data-testid="api-quota-popover"
          role="dialog"
          onMouseEnter={clearApiHideTimer}
          onMouseLeave={scheduleHideApiPopover}
          style={{
            left: apiPopoverAnchor.x,
            bottom: window.innerHeight - apiPopoverAnchor.y + 4,
            width: apiPopoverAnchor.width,
          }}
        >
          <div className="api-popover-title">API 余额</div>
          {apiQuota.limit === null ? (
            <>
              <div className="api-popover-row">
                <span>已用</span>
                <span className="api-popover-amt">
                  ¥{formatAmount(apiQuota.used)}
                </span>
              </div>
              <div className="api-popover-row">
                <span>剩余</span>
                <span className="api-popover-amt">不限额</span>
              </div>
            </>
          ) : (
            <>
              <div className="api-popover-row">
                <span>已用</span>
                <span className="api-popover-amt">
                  ¥{formatAmount(apiQuota.used)}
                </span>
              </div>
              <div className="api-popover-row">
                <span>剩余</span>
                <span
                  className={
                    "api-popover-amt" +
                    (apiWarning === "exhausted" ? " is-empty" : "")
                  }
                >
                  ¥{formatAmount(Math.max(0, apiQuota.limit - apiQuota.used))}
                </span>
              </div>
              {apiWarning === "low" && (
                <div className="api-popover-warn is-warning">
                  余额不足20%，建议及时充值
                </div>
              )}
              {apiWarning === "exhausted" && (
                <div className="api-popover-warn is-empty">
                  额度已用完，请联系管理员充值
                </div>
              )}
            </>
          )}
        </div>
      )}
      {updateDialog === "download" && (
        <ConfirmDialog
          title="更新到新版本"
          description={`将下载并安装新版本${update?.version ? ` v${update.version}` : ""}。安装完成后由你选择重启时机，不会自动重启客户端。是否继续？`}
          confirmText="下载更新"
          cancelText="取消"
          onConfirm={() => {
            setUpdateDialog(null);
            onDownloadUpdate?.();
          }}
          onCancel={() => setUpdateDialog(null)}
        />
      )}
      {updateDialog === "restart" && (
        <ConfirmDialog
          title="重启以完成更新"
          description="新版本已就绪，重启后生效。重启会中断正在运行的任务，建议先保存工作。是否立即重启？"
          confirmText="立即重启"
          cancelText="稍后"
          onConfirm={() => {
            setUpdateDialog(null);
            onRestartApp?.();
          }}
          onCancel={() => setUpdateDialog(null)}
        />
      )}
    </div>
  );
};

export default AccountCard;
