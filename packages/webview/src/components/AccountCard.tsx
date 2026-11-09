import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountApiQuotaInfo,
  AccountBillingCode,
  AccountBillingInfo,
  AccountBillingPlanUsage,
  AccountCredential,
  AccountUpdateInfo,
} from "wave-webview-fixtures";
import { MoreMenu } from "./MoreMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tooltip } from "./Tooltip";
import { marked } from "marked";
import DOMPurify from "dompurify";
// 未登录态「更多」按钮沿用 0902 第 5 轮问号圆（ailsa 新基线）；已登录态不再
// 提供独立更多按钮（交互定稿：热区开纯功能菜单）。
import {
  ApiInfoIcon,
  GatewayIcon,
  HelpCircleIcon,
  QuotaIcon,
} from "./HeaderIcons";
import { gatewayHostLabel, resolveCredentialKind } from "../utils/credential";
import { useClickOutside } from "../utils/useClickOutside";
import { viewportSize } from "../utils/viewport";
import "../styles/AccountCard.css";
import "../styles/ConfirmDialog.css";

/**
 * 桌面侧边栏账户卡片（spec desktop-account.md「账户卡片」v3 三段式，
 * 取代旧版用量浮层 + 更多按钮交互）。宿主推送窗口级
 * `desktopAccountInfo` 快照；卡片未登录态为整条登录按钮 + 更多按钮，登录态为
 * 三段式：
 *
 *  1. 用量常驻区（2026-10-09 起为「套餐用量 / API 余额」两个互斥维度切换：套餐
 *     维度 = 本周条 + 本月条 + 到期日 + 计费结论行；余额维度 = 已用 + 剩余 + 预警。
 *     套餐未用尽时 API 余额不参与计费，故默认停在套餐维度。两维只有一维可用时
 *     不渲染切换器、直接展示那一维），经个人信息行右侧 chevron 收起/展开；显隐
 *     独立记忆、与个人信息菜单开合解耦；
 *  2. 个人信息行（头像 + 姓名热区 + 更新按钮 + 用量显隐按钮）：点击热区开/关
 *     纯功能菜单（设置/企业控制台/帮助文档/退出登录），菜单贴行弹出盖住用量
 *     区、与卡片等宽；再次点击热区或失焦/Esc 收起；
 *  3. 更新按钮 S0–S3 状态机：宿主在后台**静默下载**（下载中/失败都不显示按钮，
 *     S0）；下载完成才出现「更新」(S1)，点开是「重启以完成更新」确认框——正文
 *     下方就是本次更新内容，看完点「立即重启」发 desktopUpdateRestart (S2→S3)。
 *     不自动弹框、不自动重启。
 */
export interface AccountCardAccount {
  /** SSO 登录态。卡片形态**不直接读它**，读 `credential`（见 utils/credential）。 */
  isAuthenticated: boolean;
  /** 凭据形态（sso / gateway / none）；缺席 = 旧宿主，回落到 isAuthenticated。 */
  credential?: AccountCredential | null;
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
  /** 用户确认立即重启（重启确认框点「立即重启」后通知宿主安装并重启，S3）。 */
  onRestartApp?: () => void;
  /**
   * 打开用量浮层时向宿主核对一次用量（spec desktop-account「用量刷新时机」场景
   * 4）：只在「收起 → 打开」那一刻发一次，页签切换与重渲染都不再发。
   */
  onRefreshUsage?: () => void;
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
  tone: "normal" | "unlimited" | "unavailable";
}

/**
 * 派生单根条的视图。限额三态（codechat `billing.plan`）：null = 不限制（不画条）、
 * 0 = 该维度不可用（不画条）、正数 = 限额。触顶（used ≥ limit）读「0%」、常规色
 * （2026-10-09 交互定稿，原读「已用尽」+ 琥珀）——条只表达余量，超用封底到 0；
 * 「哪个窗口用完、现在按什么计费」由结论行承担，不重复表达。
 */
