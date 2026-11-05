import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import type {
  AccountBillingCode,
  AccountBillingDegradeReason,
} from "wave-webview-fixtures";
import { DesktopApp } from "../../src/components/DesktopApp";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  fixtures,
} from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/**
 * Render the desktop root (workdir picked → sidebar appears) and let the host
 * push a desktopAccountInfo snapshot, exactly like the real desktop host does.
 */
function renderDesktop(workdirHost = "local") {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: [],
    host: workdirHost,
  });
  // FR-032：当前 host 语义在 pane record（effectiveHost = pane host ?? host
  // 级 host）。真实宿主切远端时 hostState 与 pushPanes 同时更新——这里镜像
  // 同一时序：pane record 带上 workdirHost，侧边栏 host 标注/主机选择器才能
  // 反映远端（spec desktop-split-pane.md「启动即单个分屏」）。
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", host: workdirHost, row: 0 }],
    focusedPaneId: "pane-1",
  });
  return { ...result, vscode };
}

function pushAccount(overrides: Record<string, unknown>) {
  act(() => {
    sendHostMessage(fixtures.desktopAccountInfo(overrides));
  });
}

/**
 * 用量 2026-11 交互改版起**默认收在浮层里**：需要断言用量内容的用例先点个人信息行
 * 尾部的用量按钮弹出浮层（默认关闭态、预警点由「用量浮层」那组用例覆盖）。
 */
function expandUsage() {
  fireEvent.click(screen.getByTestId("account-usage-btn"));
  expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
}

/** 内容类用例的常见组合：推账户快照 + 弹出用量浮层。 */
function pushUsage(overrides: Record<string, unknown>) {
  pushAccount(overrides);
  expandUsage();
}

const loggedIn = {
  user: { id: "u1", email: "alice@example.com" },
};
/**
 * 生效套餐（计费结论形态甲 `mode: "plan"`）：本月 1000 已用 600 → 剩 40%；
 * 本周 500 已用 60 → 剩 88%；2027-03-01 到期。
 */
const planBilling = {
  mode: "plan",
  plan: {
    monthUsed: 600,
    monthLimit: 1000,
    weekUsed: 60,
    weekLimit: 500,
    expireDate: "2027-03-01",
  },
};
/** API 限额 ¥10,000 已用 ¥1,153.14 → 剩余充足. */
const apiPlenty = { limit: 10000, used: 1153.14 };

