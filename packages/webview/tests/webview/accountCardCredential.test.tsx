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
 * 账户卡片的「认证方式」三形态（spec `docs/specs/desktop/desktop-account.md`
 * 「账户卡片 · 认证方式（企业账号 / 自定义网关 / 无凭据）」）。
 *
 * 核心口径：卡片形态由宿主下发的 `credential` 决定，不是「登录 / 未登录」二分——
 * 没登录企业账号但配了 `WAVE_API_KEY` 的人照样能发消息，卡片要如实说「自定义
 * 网关」，而不是给他一颗「登录」按钮。`credential` 缺失（旧宿主）时才回落到
 * `isAuthenticated`。
 *
 * 几何断言（行业高 / 卡片总高不随形态变化、主文本不截断）需要真布局，放在
 * `e2e/desktop-account-credential.e2e.ts`；这里覆盖形态、菜单项与交互。
 */

/** 渲染桌面端根实例（选好 workdir → 侧边栏出现），再推一份账户快照。 */
function renderDesktop() {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: [],
    host: "local",
  });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  return { ...result, vscode };
}

function pushAccount(overrides: Record<string, unknown>) {
  act(() => {
    sendHostMessage(fixtures.desktopAccountInfo(overrides));
  });
}

const ssoAccount = {
  isAuthenticated: true,
  credential: { kind: "sso" as const },
  user: { id: "user-1", email: "alice@example.com" },
};

const gatewayAccount = {
  isAuthenticated: false,
  credential: {
    kind: "gateway" as const,
    gateway: { host: "api.example.com" },
  },
  user: null,
};

