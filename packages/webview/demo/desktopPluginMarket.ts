import type { Page } from "@playwright/test";
import { expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";

/** host 下发的市场（KnownMarketplace 子集）：官方内置市场带 `isBuiltin`；市场 tab
 *  直接显示这里的 `name`（spec A-011），内置标记只用于「管理」弹窗的只读判定。 */
type MarketplacePayload = { name: string; isBuiltin?: boolean };

/**
 * 桌面端「侧边栏（新对话下方）→ 插件市场整页」打开助手
 * （spec ecosystem/plugin.md「插件市场」场景 1/2）。
 *
 * 桌面端只有这一个入口：设置页的左侧导航里没有「插件市场」项（场景 3 / A-016），
 * 在对话里输入 `/plugin` 也落到同一个整页（场景 4）。入口高亮态由 host 侧规则与
 * 「活动」按钮同源，故这里顺带断言 aria-pressed。
 */
export async function openPluginMarketFromSidebar(
  webviewPage: Page,
  injector: MessageInjector,
  data: {
    marketplaces: MarketplacePayload[];
    plugins: Record<string, unknown>[];
    /** 锚点工程（spec A-018）：宿主在 listPluginsResponse 里回带的「当前工程」——
     *  桌面端即当前选中对话所属工程。弹窗的 project / local 两档与作用域气泡都相对
     *  它讲；不传即「锚点为空」，那两档在界面上置灰。 */
    anchorWorkdir?: string;
  },
): Promise<void> {
  const entry = webviewPage.getByTestId("desktop-plugin-market");
  await entry.click();
  await expect(webviewPage.getByTestId("plugin-market-page")).toBeVisible();
  await expect(entry).toHaveAttribute("aria-pressed", "true");

  await injector.simulateExtensionMessage("listMarketplacesResponse", {
    marketplaces: data.marketplaces,
  });
  await injector.simulateExtensionMessage("listPluginsResponse", {
    plugins: data.plugins,
    anchorWorkdir: data.anchorWorkdir,
  });
  // 后台清单刷新已完成（宿主带 refreshed 标记的补发）：截图不带瞬态的「检查更新中」
  // （补发与首次回包同源，anchorWorkdir 一并回带 —— 否则作用域气泡会被清成「未知」）
  await injector.simulateExtensionMessage("listPluginsResponse", {
    plugins: data.plugins,
    anchorWorkdir: data.anchorWorkdir,
    refreshed: true,
  });
  await expect(webviewPage.locator(".settings-plugin-list")).toBeVisible();
}