describe("AccountCard (desktop sidebar)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("未登录态", () => {
    it("renders the login button with a more button when logged out, and posts login on click", () => {
      const { vscode } = renderDesktop();
      pushAccount({ isAuthenticated: false });

      const login = screen.getByTestId("account-card-login");
      expect(login).toHaveTextContent("登 录");
      const more = screen.getByTestId("account-card-more");
      expect(more).toBeInTheDocument();
      fireEvent.click(more);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();
      expect(screen.getByTestId("more-menu-login")).toHaveTextContent("登录");
      vscode.postMessage.mockClear();
      fireEvent.click(login);
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "login" }),
      );
    });

    it("renders no usage area and no collapse button when logged out", () => {
      renderDesktop();
      pushAccount({
        isAuthenticated: false,
        billing: planBilling,
        apiQuota: apiPlenty,
      });

      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("account-usage-btn")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-card-hotzone"),
      ).not.toBeInTheDocument();
    });
  });

  describe("用量常驻区（套餐用量 + API 余额）", () => {
    it("常驻区默认停在套餐维度（本周在上、本月在下 + 到期日），余额行不占版面", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      const usage = screen.getByTestId("account-usage-popover");
      expect(usage).toBeInTheDocument();
      const planBlock = screen.getByTestId("account-plan");
      // 「套餐用量」这个称呼由页签承担，块内不再重复一行标题.
      expect(screen.getByTestId("account-usage-tab-plan")).toHaveTextContent(
        "套餐用量",
      );
      expect(screen.getByTestId("account-plan-expire")).toHaveTextContent(
        "2027-03-01 到期",
      );
      const week = screen.getByTestId("account-plan-week");
      expect(week).toHaveTextContent("本周");
      expect(week).toHaveTextContent("88%");
      expect(week.querySelector('[role="progressbar"]')).toHaveAttribute(
        "aria-valuenow",
        "88",
      );
      const month = screen.getByTestId("account-plan-month");
      expect(month).toHaveTextContent("本月");
      expect(month).toHaveTextContent("40%");
      expect(month.querySelector('[role="progressbar"]')).toHaveAttribute(
        "aria-valuenow",
        "40",
      );
      // 本周排在前面（2026-10-09 交互定稿：自然周更易触顶，优先关注）.
      const barLabels = [
        ...planBlock.querySelectorAll(".account-plan-bar-label"),
      ].map((el) => el.textContent);
      expect(barLabels).toEqual(["本周", "本月"]);
      // 有生效套餐（mode: plan）⇒ 没有结论行.
      expect(
        screen.queryByTestId("account-plan-conclusion"),
      ).not.toBeInTheDocument();
      // 默认停在套餐维度 ⇒ API 余额整块不渲染（2026-10-09 定稿：套餐没耗尽时
      // 余额不参与计费，默认不占版面）.
      expect(screen.queryByTestId("account-api-quota")).not.toBeInTheDocument();
      expect(screen.queryByTestId("api-quota-info")).not.toBeInTheDocument();
    });

    it("切到余额维度：已用 / 剩余 + ⓘ 说明，到期日随套餐维度隐去", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      fireEvent.click(screen.getByTestId("account-usage-tab-api"));
      const apiBlock = screen.getByTestId("account-api-quota");
      // 金额 ¥ 前缀 + 千位分隔 + 两位小数.
      expect(apiBlock).toHaveTextContent("已用");
      expect(apiBlock).toHaveTextContent("¥1,153.14");
      expect(apiBlock).toHaveTextContent("剩余");
      expect(apiBlock).toHaveTextContent("¥8,846.86");
      expect(apiBlock.querySelector(".is-warning")).toBeNull();
      expect(screen.getByTestId("api-quota-info")).toHaveAttribute(
        "aria-label",
        "API 余额说明",
      );
      // ⓘ 在余额维度的右上角（页签行内），不进金额行——两行金额才能右对齐.
      expect(
        document
          .querySelector(".account-usage-tabs-row")!
          .contains(screen.getByTestId("api-quota-info")),
      ).toBe(true);
      // 套餐块与到期日属套餐维度，余额维度不再渲染.
      expect(screen.queryByTestId("account-plan")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-plan-expire"),
      ).not.toBeInTheDocument();

      // 切回套餐维度：余额块让位、到期日回来.
      fireEvent.click(screen.getByTestId("account-usage-tab-plan"));
      expect(screen.getByTestId("account-plan")).toBeInTheDocument();
      expect(screen.getByTestId("account-plan-expire")).toHaveTextContent(
        "2027-03-01 到期",
      );
      expect(screen.queryByTestId("account-api-quota")).not.toBeInTheDocument();
    });

    it("两维只有一维可用时不渲染切换器，直接展示那一维", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: null, apiQuota: apiPlenty });

      expect(
        screen.queryByTestId("account-usage-tab-plan"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-usage-tab-api"),
      ).not.toBeInTheDocument();
      // 单维也保留块内标题行（没有页签可替代它），ⓘ 落到标题行右侧.
      const apiBlock = screen.getByTestId("account-api-quota");
      expect(apiBlock).toHaveTextContent("API 余额");
      expect(apiBlock.querySelector(".account-api-info-btn")).not.toBeNull();
    });

    it("renders the avatar initial + full email name when logged in", () => {
      renderDesktop();
      pushAccount(loggedIn);

      expect(screen.getByTestId("account-card-avatar")).toHaveTextContent("A");
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "alice@example.com",
      );
    });

    it("reads 0% (normal tone, empty bar) when a window hits its cap, plus the month conclusion line", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "month",
          plan: {
            monthUsed: 1000,
            monthLimit: 1000,
            weekUsed: 60,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: { limit: 5, used: 5 },
      });
      // 余额也耗尽是更严重的那一档 ⇒ 浮层默认停在余额维度；本用例看的是套餐条，
      // 手动切回套餐维度。
      fireEvent.click(screen.getByTestId("account-usage-tab-plan"));

      // 触顶读「0%」、常规色（2026-10-09 交互定稿）：条只表达余量、超用封底到 0，
      // 「哪个窗口用完、现在按什么计费」交给结论行，条上不再单独读「已用尽」+ 琥珀.
      const month = screen.getByTestId("account-plan-month");
      expect(month).toHaveTextContent("0%");
      expect(month).not.toHaveTextContent("已用尽");
      // 不显示负数（0% 封底）.
      expect(month).not.toHaveTextContent("-");
      expect(
        month.querySelector(".account-plan-bar-value.is-normal"),
      ).not.toBeNull();
      expect(month.querySelector('[role="progressbar"]')).toHaveAttribute(
        "aria-valuenow",
        "0",
      );
      // 另一根条不受影响.
      expect(screen.getByTestId("account-plan-week")).toHaveTextContent("88%");

      // 结论行：可自愈 ⇒ 琥珀预警.
      const conclusion = screen.getByTestId("account-plan-conclusion");
      expect(conclusion).toHaveTextContent(
        "本月额度已用尽，当前按 API 余额计费",
      );
      expect(conclusion.classList.contains("is-warning")).toBe(true);

      // 余额维度照常可切：这里余额也耗尽 ⇒ 红色「已用完」.
      fireEvent.click(screen.getByTestId("account-usage-tab-api"));
      const apiRow = screen.getByTestId("account-api-quota");
      expect(
        apiRow.querySelector(".account-usage-value.is-empty"),
      ).not.toBeNull();
      expect(apiRow).toHaveTextContent("已用完");
    });

    it("renders the week conclusion line for a weekly cap", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "week",
          plan: {
            monthUsed: 600,
            monthLimit: 1000,
            weekUsed: 500,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: apiPlenty,
      });

      expect(screen.getByTestId("account-plan-week")).toHaveTextContent("0%");
      expect(screen.getByTestId("account-plan-conclusion")).toHaveTextContent(
        "本周额度已用尽，当前按 API 余额计费",
      );
    });

    it("draws no bar for the two non-numeric cap states (null = 无额度限制, 0 = 不可用)", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "dimension_unavailable",
          plan: {
            monthUsed: 600,
            monthLimit: null,
            weekUsed: 0,
            weekLimit: 0,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: apiPlenty,
      });

      const month = screen.getByTestId("account-plan-month");
      expect(month).toHaveTextContent("无额度限制");
      expect(month.querySelector('[role="progressbar"]')).toBeNull();
      const week = screen.getByTestId("account-plan-week");
      expect(week).toHaveTextContent("不可用");
      expect(week.querySelector('[role="progressbar"]')).toBeNull();
      // 该维度不可用需人工干预 ⇒ 错误色.
      const conclusion = screen.getByTestId("account-plan-conclusion");
      expect(conclusion).toHaveTextContent("套餐额度不可用（限额为 0）");
      expect(conclusion.classList.contains("is-error")).toBe(true);
    });

    it("renders the blocked conclusion without bars (no plan is sent in blocked mode)", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: { mode: "blocked", code: "USER_QUOTA_ZERO" },
        apiQuota: { limit: 5, used: 5 },
      });

      expect(screen.getByTestId("account-plan")).toBeInTheDocument();
      expect(
        screen.queryByTestId("account-plan-month"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("account-plan-week")).not.toBeInTheDocument();
      const conclusion = screen.getByTestId("account-plan-conclusion");
      // 与 proxy 402 同一句话（codechat BLOCKED_INFO 逐字）.
      expect(conclusion).toHaveTextContent(
        "您的 API 额度已用完，请联系公司管理员分配额度后使用！",
      );
      expect(conclusion.classList.contains("is-error")).toBe(true);
    });

    it("uses the expiry date in the conclusion for an expired plan, and hides it when never purchased", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "no_plan",
          plan: { expireDate: "2026-01-31" },
        },
        apiQuota: apiPlenty,
      });

      // 已到期形态只带 expireDate：有到期日、无条.
      expect(screen.getByTestId("account-plan-expire")).toHaveTextContent(
        "2026-01-31 到期",
      );
      expect(
        screen.queryByTestId("account-plan-month"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("account-plan-conclusion")).toHaveTextContent(
        "套餐已到期（2026-01-31 到期），当前按 API 余额计费",
      );

      // 从未购买（plan = null）⇒ 整个套餐块不渲染.
      pushAccount({
        ...loggedIn,
        billing: { mode: "api", reason: "no_plan", plan: null },
        apiQuota: apiPlenty,
      });
      expect(screen.queryByTestId("account-plan")).not.toBeInTheDocument();
    });

    it("renders the enterprise conclusion line while keeping the personal bars (个人读数不受影响)", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "enterprise",
          plan: {
            monthUsed: 600,
            monthLimit: 1000,
            weekUsed: 60,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: apiPlenty,
      });

      // 本人两根条照旧显示个人读数（企业池触顶不改个人数字）.
      expect(screen.getByTestId("account-plan-month")).toHaveTextContent("40%");
      expect(screen.getByTestId("account-plan-week")).toHaveTextContent("88%");
      // 结论行：与月/周同族——下个窗口自动恢复 ⇒ 琥珀预警，不是「需人工干预」的错误色.
      const conclusion = screen.getByTestId("account-plan-conclusion");
      expect(conclusion).toHaveTextContent(
        "企业本期额度已用尽，当前按 API 余额计费",
      );
      expect(conclusion.classList.contains("is-warning")).toBe(true);
    });

    // 结论行对「规格外枚举」的兜底：`reason` / `code` 是开放集合——服务端可能先于客户端
    // 发版新增取值（两端不同机发布），客户端必须认出「不认识」并给一句有信息量的兜底，
    // 而不是静默（空文案红框 / 什么都不画）。2026-09-22 缺陷 3479183306383616 的同款失效。
    describe("计费结论行的枚举兜底", () => {
      const usagePlan = {
        monthUsed: 600,
        monthLimit: 1000,
        weekUsed: 60,
        weekLimit: 500,
        expireDate: "2027-03-01",
      };
      const expiredPlan = { expireDate: "2026-01-31" };

      // 每个已知 reason 都必须渲染出**非空**文案（防「新增分支忘给文案」）。
      it.each([
        { reason: "month", plan: usagePlan },
        { reason: "week", plan: usagePlan },
        { reason: "enterprise", plan: usagePlan },
        { reason: "dimension_unavailable", plan: usagePlan },
        { reason: "no_plan", plan: expiredPlan },
      ])(
        "renders a non-empty conclusion line for the known reason=$reason",
        ({ reason, plan }) => {
          renderDesktop();
          pushUsage({
            ...loggedIn,
            billing: { mode: "api", reason, plan },
            apiQuota: apiPlenty,
          });

          const conclusion = screen.getByTestId("account-plan-conclusion");
          expect(conclusion.textContent?.trim()).toBeTruthy();
        },
      );

      // 三个已知 code（blocked 形态）同理：文案非空 + 错误色。
      it.each(["EXPIRED_NO_API", "USER_QUOTA_ZERO", "TEAM_QUOTA_ZERO"])(
        "renders a non-empty error conclusion line for the known code=%s",
        (code) => {
          renderDesktop();
          pushUsage({
            ...loggedIn,
            billing: { mode: "blocked", code },
            apiQuota: { limit: 5, used: 5 },
          });

          const conclusion = screen.getByTestId("account-plan-conclusion");
          expect(conclusion.textContent?.trim()).toBeTruthy();
          expect(conclusion.classList.contains("is-error")).toBe(true);
        },
      );

      it("falls back to a warning conclusion line for an out-of-spec reason instead of rendering nothing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          renderDesktop();
          pushUsage({
            ...loggedIn,
            billing: {
              mode: "api",
              // 绕过类型：模拟「后端已发版、客户端还不认识这个 reason」。
              reason: "future_reason" as unknown as AccountBillingDegradeReason,
              plan: usagePlan,
            },
            apiQuota: apiPlenty,
          });

          const conclusion = screen.getByTestId("account-plan-conclusion");
          expect(conclusion).toHaveTextContent(
            "套餐额度当前不可用，按 API 余额计费",
          );
          // 未知原因不预设「需人工干预」（error 那档），按会不会自愈的分档规则给琥珀。
          expect(conclusion.classList.contains("is-warning")).toBe(true);
          expect(warn).toHaveBeenCalledWith(
            "未知 billing.reason，已按兜底文案渲染:",
            "future_reason",
          );
        } finally {
          warn.mockRestore();
        }
      });

      it("falls back to a non-empty error conclusion line for an out-of-spec blocked code", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          renderDesktop();
          pushUsage({
            ...loggedIn,
            billing: {
              mode: "blocked",
              // 绕过类型：模拟后端新增了一个客户端不认识的阻断码。
              code: "FUTURE_CODE" as unknown as AccountBillingCode,
            },
            apiQuota: { limit: 5, used: 5 },
          });

          const conclusion = screen.getByTestId("account-plan-conclusion");
          expect(conclusion).toHaveTextContent(
            "当前用量受限，请联系公司管理员",
          );
          expect(conclusion.classList.contains("is-error")).toBe(true);
          // 不是「有结论行元素但文案为空」的空红框。
          expect(conclusion.textContent?.trim()).toBeTruthy();
          expect(warn).toHaveBeenCalledWith(
            "未知 billing.code，已按兜底文案渲染:",
            "FUTURE_CODE",
          );
        } finally {
          warn.mockRestore();
        }
      });
    });

    it("hides the plan block when the host sent no billing at all", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: null, apiQuota: apiPlenty });

      expect(screen.queryByTestId("account-plan")).not.toBeInTheDocument();
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      expect(screen.getByTestId("account-api-quota")).toHaveTextContent(
        "¥8,846.86",
      );
    });

    it("renders no usage area nor collapse button when both billing and apiQuota are absent", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: null, apiQuota: null });

      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("account-usage-btn")).not.toBeInTheDocument();
      // 无用量时个人信息行仍正常.
      expect(screen.getByTestId("account-card-name")).toBeInTheDocument();
    });

    it("shows 不限额 on the balance tab when the API limit is null", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: planBilling,
        apiQuota: { limit: null, used: 1153.14 },
      });

      fireEvent.click(screen.getByTestId("account-usage-tab-api"));
      const apiRow = screen.getByTestId("account-api-quota");
      expect(apiRow).toHaveTextContent("已用");
      expect(apiRow).toHaveTextContent("¥1,153.14");
      // 「剩余」行读「不限额」——该行不出现金额.
      const rows = apiRow.querySelectorAll(".account-usage-row");
      const remaining = rows[rows.length - 1];
      expect(remaining).toHaveTextContent("剩余");
      expect(remaining).toHaveTextContent("不限额");
      expect(remaining).not.toHaveTextContent("¥");
    });
  });

  describe("余额维度（API 余额面板）", () => {
    it("ⓘ 的 tooltip 说明余额只在套餐耗尽后才参与计费", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      fireEvent.click(screen.getByTestId("account-usage-tab-api"));

      const info = screen.getByTestId("api-quota-info");
      expect(info).toHaveAttribute("aria-label", "API 余额说明");
      const tooltip = document.getElementById(
        info.getAttribute("aria-describedby")!,
      );
      expect(tooltip).toHaveTextContent("将在套餐用量耗尽时使用API余额");
    });

    it("warns in amber + 文案 when the balance drops below 20% of the limit", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: planBilling,
        apiQuota: { limit: 1000, used: 950 },
      });

      fireEvent.click(screen.getByTestId("account-usage-tab-api"));
      const apiRow = screen.getByTestId("account-api-quota");
      // 预警色落在「剩余」行（末行）的金额上，「已用」行不受影响.
      const rows = apiRow.querySelectorAll(".account-usage-row");
      const remaining = rows[rows.length - 1];
      const value = remaining.querySelector(".account-usage-value");
      expect(value).not.toBeNull();
      expect(value!.classList.contains("is-warning")).toBe(true);
      expect(apiRow).toHaveTextContent("¥50.00");
      expect(apiRow).toHaveTextContent("余额不足20%，建议及时充值");
    });

    it("reads 已用完 in red with guidance when the balance is exhausted", () => {
      renderDesktop();
      pushUsage({
        ...loggedIn,
        billing: planBilling,
        apiQuota: { limit: 1000, used: 1500 },
      });

      fireEvent.click(screen.getByTestId("account-usage-tab-api"));
      const apiRow = screen.getByTestId("account-api-quota");
      expect(
        apiRow.querySelector(".account-usage-value.is-empty"),
      ).not.toBeNull();
      expect(apiRow).toHaveTextContent("已用完");
      expect(apiRow).toHaveTextContent("额度已用完，请联系管理员充值");
      // 剩余封底 0：不出现负数.
      expect(apiRow).not.toHaveTextContent("¥-");
    });
  });

  describe("用量浮层（点击弹出 / 关闭 / 预警点）", () => {
    it("starts closed by default, and the open state does not persist across remounts", () => {
      const first = renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      // 2026-11 交互改版：卡片初始只露个人信息一行，用量收在浮层里。
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      const trigger = screen.getByTestId("account-usage-btn");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("aria-label", "查看用量");

      // 打开后重挂（等价于重新打开客户端）⇒ 回到关闭态（每次都不展开，不记忆）。
      fireEvent.click(trigger);
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      first.unmount();
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
    });

    it("keeps the trigger clean (no dot) when there is no usage alert", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      expect(
        screen.queryByTestId("account-usage-alert-dot"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("account-usage-btn")).toHaveAttribute(
        "aria-label",
        "查看用量",
      );
    });

    it("shows an amber dot for self-healing warnings (window cap / balance below 20%)", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "week",
          plan: {
            monthUsed: 600,
            monthLimit: 1000,
            weekUsed: 500,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: apiPlenty,
      });

      const dot = screen.getByTestId("account-usage-alert-dot");
      expect(dot.classList.contains("is-warning")).toBe(true);
      // 读屏带上预警语义。
      expect(screen.getByTestId("account-usage-btn")).toHaveAttribute(
        "aria-label",
        "查看用量（有预警）",
      );
    });

    it("shows a red dot for warnings needing human action, and prefers red when both apply", () => {
      renderDesktop();
      // blocked（错误色结论行）+ 余额耗尽（错误色金额）同时成立 ⇒ 红。
      pushAccount({
        ...loggedIn,
        billing: { mode: "blocked", code: "USER_QUOTA_ZERO" },
        apiQuota: { limit: 1000, used: 1500 },
      });

      expect(
        screen
          .getByTestId("account-usage-alert-dot")
          .classList.contains("is-error"),
      ).toBe(true);
    });

    it("keeps the dot while the popover is open (开合不让预警状态闪烁)", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        billing: planBilling,
        apiQuota: { limit: 1000, used: 950 },
      });

      expect(screen.getByTestId("account-usage-alert-dot")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      expect(screen.getByTestId("account-usage-alert-dot")).toBeInTheDocument();
    });

    it("opens on the trigger and closes on a re-click, keeping the same icon", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      // 注意：Tooltip 在浮层打开时会摘掉它那层 wrapper，触发按钮的 DOM 节点会重建
      // ——每次操作后重新查询，别抓着旧节点 click（旧节点已脱离文档）。
      let trigger = screen.getByTestId("account-usage-btn");
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger.querySelector("svg")).not.toBeNull();

      fireEvent.click(trigger);
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      trigger = screen.getByTestId("account-usage-btn");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("aria-label", "查看用量");
      // 开合只切浮层，按钮图标恒为「额度」矢量.
      expect(trigger.querySelector("svg")).not.toBeNull();
    });

    it("closes on outside click and on Esc (Esc returns focus to the trigger)", async () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      // 打开即把焦点交给浮层（dialog 语义）.
      expect(document.activeElement).toBe(
        screen.getByTestId("account-usage-popover"),
      );

      // Outside-click listener 比挂载晚一帧注册（useClickOutside 延迟）。
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.mouseDown(document.body);
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();

      // 再开一次，Esc 关闭并把焦点交还触发按钮.
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      expect(document.activeElement).toBe(
        screen.getByTestId("account-usage-btn"),
      );
    });

    it("keeps focus off the trigger when a mouse user closes with Esc", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      // detail > 0 = 鼠标点击打开。Esc 关闭时不再把焦点塞回按钮——否则按钮进入
      // :focus 态会顺带弹出「查看用量」气泡，而指针早已离开，这条气泡就一直挂着
      // （2026-11-05 用户报的「鼠标移开后还展示提示文案」）。
      fireEvent.click(screen.getByTestId("account-usage-btn"), { detail: 1 });
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(
        screen.getByTestId("account-usage-btn"),
      );
    });

    it("opens on the alerting dimension instead of always on 套餐", () => {
      renderDesktop();
      // 套餐健康、余额耗尽 ⇒ 打开即停在余额维度，不让预警藏在另一页签里.
      pushAccount({
        ...loggedIn,
        billing: planBilling,
        apiQuota: { limit: 1000, used: 1000 },
      });
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-tab-api")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("account-api-quota")).toBeInTheDocument();
    });

    it("opens on 套餐 when the plan is the alerting dimension", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "week",
          plan: {
            monthUsed: 600,
            monthLimit: 1000,
            weekUsed: 500,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: apiPlenty,
      });
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-tab-plan")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("account-plan")).toBeInTheDocument();
    });

    it("prefers the more severe dimension when both alert", () => {
      renderDesktop();
      // 套餐琥珀（周触顶）+ 余额红（耗尽）⇒ 取红那一维.
      pushAccount({
        ...loggedIn,
        billing: {
          mode: "api",
          reason: "week",
          plan: {
            monthUsed: 600,
            monthLimit: 1000,
            weekUsed: 500,
            weekLimit: 500,
            expireDate: "2027-03-01",
          },
        },
        apiQuota: { limit: 1000, used: 1000 },
      });
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-tab-api")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("keeps the personal menu and the usage popover mutually exclusive", () => {
      renderDesktop();
      pushUsage({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      const hotzone = screen.getByTestId("account-card-hotzone");

      // 浮层开着时点热区 ⇒ 菜单打开、浮层收起（同一位置不能叠两层）.
      fireEvent.click(hotzone);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();

      // 菜单开着时点用量按钮 ⇒ 浮层打开、菜单收起.
      fireEvent.click(screen.getByTestId("account-usage-btn"));
      expect(screen.getByTestId("account-usage-popover")).toBeInTheDocument();
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    });
  });

  describe("个人信息行与纯功能菜单", () => {
    it("opens a pure 4-item menu on the hotzone with aria-expanded, and no usage block inside", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      const hotzone = screen.getByTestId("account-card-hotzone");
      expect(hotzone).toHaveAttribute("aria-haspopup", "menu");
      expect(hotzone).toHaveAttribute("aria-expanded", "false");
      // 已登录态没有独立「…」更多按钮.
      expect(screen.queryByTestId("account-card-more")).not.toBeInTheDocument();

      fireEvent.click(hotzone);
      expect(hotzone).toHaveAttribute("aria-expanded", "true");
      const menu = screen.getByTestId("more-menu");
      expect(screen.getByTestId("more-menu-settings")).toHaveTextContent(
        "设置",
      );
      expect(screen.getByTestId("more-menu-enterprise")).toHaveTextContent(
        "企业控制台",
      );
      expect(screen.getByTestId("more-menu-help-docs")).toHaveTextContent(
        "帮助文档",
      );
      expect(screen.getByTestId("more-menu-logout")).toHaveTextContent(
        "退出登录",
      );
      // 纯功能菜单：不含任何用量信息（用量只在浮层里）.
      expect(menu.querySelector(".account-usage-section")).toBeNull();
      expect(menu).not.toHaveTextContent("套餐用量");
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
    });

    it("toggles the menu closed on a second hotzone click and on Esc", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      const hotzone = screen.getByTestId("account-card-hotzone");

      fireEvent.click(hotzone);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();
      fireEvent.click(hotzone);
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();

      fireEvent.click(hotzone);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    });

    it("closes the menu on outside click and returns focus to the hotzone after item Escape", async () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      const hotzone = screen.getByTestId("account-card-hotzone");

      fireEvent.click(hotzone);
      // Outside-click listener registers one tick after the menu mounts
      // (useClickOutside defers it) — wait before simulating the outside click.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();

      fireEvent.click(hotzone);
      const logout = screen.getByTestId("more-menu-logout");
      logout.focus();
      fireEvent.keyDown(logout, { key: "Escape" });
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(hotzone);
    });

    it("annotates 设置/退出登录 with the remote host name", () => {
      renderDesktop("prod");
      pushAccount({
        ...loggedIn,
        billing: planBilling,
        apiQuota: apiPlenty,
      });

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      expect(screen.getByTestId("more-menu-settings")).toHaveTextContent(
        "设置（prod）",
      );
      expect(screen.getByTestId("more-menu-logout")).toHaveTextContent(
        "退出登录（prod）",
      );
    });

    it("opens the settings full-page from the card menu even in the DesktopShell layout", () => {
      const { vscode } = renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      sendCommand("desktopPanes", {
        panes: [{ paneId: "pane-0", sessionId: "s1", host: "local" }],
        focusedPaneId: "pane-0",
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      fireEvent.click(screen.getByTestId("more-menu-settings"));

      expect(
        screen.getByRole("navigation", { name: "设置" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "全局设置" }),
      ).toBeInTheDocument();
    });

    it("opens the help docs at serverUrl + /docs from the menu", () => {
      const { vscode } = renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      act(() => {
        sendHostMessage(
          fixtures.authStatusResponse({
            serverUrl: "https://codechat.example.com/",
          }),
        );
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      fireEvent.click(screen.getByTestId("more-menu-help-docs"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "openExternal",
          url: "https://codechat.example.com/docs/",
        }),
      );
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    });

    it("posts logout from the card menu", () => {
      const { vscode } = renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });

      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      fireEvent.click(screen.getByTestId("more-menu-logout"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "logout" }),
      );
    });
  });

  describe("更新按钮 S0–S6", () => {
    it("hides the update button when no update is available (S0)", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, billing: planBilling, apiQuota: apiPlenty });
      expect(
        screen.queryByTestId("account-update-btn"),
      ).not.toBeInTheDocument();

      pushAccount({ ...loggedIn, update: { available: false } });
      expect(
        screen.queryByTestId("account-update-btn"),
      ).not.toBeInTheDocument();
    });

    it("shows 更新 (S1); clicking opens the S2 confirm dialog with the version; Esc cancels without downloading", () => {
      const { vscode } = renderDesktop();
      pushAccount({
        ...loggedIn,
        billing: planBilling,
        apiQuota: apiPlenty,
        update: { available: true, version: "1.2.0", status: "idle" },
      });

      const btn = screen.getByTestId("account-update-btn");
      expect(btn).toHaveTextContent("更新");
      vscode.postMessage.mockClear();

      fireEvent.click(btn);
      expect(screen.getByText("更新到新版本")).toBeInTheDocument();
      expect(
        screen.getByText(/将下载并安装新版本 v1\.2\.0/),
      ).toBeInTheDocument();
      expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
        "取消",
      );
      expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
        "下载更新",
      );

      // Esc 关闭 = 取消：不发命令.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByText("更新到新版本")).not.toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopUpdateDownload" }),
      );
    });

    it("posts desktopUpdateDownload on S2 confirm; downloading disables the button (S3)", () => {
      const { vscode } = renderDesktop();
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "idle" },
      });
      vscode.postMessage.mockClear();

      fireEvent.click(screen.getByTestId("account-update-btn"));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopUpdateDownload" }),
      );
      expect(screen.queryByText("更新到新版本")).not.toBeInTheDocument();

      // 宿主推送 downloading：按钮「正在下载」+ 转圈弧 disabled（无省略号）.
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "downloading" },
      });
      const btn = screen.getByTestId("account-update-btn");
      expect(btn).toHaveTextContent("正在下载");
      expect(btn).not.toHaveTextContent("…");
      expect(btn.querySelector("svg")).not.toBeNull();
      expect(btn).toHaveAttribute("aria-busy", "true");
      expect(btn).toBeDisabled();

      // 下载中点击无反应：不弹框、不发命令.
      vscode.postMessage.mockClear();
      fireEvent.click(btn);
      expect(screen.queryByText("更新到新版本")).not.toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopUpdateDownload" }),
      );
    });

    it("auto-pops the S4 restart dialog once when status becomes ready; 稍后 turns the button into 重启", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "downloading" },
      });

      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "ready" },
      });
      expect(screen.getByText("重启以完成更新")).toBeInTheDocument();
      expect(screen.getByText(/重启会中断正在运行的任务/)).toBeInTheDocument();
      expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
        "稍后",
      );
      expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
        "立即重启",
      );

      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
      expect(screen.queryByText("重启以完成更新")).not.toBeInTheDocument();
      expect(screen.getByTestId("account-update-btn")).toHaveTextContent(
        "重启",
      );

      // 每轮就绪只自动弹一次：重复推送同一 ready 快照不再弹.
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "ready" },
      });
      expect(screen.queryByText("重启以完成更新")).not.toBeInTheDocument();
    });

    it("re-opens the S4 dialog from the 重启 button and posts desktopUpdateRestart on 立即重启", () => {
      const { vscode } = renderDesktop();
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "ready" },
      });
      // 先稍后.
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("account-update-btn"));
      expect(screen.getByText("重启以完成更新")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopUpdateRestart" }),
      );
      expect(screen.queryByText("重启以完成更新")).not.toBeInTheDocument();
    });

    it("recovers to 更新 when the host pushes idle after a failed download", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "downloading" },
      });
      expect(screen.getByTestId("account-update-btn")).toHaveTextContent(
        "正在下载",
      );

      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "idle" },
      });
      const btn = screen.getByTestId("account-update-btn");
      expect(btn).toHaveTextContent("更新");
      expect(btn).not.toBeDisabled();
    });
  });
});