export function planBarView(used: number, limit: number | null): PlanBarView {
  if (limit === null)
    return { percent: null, text: "无额度限制", tone: "unlimited" };
  if (limit === 0)
    return { percent: null, text: "不可用", tone: "unavailable" };
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
 *
 * `reason` / `code` 是**开放集合**：服务端可能先于客户端发版新增枚举值（两端不同机发布），
 * 故两处都有运行时兜底，不能只靠类型。兜底文案「说少而准」——结论行要回答的是「为什么在
 * 扣 API」，而这件事只需要 `mode === "api"` 就能确定，不需要认识具体的 `reason`。
 */
export function planConclusion(
  billing: AccountBillingInfo,
): { text: string; tone: "warning" | "error" } | null {
  if (billing.mode === "plan") return null;
  if (billing.mode === "blocked") {
    // 运行时兜底：规格外的 code（后端先发版）查表得 undefined ⇒ 只剩一条没有文案的空红框。
    // `BLOCKED_TEXT` 的穷尽 `Record` 只挡仓内漏补文案，挡不住跨仓先发的新枚举值。
    if (!(billing.code in BLOCKED_TEXT)) {
      console.warn("未知 billing.code，已按兜底文案渲染:", billing.code);
    }
    return {
      text: BLOCKED_TEXT[billing.code] ?? "当前用量受限，请联系公司管理员",
      tone: "error",
    };
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
    default: {
      // 编译期穷尽性检查：仓内新增 AccountBillingDegradeReason 却忘了处理时，这里会编译失败。
      // （跨仓拦不住：后端先加枚举、客户端后发版，所以这条兜底不能省。）
      const _exhaustive: never = billing.reason;
      void _exhaustive;
      // 未知原因照渲染、按琥珀（沿用本函数的分档规则：按「会不会自愈」分）。未知原因不预设
      // 「需人工干预」（那是 error 那档的语义），避免无谓制造焦虑。
      console.warn("未知 billing.reason，已按兜底文案渲染:", billing.reason);
      return {
        text: "套餐额度当前不可用，按 API 余额计费",
        tone: "warning",
      };
    }
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
 * API 余额能否下「额度已用完」结论：`billing.mode` 是唯一判据（issue #2776）。
 *
 * 只有「此刻真的按 API 计费」（`mode = "api"`）或宿主没下发 `billing`（只下发了余额
 * 这一维，余额即唯一计费口径）时，`limit = 0` / 剩余 ≤ 0 才等于「当前不可用」。`mode = "plan"` 下
 * 后端下发的 `apiQuota.limit = 0` 来自 `checkApiAvailable → TEAM_QUOTA_ZERO`，语义只是
 * 「此刻若降级到 API 计费会被 402」——只买试用套餐、从未充值 API 的企业团队余额恒为 0，
 * 拿它反推可用性会给「套餐还剩大半」的账号误报「已用完」。`mode = "blocked"` 的拦截
 * 结论由 proxy 402 文案承担，余额不再另判。
 */
function apiQuotaDecisive(
  billing: AccountBillingInfo | null | undefined,
): boolean {
  return billing == null || billing.mode === "api";
}

/**
 * API 余额预警级别（交互定稿 v3.1）：剩余 < 限额 20% = "low"（琥珀金额 +
 * 气泡预警）；剩余 ≤ 0 = "exhausted"（错误色 + 强警示）；不限额不参与预警。
 *
 * 耗尽属「API 侧结论」，只在 `apiQuotaDecisive` 成立时给（见该函数）；不足 20% 是
 * 余额充足性提醒、不是拦截结论，套餐模式下同样照给。
 */
export function apiQuotaWarningLevel(
  quota: AccountApiQuotaInfo,
  billing?: AccountBillingInfo | null,
): "low" | "exhausted" | null {
  const remaining = apiQuotaRemaining(quota);
  if (remaining === null) return null;
  // blocked：套餐与 API 均不可用，结论由 panel 内的 402 文案承担，余额不再另判。
  if (billing?.mode === "blocked") return null;
  if (remaining <= 0) return apiQuotaDecisive(billing) ? "exhausted" : null;
  if (remaining < quota.limit! * 0.2) return "low";
  return null;
}

/**
 * API 余额行内文案（label 已含「余额」语义，金额不再加「剩余」前缀）：
 * 限额且未用完 → 「¥x」；用完 → 「已用完」；不限额 → 「不限额」。
 *
 * `mode = "plan"` / `"blocked"` 下剩余 ≤ 0 不读「已用完」（limit = 0 不等于当前不可用，
 * 见 `apiQuotaDecisive`），只保留数值且封底到 0（不出现负数）。
 */
export function apiQuotaInlineText(
  quota: AccountApiQuotaInfo,
  billing?: AccountBillingInfo | null,
): string {
  const remaining = apiQuotaRemaining(quota);
  if (remaining === null) return "不限额";
  if (remaining <= 0) {
    return apiQuotaDecisive(billing) ? "已用完" : `¥${formatAmount(0)}`;
  }
  return `¥${formatAmount(remaining)}`;
}

/**
 * 变更记录的白名单：与消息/计划正文同一套 markdown 渲染，但**不含 `a`** ——
 * spec desktop-account.md「更新按钮状态机」S0–S3 场景 3 要求记录块里没有可点链接
 * （记录是提交标题的摘要，出现链接基本是误粘贴，且一点就把用户带出应用）。
 * DOMPurify 默认 `KEEP_CONTENT`，剥掉 `<a>` 但保留其中文字。
 */
const RELEASE_NOTE_ALLOWED_TAGS = [
  "div",
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "del",
];
const RELEASE_NOTE_ALLOWED_ATTR = ["title", "align"];

function renderReleaseNoteHtml(note: string): string {
  return DOMPurify.sanitize(marked.parse(note) as string, {
    ALLOWED_TAGS: RELEASE_NOTE_ALLOWED_TAGS,
    ALLOWED_ATTR: RELEASE_NOTE_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * 记录块要渲染的条目：宿主已按已装版本过滤并按版本倒序（desktop-account.md
 * 「更新按钮状态机」下发规则），webview 只再丢「空白 note」——那等于没有记录，
 * 渲染一个只有版本号的空段没有意义。全部为空时整块不渲染。
 *
 * 跨进程边界仍按未知数据校验字段类型：宿主是本仓代码，但快照走 postMessage，
 * 一条形态不对的项不该让整张卡片崩掉。
 */
function visibleReleaseNotes(
  update: AccountUpdateInfo | null,
): Array<{ version: string; note: string }> {
  return (update?.releaseNotes ?? []).filter(
    (entry) =>
      typeof entry?.version === "string" &&
      typeof entry?.note === "string" &&
      entry.note.trim().length > 0,
  );
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  hostLabel,
  onLogin,
  onLogout,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onRestartApp,
  onRefreshUsage,
}) => {
  // 个人信息纯功能菜单：热区点击开/关（MoreMenu 把热区排除在 click-outside 外）。
  const [showMenu, setShowMenu] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  // 用量浮层（2026-11 交互改版）：用量区不再就地展开/收起，改为点击个人信息行
  // 尾部的用量按钮，在卡片上方弹一层浮层（与卡片等宽、贴行顶向上弹）。
  const [showUsage, setShowUsage] = useState(false);
  const [usageAnchor, setUsageAnchor] = useState<DOMRect | null>(null);
  // 用量维度（2026-10-09 交互定稿）：套餐未用尽时 API 余额不参与计费，默认停在
  // 「套餐用量」不占版面，想看余额再切过去；两维只有一维可用时无切换器。
  const [usageTab, setUsageTab] = useState<"plan" | "api">("plan");
  // 更新确认对话框（S2）：只有用户点开「更新」按钮才出现——下载在后台静默完成，
  // 宿主不会主动弹任何东西。
  const [updateDialog, setUpdateDialog] = useState<"restart" | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hotzoneRef = useRef<HTMLDivElement | null>(null);
  const usageBtnRef = useRef<HTMLButtonElement | null>(null);
  const usagePanelRef = useRef<HTMLDivElement | null>(null);
  // 焦点交接的台账：浮层是否开过（避免首帧就把焦点抢走）、这次关闭要不要把焦点
  // 送回触发按钮、这次打开是不是键盘触发的（决定关闭后要不要真的送回去）。
  const usageOpened = useRef(false);
  const restoreFocusOnClose = useRef(false);
  const usageOpenedByKeyboard = useRef(false);

  // 贴个人信息行上方弹出的锚点（菜单与用量浮层共用）：与卡片等宽，底边贴行顶
  // （+4 抵消固定定位的上移间隙）。侧栏 overflow:hidden 会裁掉 absolute 后代，
  // 所以两层都用 fixed 逃逸。
  const measureRowAnchor = useCallback((): DOMRect | null => {
    const el = cardRef.current;
    if (!el) return null;
    const cardRect = el.getBoundingClientRect();
    const mainEl = el.querySelector<HTMLElement>(".account-card-main");
    const anchorTop =
      (mainEl ? mainEl.getBoundingClientRect().top : cardRect.top) + 4;
    return new DOMRect(
      cardRect.x,
      anchorTop,
      cardRect.width,
      cardRect.bottom - anchorTop,
    );
  }, []);

  // 卡片形态由凭据决定（spec「认证方式」故事）：sso = 企业账号（既有登录态）、
  // gateway = 自定义网关（个人信息行同构、无用量按钮）、none = 无凭据（登录按钮）。
  const credentialKind = resolveCredentialKind(
    account?.credential,
    account?.isAuthenticated === true,
  );
  const isAuthenticated = credentialKind === "sso";
  const isGateway = credentialKind === "gateway";
  // 姓名优先完整邮箱（对齐 codechat sidebar-account），无邮箱时回退前缀/「已登录」。
  const name = account?.user?.email ?? displayNameFor(account?.user);
  const apiQuota = account?.apiQuota ?? null;
  const update = account?.update ?? null;
  // 宿主只在下载完成后下发 `update`，所以「有 update」即「已就绪可重启」。
  const updateAvailable = update?.available === true;
  // 重启确认框正文下方的「本次更新内容」条目（缺失/全空 → 空数组 → 整块不渲染）。
  const releaseNotes = visibleReleaseNotes(update);

  // 菜单的锚点：登录态与用量浮层同源（贴个人信息行顶）；未登录态那颗菜单挂在
  // 右侧「更多」按钮上，锚点得量那颗按钮自身。resize 重测必须走同一条口径，
  // 否则窗口一变菜单就跳到另一个位置。
  const measureMenuAnchor = useCallback((): DOMRect | null => {
    // 无凭据形态那颗菜单挂在尾部「更多」按钮上；企业账号与网关形态都挂在个人
    // 信息行（同一套结构，避免同一张卡片出现两种入口习惯——场景 2）。
    if (credentialKind !== "none") return measureRowAnchor();
    return moreBtnRef.current?.getBoundingClientRect() ?? null;
  }, [credentialKind, measureRowAnchor]);

  // 用量浮层关闭路径：点浮层外、按 Esc。触发按钮排除在「外部」之外，再点一次
  // 即 toggle 关闭（与 MoreMenu 同一套 useClickOutside 口径）。
  // 必须位于未登录早退之前——React 要求同一组件每次渲染的 hook 数量一致。
  useClickOutside({
    refs: [usagePanelRef, usageBtnRef],
    onClickOutside: () => setShowUsage(false),
    enabled: showUsage,
  });
  useEffect(() => {
    if (!showUsage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        restoreFocusOnClose.current = true;
        setShowUsage(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showUsage]);
  // 菜单与浮层的坐标都是打开那一刻算出的 `fixed` 快照（`bottom` / `right` /
  // `width` 全由锚点决定），卡片又贴在侧栏底部、随窗口高度上下移动 —— 拖窗口后
  // 不重测就与卡片分家。两层各自开合（互斥），开着哪个就跟随哪个重测；宽度同理。
  useEffect(() => {
    if (!showUsage && !showMenu) return;
    const handleResize = () => {
      if (showUsage) {
        const anchor = measureRowAnchor();
        if (anchor) setUsageAnchor(anchor);
      }
      if (showMenu) {
        const anchor = measureMenuAnchor();
        if (anchor) setMenuAnchor(anchor);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [showUsage, showMenu, measureRowAnchor, measureMenuAnchor]);
  // 焦点交接（放在 effect 里而不是事件里）：Tooltip 的 `disabled` 会在开合瞬间
  // 摘掉/装回它那层 span，触发按钮的 DOM 节点随之重建——同步 focus() 打在当时那颗
  // 旧节点上，提交完就丢了。effect 在提交后跑，ref 已指向新节点。
  // 打开 → 焦点进浮层（dialog 语义）；Esc / 再按一次触发按钮关闭 → 交还触发按钮
  // （两条都是键盘路径：Enter/空格 toggle 关闭后焦点原本落到 body，Tab 顺序回卷到
  // 页首）；点外部关闭则把焦点留给用户点中的地方，不抢。
  // 「交还按钮」只对键盘打开的做：鼠标用户关闭时把焦点塞回按钮，会让按钮进入
  // :focus 态、顺带把「查看用量」气泡再弹出来——指针早已离开，这条气泡就一直挂着
  // （2026-11-05 实测的残留问题）。鼠标场景焦点落空即可，用户下一步本来就用鼠标。
  useEffect(() => {
    if (showUsage) {
      usageOpened.current = true;
      usagePanelRef.current?.focus();
      return;
    }
    if (
      usageOpened.current &&
      restoreFocusOnClose.current &&
      usageOpenedByKeyboard.current
    ) {
      usageBtnRef.current?.focus();
    }
    restoreFocusOnClose.current = false;
  }, [showUsage]);

  // 无凭据：整条登录按钮 + 右侧「更多」按钮（沿用当前基线视觉）。有网关凭据时
  // 不走这里——那个人不发「登录」按钮（他本来就能用），走下面的网关形态。
  if (credentialKind === "none") {
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
            credential={account?.credential}
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
  // API 余额预警级：null=充足/不限额；"low"=剩余<20%；"exhausted"=剩余≤0
  // （仅在真按 API 计费时成立，`mode = "plan"` 的 limit=0 不算用完，见 issue #2776）。
  const apiWarning = apiQuota ? apiQuotaWarningLevel(apiQuota, billing) : null;
  // 网关形态不给用量入口：宿主切到网关凭据时缓存里可能还留着上一个身份的
  // billing / apiQuota（只在 sso 下刷新），不拦就会冒出一颗点开是旧数据的按钮；
  // 而网关通路本来就没有这两份数据（spec「认证方式」场景 2 / 7）。
  const hasUsage = isAuthenticated && (showPlanBlock || apiQuota !== null);
  // 折叠态预警点（2026-11 交互定稿）：默认折叠后用量预警不再可见，用显隐按钮右上角的
  // 小圆点把「有情况要看」透出来。严重度取两者中更高的：需人工干预（blocked / 维度
  // 不可用 / 套餐已到期）与余额耗尽 → 错误色；会自愈（周/月触顶、余额 <20%）→ 琥珀。
  const usageAlert: "error" | "warning" | null =
    conclusion?.tone === "error" || apiWarning === "exhausted"
      ? "error"
      : conclusion?.tone === "warning" || apiWarning === "low"
        ? "warning"
        : null;
  // 两个维度都有才给切换器；只有一维时直接展示那一维（不看 usageTab，避免
  // 数据变化后停在空的维度上）。
  const showUsageTabs = showPlanBlock && apiQuota !== null;
  const activeUsageTab = showUsageTabs
    ? usageTab
    : showPlanBlock
      ? "plan"
      : "api";

  // 更新按钮（S1；无更新 / 后台下载中 / 下载失败 = S0 不渲染）：文案固定「更新」，
  // 点开是重启确认框（S2）——记录与「立即重启」都在那一屏里。
  const updateLabel = "更新";
  const handleUpdateClick = () => setUpdateDialog("restart");

  // 余额用途说明钮（2026-10-09）：排在**余额维度的右上角**——与套餐维度的到期日
  // 同一位置，两个维度各占各的右上角信息。放在金额行里会把「剩余」的数字挤得比
  // 「已用」短一截、两行右边缘对不齐，故不进金额行。
  const apiInfoButton = (
    <Tooltip text="将在套餐用量耗尽时使用API余额" position="top">
      <button
        type="button"
        className="account-api-info-btn"
        aria-label="API 余额说明"
        data-testid="api-quota-info"
      >
        <ApiInfoIcon />
      </button>
    </Tooltip>
  );

  // 个人信息热区：点击开/关纯功能菜单（打开时先收掉用量浮层，两个弹层互斥）。
  const toggleUsageMenu = () => {
    if (!showMenu) {
      const anchor = measureRowAnchor();
      if (anchor) setMenuAnchor(anchor);
      setShowUsage(false);
      setShowMenu(true);
    } else {
      setShowMenu(false);
    }
  };

  // 行尾用量按钮：点击在卡片上方弹出用量浮层（同样先收掉功能菜单）。
  // 打开时的默认维度（2026-11-05 追加口径）：有预警就停在报警的那一维——
  // 否则「打开只看到健康的套餐条、预警藏在另一维」，用户得自己找。两维都报
  // 警时取更严重的那档（错误 > 预警），同档回到套餐；无预警不覆盖用户的选择。
  const toggleUsagePopover = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!showUsage) {
      // 键盘激活的 click（Enter / 空格）detail 恒为 0，鼠标点击 ≥ 1。
      usageOpenedByKeyboard.current = event.detail === 0;
      restoreFocusOnClose.current = false;
      const anchor = measureRowAnchor();
      if (anchor) setUsageAnchor(anchor);
      const planRank =
        conclusion?.tone === "error"
          ? 2
          : conclusion?.tone === "warning"
            ? 1
            : 0;
      const apiRank =
        apiWarning === "exhausted" ? 2 : apiWarning === "low" ? 1 : 0;
      if (planRank || apiRank) {
        setUsageTab(apiRank > planRank ? "api" : "plan");
      }
      setShowMenu(false);
      setShowUsage(true);
      // 一次打开只核对一次（spec「用量刷新时机」场景 4）：页签切换与宿主推送
      // 重渲染都不会走到这里 —— 这里是唯一「收起 → 打开」的入口。
      onRefreshUsage?.();
    } else {
      // 再点一次触发按钮 = 键盘用户的 toggle 关闭：与 Esc 同样交还焦点
      // （是否真的交还由 effect 按「这次是不是键盘打开的」把关）。
      restoreFocusOnClose.current = true;
      setShowUsage(false);
    }
  };

  // `fixed` 的取景尺寸：扣掉经典滚动条的视口宽高（见 `viewportSize`）。
  const { width: viewportWidth, height: viewportHeight } = viewportSize();

  return (
    <div className="account-card" ref={cardRef} data-testid="account-card">
      {showUsage && hasUsage && usageAnchor && (
        <div
          ref={usagePanelRef}
          className="account-usage-popover"
          role="dialog"
          aria-label="用量信息"
          tabIndex={-1}
          data-testid="account-usage-popover"
          style={{
            position: "fixed",
            // 浮层底缘与个人信息行（= 行尾图标按钮的顶）之间留 4px 缝。锚点 top 是
            // 「行顶 + 4」，故这里取 +8：底缘落在行顶上方 4px。原来取 +4 ⇒ 底缘正好
            // 压在行顶，浮层与图标按钮贴在一起（1109 评论：「弹窗再上移大概 4px，
            // 和图标之间有些间距」）。
            bottom: viewportHeight - usageAnchor.top + 8,
            right: Math.max(8, viewportWidth - usageAnchor.right),
            width: Math.max(usageAnchor.width, 216),
            // 向上弹：可用高度就是个人信息行顶以上的空间，超高时浮层内部滚动。
            // 下限取 0 而不是 120——行顶贴着视口顶时（小窗 / 卡片被顶高），
            // 露在视口外的部分用户连滚都滚不到。
            maxHeight: Math.max(0, usageAnchor.top - 12),
          }}
        >
          {/* 两个维度都有 ⇒ 顶部切换器（到期日跟到右侧）；只有一维 ⇒ 不渲染
              切换器，直接展示那一维并在块内保留标题行。 */}
          {showUsageTabs && (
            <div className="account-usage-tabs-row">
              <div
                className="account-usage-tabs"
                role="tablist"
                aria-label="用量维度"
              >
                <button
                  type="button"
                  role="tab"
                  id="account-usage-tab-plan"
                  aria-selected={activeUsageTab === "plan"}
                  aria-controls="account-usage-panel-plan"
                  className={
                    "account-usage-tab" +
                    (activeUsageTab === "plan" ? " is-active" : "")
                  }
                  data-testid="account-usage-tab-plan"
                  onClick={() => setUsageTab("plan")}
                >
                  套餐用量
                </button>
                <button
                  type="button"
                  role="tab"
                  id="account-usage-tab-api"
                  aria-selected={activeUsageTab === "api"}
                  aria-controls="account-usage-panel-api"
                  className={
                    "account-usage-tab" +
                    (activeUsageTab === "api" ? " is-active" : "")
                  }
                  data-testid="account-usage-tab-api"
                  onClick={() => setUsageTab("api")}
                >
                  API 余额
                </button>
              </div>
              {/* 右上角随维度换：套餐维度 = 到期日，余额维度 = ⓘ（2026-10-09
                  交互定稿——到期日属套餐信息、ⓘ 属余额信息，各归各的维度）。 */}
              {activeUsageTab === "plan" && expireDate && (
                <span
                  className="account-plan-expire"
                  data-testid="account-plan-expire"
                >
                  {expireDate} 到期
                </span>
              )}
              {activeUsageTab === "api" && apiQuota !== null && apiInfoButton}
            </div>
          )}
          {activeUsageTab === "plan" && showPlanBlock && (
            <div
              className="account-usage-section"
              data-testid="account-plan"
              id="account-usage-panel-plan"
              {...(showUsageTabs
                ? {
                    role: "tabpanel",
                    "aria-labelledby": "account-usage-tab-plan",
                  }
                : {})}
            >
              {!showUsageTabs && (
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
              )}
              {planUsage && (
                <>
                  {/* 本周在上：自然周窗口短、更容易触顶，是更该优先关注的维度
                      （2026-10-09 交互定稿，原本月在上）。 */}
                  <PlanBar
                    label="本周"
                    testId="account-plan-week"
                    used={planUsage.weekUsed}
                    limit={planUsage.weekLimit}
                  />
                  <PlanBar
                    label="本月"
                    testId="account-plan-month"
                    used={planUsage.monthUsed}
                    limit={planUsage.monthLimit}
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
          {activeUsageTab === "api" && apiQuota !== null && (
            <div
              className="account-usage-section"
              data-testid="account-api-quota"
              id="account-usage-panel-api"
              {...(showUsageTabs
                ? {
                    role: "tabpanel",
                    "aria-labelledby": "account-usage-tab-api",
                  }
                : {})}
            >
              {!showUsageTabs && (
                <div className="account-usage-title">
                  <span>API 余额</span>
                  {apiInfoButton}
                </div>
              )}
              <div className="account-usage-row">
                <span className="account-usage-label">已用</span>
                <span className="account-usage-value">
                  <span className="account-usage-value-text">
                    ¥{formatAmount(apiQuota.used)}
                  </span>
                </span>
              </div>
              <div className="account-usage-row">
                <span className="account-usage-label">剩余</span>
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
                    {apiQuotaInlineText(apiQuota, billing)}
                  </span>
                </span>
              </div>
              {apiWarning === "low" && (
                <div className="account-api-warn is-warning">
                  余额不足20%，建议及时充值
                </div>
              )}
              {apiWarning === "exhausted" && (
                <div className="account-api-warn is-empty">
                  额度已用完，请联系管理员充值
                </div>
              )}
              {/* blocked：套餐与 API 均不可用，拦截结论在余额维度也给出同一句
                  proxy 402 文案（issue #2776）——此时余额不宜再自称「已用完」，
                  两处结论同源（planConclusion），只是一个落在套餐块、一个落在余额块。 */}
              {billing?.mode === "blocked" && conclusion && (
                <div
                  className={`account-plan-conclusion is-${conclusion.tone}`}
                  data-testid="account-api-conclusion"
                >
                  {conclusion.text}
                </div>
              )}
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
          // 网关主机名只进 title（hover 出全文）：卡片可用宽度约 235px，图标位与
          // 行尾按钮之后只剩约 160px，「自定义网关」+ 域名同行会两段都被 ellipsis
          // 截断，加第二行则把行高从 30px 抬到约 46px——卡片钉在侧栏底部，长高会
          // 挤压会话列表，也让两种形态不对称（spec「认证方式」场景 2）。
          title={
            isGateway
              ? `自定义网关 · ${gatewayHostLabel(account?.credential?.gateway)}`
              : undefined
          }
          onClick={toggleUsageMenu}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleUsageMenu();
            }
          }}
        >
          <span
            className={
              "account-card-avatar" +
              (isGateway ? " account-card-avatar--gateway" : "")
            }
            aria-hidden="true"
            data-testid={
              isGateway ? "account-card-gateway" : "account-card-avatar"
            }
          >
            {isGateway ? (
              <GatewayIcon className="account-card-gateway-icon" />
            ) : (
              initialFor(name)
            )}
          </span>
          <span className="account-card-name" data-testid="account-card-name">
            {isGateway ? "自定义网关" : name}
          </span>
        </div>
        {updateAvailable && (
          <button
            type="button"
            // S1「更新」= 品牌红实底的主行动（宿主只在下载完成后才渲染这一态）。
            className="account-card-update-btn"
            aria-label="应用更新"
            aria-haspopup="dialog"
            data-testid="account-update-btn"
            onClick={handleUpdateClick}
          >
            {updateLabel}
          </button>
        )}
        {hasUsage && (
          // 1023 评论（她点 `button.account-card-collapse-btn`）：「这里也缺少 hover 提示」
          // —— 与同卡 ⓘ 按钮、侧栏各图标按钮一致，补一颗桌面气泡；文案跟随按钮语义
          // （`aria-label` 同为展开/收起用量），位置 top（卡片在最底部，气泡向上弹）。
          // 2026-11 交互改版：按钮不再就地展开/收起，改为弹出用量浮层；浮层打开时
          // 气泡让位（disabled）。
          <Tooltip text="查看用量" position="top" disabled={showUsage}>
            <button
              type="button"
              ref={usageBtnRef}
              className="account-card-usage-btn"
              // 预警不能只靠颜色：圆点对读屏是 `aria-hidden`，严重度也得进
              // 文案，否则「红 = 需人工干预 / 琥珀 = 会自愈」这一层信息只剩视觉。
              aria-label={
                usageAlert === "error"
                  ? "查看用量（有预警，需处理）"
                  : usageAlert === "warning"
                    ? "查看用量（有预警）"
                    : "查看用量"
              }
              aria-haspopup="dialog"
              aria-expanded={showUsage}
              data-testid="account-usage-btn"
              // 浮层打开时点按钮只 toggle 浮层；阻断 mousedown 冒泡，避免被
              // MoreMenu 的 click-outside 当成外部点击。
              onMouseDown={(e) => e.stopPropagation()}
              onClick={toggleUsagePopover}
            >
              <QuotaIcon />
              {/* 预警点常驻：浮层关着时它是唯一的预警出口；打开后浮层正文自己
                  表达预警，点仍保留（状态不随开合闪烁）。 */}
              {usageAlert && (
                <span
                  className={`account-usage-alert-dot is-${usageAlert}`}
                  aria-hidden="true"
                  data-testid="account-usage-alert-dot"
                />
              )}
            </button>
          </Tooltip>
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
          credential={account?.credential}
          hostLabel={hostLabel}
          anchorRect={menuAnchor}
          triggerRef={hotzoneRef}
          onClose={() => setShowMenu(false)}
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
        >
          {/* 「本次更新内容」（spec desktop-account.md S0–S3 场景 3）：每项一段、
              版本号段标题从新到旧；即使只有一项也保留版本号段标题——渲染形态
              只有一种。没有记录时整块不出现，确认框与加记录块之前逐字一致。 */}
          {releaseNotes.length > 0 && (
            <div
              className="account-release-notes"
              data-testid="account-release-notes"
            >
              <div className="account-release-notes-title">本次更新内容</div>
              <div className="account-release-notes-body">
                {releaseNotes.map((entry) => (
                  <section
                    key={entry.version}
                    className="account-release-note"
                    data-testid="account-release-note"
                  >
                    <div className="account-release-note-version">
                      v{entry.version}
                    </div>
                    <div
                      className="account-release-note-body"
                      // 白名单渲染（无 `a`/无事件属性），见 renderReleaseNoteHtml。
                      dangerouslySetInnerHTML={{
                        __html: renderReleaseNoteHtml(entry.note),
                      }}
                    />
                  </section>
                ))}
              </div>
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

export default AccountCard;
