import { describe, it, expect, vi } from "vitest";
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
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });

    expect(screen.getByTestId("account-card-avatar")).toHaveTextContent("A");
    expect(screen.getByTestId("account-card-name")).toHaveTextContent("alice");
  });

  it("opens the usage popup on hotzone click with plan percent and formatted API quota", () => {
    renderDesktop();
    pushAccount({
      user: { id: "u1", email: "alice@example.com" },
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: 10000, used: 1153.14 },
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));

    const popup = screen.getByTestId("account-usage-popup");
    expect(popup).toBeInTheDocument();
    // 套餐余量 80%（100×12 中已用 240）
    expect(screen.getByTestId("account-plan")).toHaveTextContent("套餐用量");
    expect(screen.getByTestId("account-plan")).toHaveTextContent("80%");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    // API 额度：千位分隔 + 两位小数
    expect(screen.getByTestId("account-api-quota")).toHaveTextContent(
      "剩余 ¥8,846.86",
    );
    expect(
      screen.queryByTestId("account-plan-exhausted"),
    ).not.toBeInTheDocument();
  });

  it("shows the exhausted banner in red at 0% plan remaining", () => {
    renderDesktop();
    pushAccount({
      user: { id: "u1", email: "bob@example.com" },
      plan: { monthlyQuota: 10, months: 1, used: 20 },
      apiQuota: { limit: 5, used: 5 },
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));

    expect(screen.getByTestId("account-plan")).toHaveTextContent("0%");
    expect(
      screen.getByTestId("account-plan").querySelector(".is-empty"),
    ).not.toBeNull();
    expect(screen.getByTestId("account-plan-exhausted")).toHaveTextContent(
      "套餐余量已用完，请联系销售人员充值",
    );
    expect(screen.getByTestId("account-api-quota")).toHaveTextContent("已用完");
  });

  it("shows 已消耗金额 when the API quota limit is null (shared team balance)", () => {
    renderDesktop();
    pushAccount({
      user: { id: "u1", email: "bob@example.com" },
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 1153.14 },
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("account-api-quota")).toHaveTextContent(
      "已消耗 ¥1,153.14",
    );
  });

  it("shows 暂无用量数据 when neither plan nor apiQuota was pushed", () => {
    renderDesktop();
    pushAccount({
      user: { id: "u1", email: "bob@example.com" },
      plan: null,
      apiQuota: null,
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("account-usage-empty")).toHaveTextContent(
      "暂无用量数据",
    );
  });

  it("annotates the popup with the remote host label", () => {
    renderDesktop("prod");
    pushAccount({
      isAuthenticated: false,
      user: null,
      plan: null,
      apiQuota: null,
    });
    pushAccount({
      user: { id: "u1", email: "alice@example.com" },
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("account-usage-host")).toHaveTextContent("prod");
  });

  it("closes the usage popup on outside click and on Escape", () => {
    renderDesktop();
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    expect(screen.getByTestId("account-usage-popup")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("account-usage-popup")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-card-hotzone"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("account-usage-popup")).not.toBeInTheDocument();
  });

  it("toggles the update button label by update state, disabled while downloading", () => {
    renderDesktop();
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });
    // update=null（未推送）时不渲染更新按钮
    expect(screen.queryByTestId("account-card-update")).not.toBeInTheDocument();

    pushAccount({ update: "available" });
    expect(screen.getByTestId("account-card-update")).toHaveTextContent("更新");

    pushAccount({ update: "downloading" });
    const btn = screen.getByTestId("account-card-update");
    expect(btn).toHaveTextContent("正在下载更新…");
    expect(btn).toBeDisabled();

    pushAccount({ update: "ready" });
    expect(screen.getByTestId("account-card-update")).toHaveTextContent("重启");
  });

  it("confirms the download: Esc/取消 close, scrim click does not, 下载 posts desktopUpdateApp", () => {
    const { vscode } = renderDesktop();
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });
    pushAccount({ update: "available" });

    // 点「更新」→ 下载确认框
    fireEvent.click(screen.getByTestId("account-card-update"));
    const dialog = screen.getByTestId("account-update-dialog-overlay");
    expect(dialog).toHaveTextContent("发现新版本");
    expect(dialog).toHaveTextContent("是否下载更新？下载完成后可重启安装。");

    // 点击遮罩不关闭（仅 Esc/取消可关）
    fireEvent.click(dialog);
    expect(
      screen.getByTestId("account-update-dialog-overlay"),
    ).toBeInTheDocument();

    // Esc 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByTestId("account-update-dialog-overlay"),
    ).not.toBeInTheDocument();

    // 取消关闭
    fireEvent.click(screen.getByTestId("account-card-update"));
    fireEvent.click(screen.getByTestId("account-update-dialog-cancel"));
    expect(
      screen.queryByTestId("account-update-dialog-overlay"),
    ).not.toBeInTheDocument();

    // 确认 → desktopUpdateApp
    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("account-card-update"));
    fireEvent.click(screen.getByTestId("account-update-dialog-confirm"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopUpdateApp" }),
    );
    expect(
      screen.queryByTestId("account-update-dialog-overlay"),
    ).not.toBeInTheDocument();
  });

  it("auto-opens the restart confirm only on the downloading→ready transition", () => {
    const { vscode } = renderDesktop();
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });

    // 无 downloading 铺垫的 ready（如登录推送重放）不弹重启确认
    pushAccount({ update: "ready" });
    expect(
      screen.queryByTestId("account-update-dialog-overlay"),
    ).not.toBeInTheDocument();
    pushAccount({ update: null });

    // available → downloading → ready 转变才弹
    pushAccount({ update: "available" });
    pushAccount({ update: "downloading" });
    pushAccount({ update: "ready" });
    expect(
      screen.getByTestId("account-update-dialog-overlay"),
    ).toHaveTextContent("更新已就绪");

    // 「稍后」关闭；按钮仍显示「重启」，可再弹
    fireEvent.click(screen.getByTestId("account-update-dialog-cancel"));
    expect(
      screen.queryByTestId("account-update-dialog-overlay"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("account-card-update"));
    expect(
      screen.getByTestId("account-update-dialog-overlay"),
    ).toHaveTextContent("更新已就绪");

    // 「重启」→ desktopRestartApp
    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("account-update-dialog-confirm"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopRestartApp" }),
    );
  });

  it("opens the shared MoreMenu from the 更多 button with all four entries", () => {
    const { vscode } = renderDesktop();
    pushAccount({
      user: { id: "u1", email: "alice@example.com" },
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });

    fireEvent.click(screen.getByTestId("account-card-more"));

    expect(screen.getByTestId("more-menu")).toBeInTheDocument();
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

    // 帮助文档 → serverUrl + /docs（登录态下 serverUrl 在 config 里）
    act(() => {
      sendCommand("configurationResponse", {
        configurationData: { serverUrl: "https://codechat.example.com/" },
      });
    });
    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("more-menu-help-docs"));
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "openExternal",
        url: "https://codechat.example.com/docs",
      }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("opens the settings full-page from the card's 设置 entry even in the DesktopShell layout", () => {
    // Regression from the removed sidebar header 更多 (FR-037 → account card):
    // with panes present the root renders DesktopShell, and the account card
    // 设置 entry must still open the settings page (not the legacy dialog).
    const { vscode } = renderDesktop();
    pushAccount({
      user: { id: "u1", email: "alice@example.com" },
      plan: { monthlyQuota: 10, months: 1, used: 2 },
      apiQuota: { limit: null, used: 0 },
    });
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-0", sessionId: "s1", host: "local" }],
      focusedPaneId: "pane-0",
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("account-card-more"));
    fireEvent.click(screen.getByTestId("more-menu-settings"));

    expect(
      screen.getByRole("navigation", { name: "设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "全局设置" }),
    ).toBeInTheDocument();
  });

  it("posts logout from the card's more menu", () => {
    const { vscode } = renderDesktop();
    pushAccount({ user: { id: "u1", email: "alice@example.com" } });

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("account-card-more"));
    fireEvent.click(screen.getByTestId("more-menu-logout"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "logout" }),
    );
  });
});
