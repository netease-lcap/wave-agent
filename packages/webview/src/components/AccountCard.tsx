import React, { useEffect, useRef, useState } from "react";
import type {
  AccountApiQuotaInfo,
  AccountBillingCode,
  AccountBillingInfo,
  AccountBillingPlanUsage,
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
  LoadingArcIcon,
  QuotaIcon,
} from "./HeaderIcons";
import "../styles/AccountCard.css";
import "../styles/ConfirmDialog.css";

/**
 * 桌面侧边栏账户卡片（spec desktop-account-and-settings.md「账户卡片」v3 三段式，
 * 取代旧版用量浮层 + 更多按钮交互）。宿主推送窗口级
 * `desktopAccountInfo` 快照；卡片未登录态为整条登录按钮 + 更多按钮，登录态为
 * 三段式：
 *
 *  1. 用量常驻区（套餐两根额度条 + 到期日 + 计费结论行 + API 余额行 + hover ⓘ
 *     明细气泡），经个人信息行右侧 chevron 收起/展开；显隐独立记忆、与个人信息
 *     菜单开合解耦；
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
  /** 计费结论（套餐两根条 + 到期日 + 降级原因）；null = 无（未登录/未购买）. */
  billing?: AccountBillingInfo | null;
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

/** 单根额度条的余量百分比：max(0, round((1 − used/limit) × 100))；limit 须 > 0. */
export function barRemainingPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, Math.round((1 - used / limit) * 100));
}

/** 单根额度条的展示视图；percent 为 null = 不画条（不限制/不可用）. */
export interface PlanBarView {
  percent: number | null;
  text: string;
  tone: "normal" | "exhausted" | "unlimited" | "unavailable";
}

/**
 * 派生单根条的视图。限额三态（codechat `billing.plan`）：null = 不限制（不画条）、
 * 0 = 该维度不可用（不画条）、正数 = 限额。触顶（used ≥ limit）读「已用尽」（空条），
 * **不读「0%」**——触顶只是该窗口用完、下窗口恢复，与「不可用」语义不同。
 */
export function planBarView(used: number, limit: number | null): PlanBarView {
  if (limit === null)
    return { percent: null, text: "无额度限制", tone: "unlimited" };
  if (limit === 0)
    return { percent: null, text: "不可用", tone: "unavailable" };
  if (used >= limit) return { percent: 0, text: "已用尽", tone: "exhausted" };
  const percent = barRemainingPercent(used, limit);
  return { percent, text: `${percent}%`, tone: "normal" };
}

/** 计费阻断码 → proxy 402 的同一句文案（与后端 `BLOCKED_INFO` 逐字一致）. */
const BLOCKED_TEXT: Record<AccountBillingCode, string> = {
  EXPIRED_NO_API: "您订购的套餐已过期，无法使用本产品！",
  USER_QUOTA_ZERO: "您的 API 额度已用完，请联系公司管理员分配额度后使用！",
  TEAM_QUOTA_ZERO: "团队 API 额度已用完，请联系公司管理员充值后使用！",
};

/**
 * 计费结论行（文案 + 色调）；null = 不渲染。色调按「会不会自愈」分：月/周/企业额度触顶
 * 下个窗口自动恢复 → 琥珀预警；blocked / 维度不可用 / 套餐已到期需人工干预 → 错误色。
 *
 * 两类触顶只是「哪一池用完」不同（企业池 vs 本人池），恢复方式与用户可做的事一样
 * （等下个窗口），故同色；差异落在文案里，不在色调里。
 */
export function planConclusion(
  billing: AccountBillingInfo,
): { text: string; tone: "warning" | "error" } | null {
  if (billing.mode === "plan") return null;
  if (billing.mode === "blocked") {
    return { text: BLOCKED_TEXT[billing.code], tone: "error" };
  }
  switch (billing.reason) {
    case "month":
      return { text: "本月额度已用尽，当前按 API 余额计费", tone: "warning" };
    case "week":
      return { text: "本周额度已用尽，当前按 API 余额计费", tone: "warning" };
    case "dimension_unavailable":
      return {
        text: "套餐额度不可用（限额为 0），当前按 API 余额计费",
        tone: "error",
      };
    case "no_plan":
      // 从未购买（无到期信息）→ 不渲染；有已到期订单 → 带到期日提示。
      if (!billing.plan) return null;
      return {
        text: `套餐已到期（${billing.plan.expireDate} 到期），当前按 API 余额计费`,
        tone: "error",
      };
    case "enterprise":
      // 2026-09-22 口径变更：企业本期额度触顶照渲染（原「漏提示优于误提示」已判定站不住——
      // 说「企业本期额度已用尽」是事实，且与本人两根条不冲突：条是个人读数、结论行是计费
      // 结论；真正的误读风险是把企业池数字画成个人的条，不是这句话本身）。
      return {
        text: "企业本期额度已用尽，当前按 API 余额计费",
        tone: "warning",
      };
  }
}

