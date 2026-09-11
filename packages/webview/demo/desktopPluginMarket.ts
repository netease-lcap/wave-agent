import type { Page } from "@playwright/test";
import { expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";

/**
 * 桌面端「设置页 → 插件市场」打开助手（插件市场迁入设置页后，桌面截图不再走
 * 聊天区的 showDialog(plugin) 弹窗）。
 *
 * 入口链：账户卡片 → 更多菜单 → 设置 → 左侧导航「插件市场」。账户卡片依赖
 * desktopAccountInfo（未登录时卡片不可点，更多菜单也无法展开）。
 */
export async function openPluginMarket(
  webviewPage: Page,
  injector: MessageInjector,
  data: {
    marketplaces: { name: string }[];
    plugins: Record<string, unknown>[];
  },
): Promise<void> {
  await injector.simulateExtensionMessage("desktopAccountInfo", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
    plan: { monthlyQuota: 100, months: 12, used: 240 },
    apiQuota: { limit: null, used: 1153.14 },
  });
  await expect(webviewPage.getByTestId("account-card")).toBeVisible();
  await webviewPage.getByTestId("account-card-hotzone").click();
  await webviewPage.getByTestId("more-menu-settings").click();
  await expect(webviewPage.locator(".settings-page")).toBeVisible();
  await webviewPage
    .locator(".settings-nav-item", { hasText: "插件市场" })
    .click();
  await expect(
    webviewPage.getByRole("heading", { name: "插件市场" }),
  ).toBeVisible();

  await injector.simulateExtensionMessage("listMarketplacesResponse", {
    marketplaces: data.marketplaces,
  });
  await injector.simulateExtensionMessage("listPluginsResponse", {
    plugins: data.plugins,
  });
  await expect(webviewPage.locator(".settings-plugin-list")).toBeVisible();
}
