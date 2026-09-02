import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, act, within } from "@testing-library/react";
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

const loggedIn = { user: { id: "u1", email: "alice@example.com" } };

describe("AccountCard (desktop sidebar)", () => {
  it("renders the login button with a more button when logged out, and posts login on click", () => {
    const { vscode } = renderDesktop();
    pushAccount({ isAuthenticated: false });

    const login = screen.getByTestId("account-card-login");
    expect(login).toHaveTextContent("登 录");
    // 未登录时「更多」按钮常驻，菜单含登录项（对齐设计师原型）。
    const more = screen.getByTestId("account-card-more");
    expect(more).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();
    expect(screen.getByText(/登录/)).toBeInTheDocument();
    vscode.postMessage.mockClear();
    fireEvent.click(login);
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "login" }),
    );
  });

  it("renders the avatar initial + email-prefix name when logged in", () => {
    renderDesktop();
    pushAccount(loggedIn);

    expect(screen.getByTestId("account-card-avatar")).toHaveTextContent("A");
    expect(screen.getByTestId("account-card-name")).toHaveTextContent("alice");
  });

  it("renders the inline usage summary and opens the pure-function menu on hotzone click", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: 10000, used: 1153.14 },
    });

    // 常驻概要区（交互设计 §3：卡片上半部分；唯一进度条带 progressbar 角色）
    const inline = screen.getByTestId("account-card-usage");
    expect(inline).toHaveTextContent("80%");
    // API 余额默认仅展示剩余金额（明细在气泡中，交互设计 §2.4）
    expect(inline).toHaveTextContent("¥8,846.86");
    expect(inline).not.toHaveTextContent("已用");
    expect(inline.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(inline.querySelector('[role="progressbar"]')).toHaveAttribute(
      "aria-valuenow",
      "80",
    );

    // 点击个人信息热区 → 纯功能菜单（设置/企业控制台/帮助文档/退出登录）。
    fireEvent.click(screen.getByTestId("account-card-hotzone"));

    const menu = screen.getByTestId("more-menu");
    expect(menu).toBeInTheDocument();
    // 菜单不再展示用量信息（用量由常驻区承载）
    expect(within(menu).queryByText("套餐用量")).not.toBeInTheDocument();
    expect(within(menu).queryByText("API 余额")).not.toBeInTheDocument();
    expect(screen.getByTestId("more-menu-settings")).toHaveTextContent("设置");
    expect(screen.getByTestId("more-menu-enterprise")).toHaveTextContent(
      "企业控制台",
    );
    expect(screen.getByTestId("more-menu-help-docs")).toHaveTextContent(
      "帮助文档",
    );
    expect(screen.getByTestId("more-menu-logout")).toHaveTextContent(
      "退出登录",
    );
  });

  it("shows the exhausted banner in red at 0% plan remaining (inline usage area)", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 20 },
      apiQuota: { limit: 5, used: 5 },
    });

    const plan = screen.getByTestId("account-plan");
    expect(plan).toHaveTextContent("0%");
    expect(plan.querySelector(".is-empty")).not.toBeNull();
    expect(screen.getByTestId("account-plan-exhausted")).toHaveTextContent(
      "套餐余量已用完，请联系销售人员充值",
    );
    expect(screen.getByTestId("account-api-quota")).toHaveTextContent("已用完");
  });

  it("shows 不限额 when the API quota limit is null (shared team balance, no per-user cap)", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 1153.14 },
    });

    // 不限额：行内展示「不限额」（已用金额收进气泡）
    expect(screen.getByTestId("account-api-quota")).toHaveTextContent("不限额");
    expect(screen.getByTestId("account-api-quota")).not.toHaveTextContent(
      "¥1,153.14",
    );
    fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
    const popover = screen.getByTestId("api-quota-popover");
    expect(popover).toHaveTextContent("已用");
    expect(popover).toHaveTextContent("¥1,153.14");
    // 气泡「剩余」行：提示「不限额」
    expect(popover).toHaveTextContent("剩余");
    expect(popover).toHaveTextContent("不限额");
  });

  it("opens the API balance detail popover on info-icon hover (not on amount click)", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: 10000, used: 1153.14 },
    });

    // 默认行内仅金额（label 已是「API 余额」，无「剩余」前缀）；hover info 图标弹气泡，点击金额不弹
    const row = screen.getByTestId("account-api-quota");
    expect(row).toHaveTextContent("¥8,846.86");
    expect(row).not.toHaveTextContent("已用 ¥");

    // 点击金额文本区域不触发气泡（触发热区仅限 ⓘ）
    fireEvent.click(row.querySelector(".account-usage-value-text")!);
    expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
    const popover = screen.getByTestId("api-quota-popover");
    expect(popover).toHaveTextContent("已用");
    expect(popover).toHaveTextContent("¥1,153.14");
    expect(popover).toHaveTextContent("剩余");
    expect(popover).toHaveTextContent("¥8,846.86");
    // 气泡金额列右对齐（.api-popover-amt 样式 tabular-nums + right 对齐）
    const amt = popover.querySelectorAll(".api-popover-amt");
    expect(amt.length).toBeGreaterThanOrEqual(2);

    // 点气泡外部（菜单热区）→ 关闭
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("api-quota-popover")).not.toBeInTheDocument();
  });

  it("warns in amber when remaining is below 20% of the limit, with popover note", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: 10000, used: 9000 }, // 剩余 1000 < 2000（20%）
    });

    // 行内仅金额变色（is-warning），无其他红色元素
    const row = screen.getByTestId("account-api-quota");
    expect(row).toHaveTextContent("¥1,000.00");
    const value = row.querySelector(".account-usage-value");
    expect(value?.classList.contains("is-warning")).toBe(true);
    expect(
      row
        .querySelector(".account-usage-label")
        ?.classList.contains("is-warning"),
    ).toBe(false);

    fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
    expect(screen.getByTestId("api-quota-popover")).toHaveTextContent(
      "余额不足",
    );
  });

  it("shows the exhausted red amount and popover warning when remaining hits 0", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: 500, used: 500 },
    });

    const row = screen.getByTestId("account-api-quota");
    expect(row).toHaveTextContent("已用完");
    expect(
      row.querySelector(".account-usage-value")?.classList.contains("is-empty"),
    ).toBe(true);
    fireEvent.mouseEnter(screen.getByTestId("api-quota-info"));
    expect(screen.getByTestId("api-quota-popover")).toHaveTextContent(
      "额度已用完，请联系管理员充值",
    );
  });

  it("renders no inline usage area when neither plan nor apiQuota was pushed", () => {
    renderDesktop();
    pushAccount({ ...loggedIn, plan: null, apiQuota: null });

    // 未下发用量 → 卡片内不渲染常驻用量区（交互设计：未配置套餐 → 用量区整体消失）
    expect(screen.queryByTestId("account-card-usage")).not.toBeInTheDocument();
    // 菜单仍可打开
    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();
  });

  it("annotates the menu entries with the remote host label", () => {
    renderDesktop("prod");
    pushAccount({
      isAuthenticated: false,
      user: null,
      plan: null,
      apiQuota: null,
    });
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("more-menu-settings")).toHaveTextContent(
      "设置（prod）",
    );
    expect(screen.getByTestId("more-menu-logout")).toHaveTextContent(
      "退出登录（prod）",
    );
  });

  it("closes the merged menu on outside click and on Escape", () => {
    renderDesktop();
    pushAccount(loggedIn);

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("collapses and re-expands the inline usage area independently of the menu", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });

    expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("account-usage-collapse"));
    expect(screen.queryByTestId("account-card-usage")).not.toBeInTheDocument();

    // 收起后打开菜单：常驻区保持收起、菜单为纯功能菜单（不含用量）
    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("account-card-usage")).not.toBeInTheDocument();
    expect(screen.queryByText("套餐用量")).not.toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    // 关闭菜单不改变常驻区显隐（仍收起）
    expect(screen.queryByTestId("account-card-usage")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-usage-collapse"));
    expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
  });

  it("clicks the hotzone again to close the menu; the menu never hides the inline usage", () => {
    renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });
    // 常驻区保持可见
    expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();

    // 第一次点击打开
    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();
    // 打开菜单不影响常驻用量区
    expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();

    // 第二次点击热区 → 收起面板
    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("account-card-usage")).toBeInTheDocument();
  });

  it("opens the settings full-page from the merged menu's 设置 entry even in the DesktopShell layout", () => {
    // Regression from the removed sidebar header 更多 (FR-037 → account card):
    // with panes present the root renders DesktopShell, and the account card
    // 设置 entry must still open the settings page (not the legacy dialog).
    const { vscode } = renderDesktop();
    pushAccount({
      ...loggedIn,
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });
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

  it("posts logout from the merged menu", () => {
    const { vscode } = renderDesktop();
    pushAccount(loggedIn);

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    fireEvent.click(screen.getByTestId("more-menu-logout"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "logout" }),
    );
  });

  it("shows the update button (S1) and walks the S2 download confirmation", () => {
    const { vscode } = renderDesktop();
    pushAccount({
      ...loggedIn,
      update: { available: true, version: "1.2.0", status: "idle" },
    });

    const btn = screen.getByTestId("account-update-btn");
    expect(btn).toHaveTextContent("更新");

    fireEvent.click(btn);
    expect(
      screen.getByRole("alertdialog", { name: "更新到新版本" }),
    ).toHaveTextContent("v1.2.0");

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopUpdateDownload" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("disables the button while downloading and auto-prompts restart on ready", () => {
    const { vscode } = renderDesktop();
    pushAccount({
      ...loggedIn,
      update: { available: true, version: "1.2.0", status: "downloading" },
    });

    const btn = screen.getByTestId("account-update-btn");
    expect(btn).toHaveTextContent("正在下载更新…");
    expect(btn).toBeDisabled();

    // 宿主推 status="ready" → S4 自动弹重启确认
    act(() => {
      sendHostMessage(
        fixtures.desktopAccountInfo({
          ...loggedIn,
          update: { available: true, version: "1.2.0", status: "ready" },
        }),
      );
    });
    expect(
      screen.getByRole("alertdialog", { name: "重启以完成更新" }),
    ).toBeInTheDocument();

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopUpdateRestart" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("hides the update button when no update is available", () => {
    renderDesktop();
    pushAccount(loggedIn);

    expect(screen.queryByTestId("account-update-btn")).not.toBeInTheDocument();
  });
});
