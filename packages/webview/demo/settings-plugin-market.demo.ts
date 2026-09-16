import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import {
  openSettings,
  simulateHostMessage,
} from "../e2e/utils/settingsHarness.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * 设置页「插件市场」截图（spec ecosystem/plugin「设置页插件市场」）。
 *
 * 插件市场从聊天区的弹窗迁入设置页（`/plugin` 与设置页导航项同一入口），因此
 * 截图走 settings.js 独立 bundle（settingsHarness），不再是 chat bundle 的
 * showDialog(plugin)。
 */

const MARKETPLACES = [
  { name: "wave-plugins-official" },
  { name: "wave-community" },
];

const PLUGINS = [
  {
    id: "git-workflow@wave-plugins-official",
    name: "Git Workflow",
    description: "集成 Git 工作流，支持智能提交信息生成、PR 审查和冲突解决",
    marketplace: "wave-plugins-official",
    installed: false,
    latestVersion: "2.3.1",
  },
  {
    id: "code-reviewer@wave-plugins-official",
    name: "Code Reviewer",
    description:
      "AI 驱动的代码审查工具，自动检测安全漏洞、性能问题和最佳实践违规",
    marketplace: "wave-plugins-official",
    installed: true,
    enabled: true,
    version: "3.1.2",
    latestVersion: "3.2.0",
    scope: "user",
  },
  {
    id: "chrome-devtools@wave-plugins-official",
    name: "Chrome DevTools",
    description: "浏览器自动化与性能分析：抓取网络请求、截图和 Lighthouse 报告",
    marketplace: "wave-plugins-official",
    installed: true,
    enabled: true,
    version: "2.1.0",
    latestVersion: "2.1.0",
    scope: "project",
  },
  {
    id: "database-explorer@wave-community",
    name: "Database Explorer",
    description:
      "连接多种数据库（PostgreSQL、MySQL、MongoDB），支持智能查询和 schema 可视化",
    marketplace: "wave-community",
    installed: false,
    latestVersion: "0.9.5",
  },
  {
    id: "api-docs-generator@wave-community",
    name: "API Docs Generator",
    description: "从代码自动生成 OpenAPI 文档，支持实时预览和交互式测试",
    marketplace: "wave-community",
    installed: false,
    latestVersion: "1.4.0",
  },
];

/** 打开设置页并直达「插件市场」，回发市场与插件列表。 */
async function openPluginMarket(page: Parameters<typeof openSettings>[0]) {
  await openSettings(page, {
    width: 1000,
    height: 760,
    settingsState: { nav: "plugins" },
  });
  await expect(page.getByRole("heading", { name: "插件市场" })).toBeVisible();
  await simulateHostMessage(page, {
    command: "listMarketplacesResponse",
    marketplaces: MARKETPLACES,
  });
  await simulateHostMessage(page, {
    command: "listPluginsResponse",
    plugins: PLUGINS,
  });
  // 打开视图触发的后台清单刷新在宿主侧已完成（只拉检出、不升级插件）：
  // 截图不带瞬态的「检查更新中」，模型 = 宿主带 refreshed 标记的补发
  await simulateHostMessage(page, {
    command: "listPluginsResponse",
    plugins: PLUGINS,
    refreshed: true,
  });
  await expect(page.locator(".settings-plugin-list")).toBeVisible();
}

test.describe("设置页插件市场截图", () => {
  test("市场列表 / 版本三态 / 作用域弹窗 / 新建市场 / 搜索过滤", async ({
    webviewPage,
  }) => {
    await openPluginMarket(webviewPage);

    // 市场 Tab 带插件计数，默认选中第一个市场
    await expect(
      webviewPage.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(webviewPage.locator(".settings-tab")).toHaveCount(2);

    /* 「新建市场」的层级（设计师 0915 走查）：它是全局入口，落在**页头**里
       （标题块 + 右上角按钮），整条位于市场栏之上，不再与市场 tab 同一行。
       下面的断言表达这三件事，不依赖任何两个元素右缘恰好相等：
       - 按钮的盒子整个落在页头容器内（不溢出）；
       - 按钮在页头标题块右侧（与 h1/p 不重叠）；
       - 按钮底边不低于市场栏顶边（= 属于页头那一行，不在工具栏一行）。 */
    const headerBox = (await webviewPage
      .locator(".settings-plugin-header")
      .boundingBox())!;
    const headerTextBox = (await webviewPage
      .locator(".settings-page-header-text")
      .boundingBox())!;
    const addBox = (await webviewPage
      .locator(".settings-plugin-new-market")
      .boundingBox())!;
    const toolbarBox = (await webviewPage
      .locator(".settings-card-toolbar")
      .boundingBox())!;
    expect(addBox.x).toBeGreaterThanOrEqual(headerBox.x);
    expect(addBox.x + addBox.width).toBeLessThanOrEqual(
      headerBox.x + headerBox.width,
    );
    expect(addBox.y).toBeGreaterThanOrEqual(headerBox.y);
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(
      headerBox.y + headerBox.height,
    );
    expect(addBox.x).toBeGreaterThanOrEqual(
      headerTextBox.x + headerTextBox.width,
    );
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(toolbarBox.y);

    /* 市场栏层级（对齐原型）：「更新/移除市场」是**当前市场**的上下文操作，
       因此与市场 tab 同处工具栏一行、紧跟在 tab 条右侧（工具条不换行，
       宽度不足时由 tab 条自身横向滚动消化 —— 见 SettingsPage.css）。 */
    const tabsBox = (await webviewPage
      .locator(".settings-tabs")
      .boundingBox())!;
    const marketOpsBox = (await webviewPage
      .locator(".settings-plugin-market-ops")
      .boundingBox())!;
    expect(marketOpsBox.x).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);
    expect(marketOpsBox.y).toBeGreaterThanOrEqual(toolbarBox.y);
    expect(marketOpsBox.y + marketOpsBox.height).toBeLessThanOrEqual(
      toolbarBox.y + toolbarBox.height,
    );
    // 版本三态：未安装=最新版、有新版=两版并列、最新=单版
    await expect(webviewPage.getByText("最新 v2.3.1")).toBeVisible();
    await expect(
      webviewPage.getByText("已安装 v3.1.2 · 最新 v3.2.0"),
    ).toBeVisible();
    await expect(webviewPage.getByText("v2.1.0")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-market.webp",
    );

    // 安装：行内「安装」→ 作用域弹窗（默认 user）
    await webviewPage.getByTitle("安装插件").click();
    await expect(
      webviewPage.getByRole("dialog", { name: "选择安装作用域" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByText("为此仓库的所有协作者安装"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-scope.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await expect(
      webviewPage.getByRole("dialog", { name: "选择安装作用域" }),
    ).toHaveCount(0);

    // 新建市场：本地路径（选择文件夹）/ 远程仓库 owner/repo
    await webviewPage.getByRole("button", { name: "新建市场" }).click();
    await expect(
      webviewPage.getByRole("dialog", { name: "新建市场" }),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-new-market.webp",
    );
    await webviewPage.keyboard.press("Escape");

    // 搜索：限定在当前市场内按名称 / 描述过滤
    await webviewPage.getByLabel("搜索插件").fill("git");
    await expect(webviewPage.getByText("Git Workflow")).toBeVisible();
    await expect(webviewPage.getByText("Code Reviewer")).toHaveCount(0);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/plugin-search-filtered.webp",
    );
  });
});