describe("AccountCard · 认证方式（三形态）", () => {
  describe("企业账号（credential.kind = sso）", () => {
    it("保持既有登录态：头像首字母 + 邮箱前缀 + 热区开 4 项菜单", () => {
      renderDesktop();
      pushAccount({
        ...ssoAccount,
        update: { available: true, version: "1.2.3" },
      });

      expect(screen.getByTestId("account-card-avatar")).toBeInTheDocument();
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "alice@example.com",
      );
      // 应用更新与凭据无关：企业账号形态照常渲染更新按钮。
      expect(screen.getByTestId("account-update-btn")).toBeInTheDocument();
      // 已登录形态没有尾部「更多」按钮（入口是个人信息行热区）。
      expect(screen.queryByTestId("account-card-more")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      expect(screen.getByTestId("more-menu-settings")).toBeInTheDocument();
      expect(screen.getByTestId("more-menu-enterprise")).toBeInTheDocument();
      expect(screen.getByTestId("more-menu-help-docs")).toBeInTheDocument();
      expect(screen.getByTestId("more-menu-logout")).toBeInTheDocument();
      // 本机没有网关凭据 ⇒ 退出登录不带后果副标题。
      expect(
        screen.queryByTestId("more-menu-logout-subtitle"),
      ).not.toBeInTheDocument();
    });

    it("双凭据（sso + 网关）时「退出登录」带后果副标题", () => {
      renderDesktop();
      pushAccount({
        ...ssoAccount,
        credential: {
          kind: "sso",
          gateway: { host: "api.example.com" },
        },
      });

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      expect(screen.getByTestId("more-menu-logout-subtitle")).toHaveTextContent(
        "退出后使用自定义网关 api.example.com",
      );
    });

    it("点「退出登录」后直接落到网关形态（不经过「无凭据 + 登录按钮」中间态）", () => {
      const { vscode } = renderDesktop();
      pushAccount({
        ...ssoAccount,
        credential: {
          kind: "sso",
          gateway: { host: "api.example.com" },
        },
      });

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      fireEvent.click(screen.getByTestId("more-menu-logout"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "logout" }),
      );

      // 宿主回 logoutResponse（此刻 fresh 的 authStatus 还没到）：卡片按 sso 形态
      // 自带的 gateway 预测「退出后会落到那份凭据」，直接渲染网关形态。
      act(() => {
        sendHostMessage({ command: "logoutResponse", success: true });
      });
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "自定义网关",
      );
      expect(
        screen.queryByTestId("account-card-login"),
      ).not.toBeInTheDocument();
    });
  });

  describe("自定义网关（credential.kind = gateway）", () => {
    it("个人信息行同构：网关图标 + 「自定义网关」，域名只进 title", () => {
      renderDesktop();
      pushAccount({
        ...gatewayAccount,
        update: { available: true, version: "1.2.3" },
      });

      expect(screen.getByTestId("account-card-gateway")).toBeInTheDocument();
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "自定义网关",
      );
      const hotzone = screen.getByTestId("account-card-hotzone");
      expect(hotzone).toHaveAttribute("title", "自定义网关 · api.example.com");
      // 域名不进可见文本（卡片只有约 235px 宽，同行会被两端 ellipsis）。
      expect(hotzone).not.toHaveTextContent("api.example.com");
      // 更新按钮照常（app-global，与凭据无关）；没有尾部「更多」按钮。
      expect(screen.getByTestId("account-update-btn")).toBeInTheDocument();
      expect(screen.queryByTestId("account-card-more")).not.toBeInTheDocument();
      // 不发登录按钮。
      expect(
        screen.queryByTestId("account-card-login"),
      ).not.toBeInTheDocument();
    });

    it("菜单恰为 3 项：设置 / 帮助文档 / 登录企业账号（无企业控制台、无退出登录）", () => {
      const { vscode } = renderDesktop();
      pushAccount(gatewayAccount);

      fireEvent.click(screen.getByTestId("account-card-hotzone"));
      expect(screen.getByTestId("more-menu-settings")).toBeInTheDocument();
      expect(screen.getByTestId("more-menu-help-docs")).toHaveTextContent(
        "帮助文档",
      );
      expect(screen.getByTestId("more-menu-login-sso")).toHaveTextContent(
        "登录企业账号",
      );
      expect(
        screen.queryByTestId("more-menu-enterprise"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("more-menu-logout")).not.toBeInTheDocument();
      expect(screen.queryByTestId("more-menu-login")).not.toBeInTheDocument();

      // 「登录企业账号」走既有 SSO 流程。
      fireEvent.click(screen.getByTestId("more-menu-login-sso"));
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "login" }),
      );
    });

    it("host 缺省（只配了 key）时 title 读「默认端点」，文本仍是「自定义网关」", () => {
      renderDesktop();
      pushAccount({
        isAuthenticated: false,
        credential: { kind: "gateway", gateway: { host: null } },
      });

      expect(screen.getByTestId("account-card-hotzone")).toHaveAttribute(
        "title",
        "自定义网关 · 默认端点",
      );
      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "自定义网关",
      );
    });

    it("即使快照里残留了用量数据，也不给用量入口，且不发核对请求", () => {
      const { vscode } = renderDesktop();
      pushAccount({
        ...gatewayAccount,
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
        apiQuota: { limit: 10000, used: 1153.14 },
      });

      expect(screen.queryByTestId("account-usage-btn")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("account-usage-popover"),
      ).not.toBeInTheDocument();
      expect(vscode.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopRefreshAccountUsage" }),
      );
    });
  });

  describe("无凭据（credential.kind = none）", () => {
    it("保持既有未登录态：整条登录按钮 + 尾部「更多」，菜单含登录项", () => {
      renderDesktop();
      pushAccount({ isAuthenticated: false, credential: { kind: "none" } });

      expect(screen.getByTestId("account-card-login")).toHaveTextContent(
        "登 录",
      );
      expect(screen.getByTestId("account-card-more")).toBeInTheDocument();
      expect(
        screen.queryByTestId("account-card-hotzone"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("account-card-more"));
      expect(screen.getByTestId("more-menu-login")).toBeInTheDocument();
      // 无凭据形态保留企业控制台（与本故事之前的形态逐字一致）。
      expect(screen.getByTestId("more-menu-enterprise")).toBeInTheDocument();
    });
  });

  describe("向后兼容（旧宿主不下发 credential）", () => {
    it("isAuthenticated = true 时按企业账号形态渲染", () => {
      renderDesktop();
      // 快照里显式不带 credential：`...overrides` 覆盖不到默认值，所以直接构造。
      act(() => {
        sendHostMessage({
          command: "desktopAccountInfo",
          isAuthenticated: true,
          user: { id: "user-1", email: "bob@example.com" },
          billing: null,
          apiQuota: null,
        });
      });

      expect(screen.getByTestId("account-card-name")).toHaveTextContent(
        "bob@example.com",
      );
      expect(
        screen.queryByTestId("account-card-login"),
      ).not.toBeInTheDocument();
    });

    it("isAuthenticated = false 时按无凭据形态渲染", () => {
      renderDesktop();
      act(() => {
        sendHostMessage({
          command: "desktopAccountInfo",
          isAuthenticated: false,
          user: null,
          billing: null,
          apiQuota: null,
        });
      });

      expect(screen.getByTestId("account-card-login")).toBeInTheDocument();
    });
  });
});
