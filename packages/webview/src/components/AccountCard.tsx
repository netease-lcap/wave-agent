import React, { useEffect, useRef, useState } from "react";
import type {
  AccountApiQuotaInfo,
  AccountPlanInfo,
  AccountUpdateInfo,
} from "wave-webview-fixtures";
import { useClickOutside } from "../utils/useClickOutside";
import { MoreMenu } from "./MoreMenu";
import { ConfirmDialog } from "./ConfirmDialog";
// 未登录态「更多」按钮沿用 0902 第 5 轮问号圆（ailsa 新基线）；已登录态不再
// 提供独立更多按钮（交互定稿：热区开纯功能菜单）。
import {
  ApiInfoIcon,
  ChevronUpIcon,
  HelpCircleIcon,
  QuotaIcon,
} from "./HeaderIcons";
import "../styles/AccountCard.css";
import "../styles/ConfirmDialog.css";

/**
 * 桌面侧边栏账户卡片（spec desktop-account-card-and-panel-tabs.md，取代
 * desktop-account-and-settings.md「账户卡片」的用量浮层 + 更多按钮旧交互）。宿主推送窗口级
 * `desktopAccountInfo` 快照；卡片未登录态为整条登录按钮 + 更多按钮，登录态为
 * 三段式：
 *
 *  1. 用量常驻区（套餐用量进度条 + API 余额行 + hover ⓘ 明细气泡），经个人
 *     信息行右侧 chevron 收起/展开；显隐独立记忆、与个人信息菜单开合解耦；
 *  2. 个人信息行（头像 + 姓名热区 + 更新按钮 + 用量显隐按钮）：点击热区开/关
 *     纯功能菜单（设置/企业控制台/帮助文档/退出登录），菜单贴行弹出盖住用量
 *     区、与卡片等宽；再次点击热区或失焦/Esc 收起；
 *  3. 更新按钮 S0–S6 状态机：`available` 时显示「更新」(S1)，点击弹 S2 下载二
 *     次确认 → 发 desktopUpdateDownload、按钮转「正在下载更新…」disabled (S3)；
 *     宿主把 status 推为 "ready" → 自动弹 S4 重启确认（每轮就绪一次）→ 稍后 =
 *     「重启」按钮 (S5)，立即重启发 desktopUpdateRestart (S6)。
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

/** 剩余额度（limit 为数字时）；limit=null（不限额）返回 null。 */
export function apiQuotaRemaining(quota: AccountApiQuotaInfo): number | null {
  if (quota.limit === null) return null;
  return quota.limit - quota.used;
}