/** 生效套餐形态（四数 + 到期日）区别于「已到期」形态（仅到期日）：后者无月限额键. */
function isPlanUsage(
  plan: AccountBillingPlanUsage | { expireDate: string },
): plan is AccountBillingPlanUsage {
  return "monthLimit" in plan;
}

/** 单根套餐额度条（标签 + 条/占位 + 状态值）. */
const PlanBar: React.FC<{
  label: string;
  testId: string;
  used: number;
  limit: number | null;
}> = ({ label, testId, used, limit }) => {
  const view = planBarView(used, limit);
  return (
    <div className="account-plan-bar" data-testid={testId}>
      <span className="account-plan-bar-label">{label}</span>
      {view.percent === null ? (
        <span className="account-plan-bar-spacer" aria-hidden="true" />
      ) : (
        <div
          className="account-usage-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
        >
          <div
            className="account-usage-bar-fill"
            style={{ width: `${view.percent}%` }}
          />
        </div>
      )}
      <span className={`account-plan-bar-value is-${view.tone}`}>
        {view.text}
      </span>
    </div>
  );
};

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

  const billing = account?.billing ?? null;
  // blocked 形态不带 plan；其余两种才有（生效套餐 = 四数 + 到期日，已到期 = 仅到期日）.
  const billingPlan = billing && "plan" in billing ? billing.plan : null;
  // 有两根条四数的 plan 子对象（区别于「仅 expireDate」的已到期形态）。
  const planUsage =
    billingPlan && isPlanUsage(billingPlan) ? billingPlan : null;
  const expireDate = billingPlan?.expireDate ?? null;
  const conclusion = billing ? planConclusion(billing) : null;
  const showPlanBlock = planUsage !== null || conclusion !== null;
  // API 余额预警级：null=充足/不限额；"low"=剩余<20%；"exhausted"=剩余≤0。
  const apiWarning = apiQuota ? apiQuotaWarningLevel(apiQuota) : null;
  const hasUsage = showPlanBlock || apiQuota !== null;

  // 更新按钮文案/状态（S1/S3/S5；无更新 = S0 不渲染）。S3 已去掉省略号、「正在下载更新」
  // 缩为「正在下载」（设计师 2026-09-17）——进行中由转圈弧表达，文案只留最短状态词。
  const updateLabel =
    updateStatus === "downloading"
      ? "正在下载"
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
          {showPlanBlock && (
            <div className="account-usage-section" data-testid="account-plan">
              <div className="account-usage-title">
                <span>套餐用量</span>
                {expireDate && (
                  <span
                    className="account-plan-expire"
                    data-testid="account-plan-expire"
                  >
                    {expireDate} 到期
                  </span>
                )}
              </div>
              {planUsage && (
                <>
                  <PlanBar
                    label="本月"
                    testId="account-plan-month"
                    used={planUsage.monthUsed}
                    limit={planUsage.monthLimit}
                  />
                  <PlanBar
                    label="本周"
                    testId="account-plan-week"
                    used={planUsage.weekUsed}
                    limit={planUsage.weekLimit}
                  />
                </>
              )}
              {conclusion && (
                <div
                  className={`account-plan-conclusion is-${conclusion.tone}`}
                  data-testid="account-plan-conclusion"
                >
                  {conclusion.text}
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
            // S5「重启」退回描边样式（不抢主视觉），几何仍按按钮规范；S1/S3 为品牌红实底。
            className={
              "account-card-update-btn" +
              (updateStatus === "ready" ? " is-restart" : "")
            }
            aria-label="应用更新"
            // 下载中 disabled 防重复下载（S3），同时把进行中语义暴露给读屏。
            aria-busy={updateStatus === "downloading" || undefined}
            data-testid="account-update-btn"
            disabled={updateStatus === "downloading"}
            onClick={handleUpdateClick}
          >
            {updateStatus === "downloading" && (
              <LoadingArcIcon size={16} ariaLabel={null} />
            )}
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
