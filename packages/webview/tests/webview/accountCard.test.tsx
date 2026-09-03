import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
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
  return { ...result, vscode };
}

function pushAccount(overrides: Record<string, unknown>) {
  act(() => {
    sendHostMessage(fixtures.desktopAccountInfo(overrides));
  });
}

const loggedIn = {
  user: { id: "u1", email: "alice@example.com" },
};
/** 套餐余量 80%：100×12 已用 240. */
const plan80 = { monthlyQuota: 100, months: 12, used: 240 };
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
        plan: plan80,
        apiQuota: apiPlenty,
      });

      expect(
        screen.queryByTestId("account-card-usage"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-usage-collapse"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-card-hotzone"),
      ).not.toBeInTheDocument();
    });
  });

  describe("用量常驻区（套餐用量 + API 余额）", () => {
    it("renders the resident usage area without any click: plan 80% progressbar + API balance", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

      const usage = screen.getByTestId("account-card-usage");
      expect(usage).toBeInTheDocument();
      // 套餐块：标签 + 余量百分比（round）+ progressbar aria-valuenow.
      const planBlock = screen.getByTestId("account-plan");
      expect(planBlock).toHaveTextContent("套餐用量");
      expect(planBlock).toHaveTextContent("80%");
      const bar = planBlock.querySelector('[role="progressbar"]');
      expect(bar).toHaveAttribute("aria-valuenow", "80");
      expect(planBlock.querySelector(".is-empty")).toBeNull();
      // API 余额行：金额 ¥ 前缀 + 千位分隔 + 两位小数；label 已含「余额」不带「剩余」.
      const apiRow = screen.getByTestId("account-api-quota");
      expect(apiRow).toHaveTextContent("API 余额");
      expect(apiRow).toHaveTextContent("¥8,846.86");
      expect(apiRow.querySelector(".is-warning")).toBeNull();
      expect(screen.getByTestId("api-quota-info")).toHaveAttribute(
        "aria-label",
        "API 余额明细",
      );
    });

    it("renders the avatar initial + full email name when logged in", () => {
      renderDesktop();
      pushAccount(loggedIn);

      expect(screen.getByTestId("account-card-avatar")).toHaveTextContent("A");
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "alice@example.com",
      );
    });

    it("shows the exhausted state in red at 0% plan remaining with recharge guidance", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        plan: { monthlyQuota: 10, months: 1, used: 20 },
        apiQuota: { limit: 5, used: 5 },
      });

      const planBlock = screen.getByTestId("account-plan");
      expect(planBlock).toHaveTextContent("0%");
      // 不显示负数（0% 封底）.
      expect(planBlock).not.toHaveTextContent("-");
      expect(
        planBlock.querySelector(".account-usage-bar-fill.is-empty"),
      ).not.toBeNull();
      expect(screen.getByTestId("account-plan-exhausted")).toHaveTextContent(
        "套餐余量已用完，请联系销售人员充值",
      );
      const apiRow = screen.getByTestId("account-api-quota");
      expect(
        apiRow.querySelector(".account-usage-value.is-empty"),
      ).not.toBeNull();
      expect(apiRow).toHaveTextContent("已用完");
    });

    it("hides the plan block when the host sent no plan", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: null, apiQuota: apiPlenty });

      expect(screen.queryByTestId("account-plan")).not.toBeInTheDocument();
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
      expect(screen.getByTestId("account-api-quota")).toHaveTextContent(
        "¥8,846.86",
      );
    });

    it("renders no usage area nor collapse button when both plan and apiQuota are absent", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: null, apiQuota: null });

      expect(
        screen.queryByTestId("account-card-usage"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-usage-collapse"),
      ).not.toBeInTheDocument();
      // 无用量时个人信息行仍正常.
      expect(screen.getByTestId("account-card-name")).toBeInTheDocument();
    });

    it("shows 不限额 for a null API limit and keeps the used amount in the popover instead", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        plan: { monthlyQuota: 10, months: 1, used: 2 },
        apiQuota: { limit: null, used: 1153.14 },
      });

      const apiRow = screen.getByTestId("account-api-quota");
      expect(apiRow).toHaveTextContent("不限额");
      expect(apiRow).not.toHaveTextContent("¥");

      fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
      const popover = screen.getByTestId("api-quota-popover");
      expect(popover).toHaveTextContent("已用");
      expect(popover).toHaveTextContent("¥1,153.14");
      expect(popover).toHaveTextContent("不限额");
    });

    it("does not open the popover when the amount text itself is clicked", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

      fireEvent.click(screen.getByText("¥8,846.86"));
      expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();
    });
  });

  describe("API 明细气泡（hover ⓘ）", () => {
    it("opens on hover/focus of ⓘ, shows used/remaining amounts, closes on outside click and Esc", async () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
      const info = screen.getByTestId("api-quota-info");

      fireEvent.mouseEnter(info);
      let popover = screen.getByTestId("api-quota-popover");
      expect(popover).toHaveTextContent("API 余额");
      expect(popover).toHaveTextContent("已用");
      expect(popover).toHaveTextContent("¥1,153.14");
      expect(popover).toHaveTextContent("剩余");
      expect(popover).toHaveTextContent("¥8,846.86");

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();

      fireEvent.mouseEnter(info);
      popover = screen.getByTestId("api-quota-popover");
      // Outside-click listener registers one tick after the popover mounts
      // (useClickOutside defers it) — wait before simulating the outside click.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();
    });

    it("auto-hides ~150ms after the mouse leaves ⓘ (no flicker between icon and popover)", () => {
      vi.useFakeTimers();
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
      const info = screen.getByTestId("api-quota-info");

      fireEvent.mouseEnter(info);
      expect(screen.getByTestId("api-quota-popover")).toBeInTheDocument();
      fireEvent.mouseLeave(info);
      expect(screen.getByTestId("api-quota-popover")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();
    });

    it("warns in amber when the balance drops below 20% of the limit", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        plan: plan80,
        apiQuota: { limit: 1000, used: 950 },
      });

      // 行内金额预警色 + 文案（无「剩余」前缀）.
      const apiRow = screen.getByTestId("account-api-quota");
      const value = apiRow.querySelector(".account-usage-value");
      expect(value).not.toBeNull();
      expect(value!.classList.contains("is-warning")).toBe(true);
      expect(apiRow).toHaveTextContent("¥50.00");

      fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
      const popover = screen.getByTestId("api-quota-popover");
      expect(popover).toHaveTextContent("¥950.00");
      expect(popover).toHaveTextContent("¥50.00");
      expect(popover).toHaveTextContent("余额不足20%，建议及时充值");
    });

    it("shows the exhausted popover in red with 额度已用完 guidance", () => {
      renderDesktop();
      pushAccount({
        ...loggedIn,
        plan: plan80,
        apiQuota: { limit: 1000, used: 1500 },
      });

      const apiRow = screen.getByTestId("account-api-quota");
      expect(
        apiRow.querySelector(".account-usage-value.is-empty"),
      ).not.toBeNull();
      expect(apiRow).toHaveTextContent("已用完");

      fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
      const popover = screen.getByTestId("api-quota-popover");
      expect(popover).toHaveTextContent("¥0.00");
      expect(popover.querySelector(".api-popover-amt.is-empty")).not.toBeNull();
      expect(popover).toHaveTextContent("额度已用完，请联系管理员充值");
    });
  });

  describe("用量常驻区收起/展开", () => {
    it("collapses the usage area on the toggle button and restores it on re-click", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

      const toggle = screen.getByTestId("account-usage-collapse");
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-label", "收起用量");
      expect(toggle.querySelector("svg")).not.toBeNull();

      fireEvent.click(toggle);
      expect(
        screen.queryByTestId("account-card-usage"),
      ).not.toBeInTheDocument();
      // 卡片仅剩个人信息一行；按钮 icon 换官方「额度」矢量.
      expect(toggle).toHaveAttribute("aria-label", "展开用量");
      expect(toggle.querySelector("svg")).not.toBeNull();

      fireEvent.click(toggle);
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-label", "收起用量");
    });

    it("keeps the collapse state independent of the personal menu (decoupled)", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

      const hotzone = screen.getByTestId("account-card-hotzone");
      // 打开菜单（用量区展开可见）.
      fireEvent.click(hotzone);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();

      // 点显隐按钮收起用量区：菜单保持打开不受影响（解耦）.
      fireEvent.click(screen.getByTestId("account-usage-collapse"));
      expect(
        screen.queryByTestId("account-card-usage"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();

      // 关闭菜单后展开用量区；再开/关菜单不影响显隐.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("account-usage-collapse"));
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();

      fireEvent.click(hotzone);
      expect(screen.getByTestId("more-menu")).toBeInTheDocument();
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
      fireEvent.click(hotzone);
      expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
    });
  });

  describe("个人信息行与纯功能菜单", () => {
    it("opens a pure 4-item menu on the hotzone with aria-expanded, and no usage block inside", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

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
      // 纯功能菜单：不含任何用量信息.
      expect(menu.querySelector(".account-usage-section")).toBeNull();
      expect(menu).not.toHaveTextContent("套餐用量");
      // 菜单开合不影响常驻用量区显隐（解耦）.
      expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
    });

    it("toggles the menu closed on a second hotzone click and on Esc", () => {
      renderDesktop();
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
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
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
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
        plan: plan80,
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
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
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
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
      act(() => {
        sendCommand("configurationResponse", {
          configurationData: { serverUrl: "https://codechat.example.com/" },
        });
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
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });

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
      pushAccount({ ...loggedIn, plan: plan80, apiQuota: apiPlenty });
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
        plan: plan80,
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

      // 宿主推送 downloading：按钮「正在下载更新…」disabled.
      pushAccount({
        ...loggedIn,
        update: { available: true, version: "1.2.0", status: "downloading" },
      });
      const btn = screen.getByTestId("account-update-btn");
      expect(btn).toHaveTextContent("正在下载更新…");
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
        "正在下载更新…",
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