/**
 * API 余额预警级别（交互定稿 v3.1）：剩余 < 限额 20% = "low"（琥珀金额 +
 * 气泡预警）；剩余 ≤ 0 = "exhausted"（错误色 + 强警示）；不限额不参与预警。
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
 * API 余额行内文案（label 已含「余额」语义，金额不再加「剩余」前缀）：
 * 限额且未用完 → 「¥x」；用完 → 「已用完」；不限额 → 「不限额」。
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
  // 个人信息纯功能菜单：热区点击开/关（MoreMenu 把热区排除在 click-outside 外）。
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  // API 余额明细气泡：hover/focus ⓘ 唤起（移出自动收起，Esc/外部立即收起）。
  const [showApiPopover, setShowApiPopover] = useState(false);
  const [apiPopoverAnchor, setApiPopoverAnchor] = useState<DOMRect | null>(
    null,
  );
  // 用量常驻区收起/展开（独立记忆，与菜单开合解耦）。
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
  // 移出 ⓘ/气泡后延迟收起（防指针在图标↔气泡间移动时闪烁，~150ms）。
  const apiHideTimer = useRef<number | null>(null);
  // S4 自动弹窗护栏：status 每轮变为 ready 只自动弹一次（离开 ready 复位）。
  const [restartPrompted, setRestartPrompted] = useState(false);

  const isAuthenticated = account?.isAuthenticated === true;
  // 姓名优先完整邮箱（对齐 codechat sidebar-account），无邮箱时回退前缀/「已登录」。
  const name = account?.user?.email ?? displayNameFor(account?.user);
  const plan = account?.plan ?? null;
  const apiQuota = account?.apiQuota ?? null;
  const update = account?.update ?? null;
  const updateAvailable = update?.available === true;
  const updateStatus = update?.status ?? "idle";

  // S4：宿主推 status="ready" 时自动弹重启确认（稍后/立即重启）。必须位于未
  // 登录早退之前——React 要求同一组件每次渲染的 hook 数量一致。
  useEffect(() => {
    if (updateAvailable && updateStatus === "ready" && !restartPrompted) {
      setRestartPrompted(true);
      setUpdateDialog("restart");
    }
    if (updateStatus !== "ready") setRestartPrompted(false);
  }, [updateStatus, updateAvailable, restartPrompted]);

  // 卸载时清理气泡延迟收起定时器（同样须在早退之前注册；ref 稳定 = 挂载一次）。
  useEffect(
    () => () => {
      if (apiHideTimer.current !== null) {
        window.clearTimeout(apiHideTimer.current);
        apiHideTimer.current = null;
      }
    },
    [apiHideTimer],
  );

  // API 余额气泡：点击外部或 Esc 立即强制收起（悬停态也生效）。Click-outside
  // 豁免气泡与 ⓘ 触发按钮本身（再点 ⓘ toggle）；listener 经 useClickOutside
  // 延迟一帧注册，气泡被自身打开点击误关的防御见其注释。
  useClickOutside({
    refs: [apiPopoverRef, apiTriggerRef],
    enabled: showApiPopover,
    onClickOutside: () => setShowApiPopover(false),
  });
  useEffect(() => {
    if (!showApiPopover) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowApiPopover(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showApiPopover]);

  // 未登录：整条登录按钮 + 右侧「更多」按钮（沿用当前基线视觉）。
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
          <HelpCircleIcon className="account-card-more-icon" />
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
  const hasUsage = plan !== null || apiQuota !== null;

  // 更新按钮文案/状态（S1/S3/S5；无更新 = S0 不渲染）。
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
  // 打开明细气泡：锚点 y 取 ⓘ 按钮顶部（气泡贴 API 行向上弹出），x/宽取整张
  // 卡片——气泡与卡片等宽，盖住上方套餐用量区。
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

  // 个人信息热区：点击开/关纯功能菜单。锚点 = 整张卡片（等宽）+ 个人信息行顶部
  // （+4 抵消 MoreMenu 固定定位的上移间隙 → 菜单底缘贴行弹出），盖住上方用量区。
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
                  <ApiInfoIcon />
                </button>
              </span>
            </div>
          )}
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
            // 个人信息菜单打开时点显隐按钮只收起用量区、菜单保持打开（显隐与
            // 菜单解耦）：阻断 mousedown 冒泡到 MoreMenu 的 click-outside。
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setUsageCollapsed((v) => !v)}
          >
            {usageCollapsed ? <QuotaIcon /> : <ChevronUpIcon />}
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
          aria-label="API 余额明细"
          onMouseEnter={clearApiHideTimer}
          onMouseLeave={scheduleHideApiPopover}
          style={{
            left: apiPopoverAnchor.x,
            bottom: window.innerHeight - apiPopoverAnchor.y + 4,
            width: apiPopoverAnchor.width,
          }}
        >
          <div className="api-popover-title">API 余额</div>
          <div className="api-popover-row">
            <span>已用</span>
            <span className="api-popover-amt">
              ¥{formatAmount(apiQuota.used)}
            </span>
          </div>
          <div className="api-popover-row">
            <span>剩余</span>
            {apiQuota.limit === null ? (
              <span className="api-popover-amt">不限额</span>
            ) : (
              <span
                className={
                  "api-popover-amt" +
                  (apiWarning === "exhausted" ? " is-empty" : "")
                }
              >
                ¥{formatAmount(Math.max(0, apiQuota.limit - apiQuota.used))}
              </span>
            )}
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
