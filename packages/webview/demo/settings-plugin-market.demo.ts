import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import {
  openSettings,
  simulateHostMessage,
} from "../e2e/utils/settingsHarness.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * 设置页「插件市场」截图（spec ecosystem/plugin「插件市场」）。
 *
 * 插件市场从聊天区的弹窗迁入设置页（`/plugin` 与设置页导航项同一入口），因此
 * 截图走 settings.js 独立 bundle（settingsHarness），不再是 chat bundle 的
 * showDialog(plugin)。
 *
 * 市场命名与来源管理（场景 5 / 15–18）：市场 tab 直接显示市场自身名称，顺序即宿主
 * 下发顺序；tab 行右侧两个纯图标入口（加号 = 添加市场、齿轮 = 管理市场）。
 */

const MARKETPLACES = [
  { name: "wave-plugins-official", isBuiltin: true },
  { name: "wave-community" },
];

/** 锚点工程（spec A-018）：宿主下发 listPluginsResponse 时回带的「当前工程」——
 *  桌面端即当前选中对话所属工程。弹窗的 project / local 两档与气泡都相对它讲。 */
const ANCHOR_WORKDIR = "/Users/me/code-wave";

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
    anchorWorkdir: ANCHOR_WORKDIR,
    plugins: PLUGINS,
  });
  // 打开视图触发的后台清单刷新在宿主侧已完成（只拉检出、不升级插件）：
  // 截图不带瞬态的「检查更新中」，模型 = 宿主带 refreshed 标记的补发
  // （宿主每次 listPluginsResponse 都回带 anchorWorkdir，补发不例外）
  await simulateHostMessage(page, {
    command: "listPluginsResponse",
    plugins: PLUGINS,
    anchorWorkdir: ANCHOR_WORKDIR,
    refreshed: true,
  });
  await expect(page.locator(".settings-plugin-list")).toBeVisible();
}

test.describe("设置页插件市场截图", () => {
  test("市场列表 / 版本三态 / 作用域弹窗 / 管理市场 / 添加插件市场 / 搜索过滤", async ({
    webviewPage,
  }) => {
    await openPluginMarket(webviewPage);

    /* 市场命名（场景 5 / A-011）：tab 文案即市场自身名称，顺序即宿主下发顺序；
       视图不再做「插件市场 / 自定义市场N」这层显示名映射。 */
    await expect(
      webviewPage.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      webviewPage.getByRole("tab", { name: /wave-community/ }),
    ).toBeVisible();
    await expect(webviewPage.locator(".settings-tab")).toHaveCount(2);

    /* 市场来源入口（场景 16/18）：与市场 tab 同处工具栏一行、紧跟在 tab 条右侧
       （工具条不换行，宽度不足时由 tab 条自身横向滚动消化 —— 见 SettingsPage.css）；
       只有加号 → 齿轮两个图标入口（「更新」不在这行），图标按钮内无可见文字，
       文案由 aria-label 与悬浮提示承载，页头不设「添加插件市场」。 */
    const tabsBox = (await webviewPage
      .locator(".settings-tabs")
      .boundingBox())!;
    const toolbarBox = (await webviewPage
      .locator(".settings-card-toolbar")
      .boundingBox())!;
    const marketOpsBox = (await webviewPage
      .locator(".settings-plugin-market-ops")
      .boundingBox())!;
    expect(marketOpsBox.x).toBeGreaterThanOrEqual(tabsBox.x + tabsBox.width);
    expect(marketOpsBox.y).toBeGreaterThanOrEqual(toolbarBox.y);
    expect(marketOpsBox.y + marketOpsBox.height).toBeLessThanOrEqual(
      toolbarBox.y + toolbarBox.height,
    );
    await expect(webviewPage.getByTestId("plugins-add-market")).toHaveAttribute(
      "aria-label",
      "添加插件市场",
    );
    await expect(
      webviewPage.getByTestId("plugins-manage-markets"),
    ).toHaveAttribute("aria-label", "管理插件市场");
    await expect(
      webviewPage.locator(
        ".settings-plugin-market-ops .settings-plugin-icon-btn",
      ),
    ).toHaveCount(2);
    // 悬浮提示（场景 16）：气泡在按钮下方，不用原生 title；鼠标移开后消失
    await expect(
      webviewPage.locator(".settings-plugin-market-ops [title]"),
    ).toHaveCount(0);
    await webviewPage.getByTestId("plugins-add-market").hover();
    const addTip = webviewPage.locator(".tooltip-box.visible");
    await expect(addTip).toHaveText("添加插件市场");
    await webviewPage.getByTestId("plugins-manage-markets").hover();
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveText(
      "管理插件市场",
    );
    const manageButtonBox = (await webviewPage
      .getByTestId("plugins-manage-markets")
      .boundingBox())!;
    const manageTipBox = (await webviewPage
      .locator(".tooltip-box.visible")
      .boundingBox())!;
    // 气泡在按钮下方（只贴住按钮下沿外侧，不覆盖按钮本身）
    expect(manageTipBox.y).toBeGreaterThanOrEqual(
      manageButtonBox.y + manageButtonBox.height,
    );
    await webviewPage.mouse.move(0, 0);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);
    const addBox = (await webviewPage
      .getByTestId("plugins-add-market")
      .boundingBox())!;
    const manageBox = (await webviewPage
      .getByTestId("plugins-manage-markets")
      .boundingBox())!;
    expect(manageBox.x).toBeGreaterThanOrEqual(addBox.x + addBox.width);
    await expect(webviewPage.locator(".settings-plugin-header")).toHaveCount(0);
    await expect(
      webviewPage.locator(".settings-plugin-new-market"),
    ).toHaveCount(0);

    /* 当前市场「更新」（场景 15）：在筛选行里、筛选分段器右侧、搜索框之前，带该市场
       的可更新数量；筛选行 = 分段器 → 「更新 N」→（弹性空白）→ 贴右端的搜索框。 */
    await expect(webviewPage.getByTestId("plugins-update-market")).toHaveText(
      /更新\s*1/,
    );
    const filtersBox = (await webviewPage
      .locator(".settings-plugin-filters")
      .boundingBox())!;
    const updateBox = (await webviewPage
      .getByTestId("plugins-update-market")
      .boundingBox())!;
    const searchBox = (await webviewPage
      .locator(".settings-plugin-search")
      .boundingBox())!;
    expect(updateBox.x).toBeGreaterThanOrEqual(filtersBox.x + filtersBox.width);
    expect(searchBox.x).toBeGreaterThanOrEqual(updateBox.x + updateBox.width);

    // 版本三态：未安装=单个可安装版本、有新版=一个升级胶囊「v旧 → v新」+「可更新」、
    // 最新=单个版本。两个版本号同在一个胶囊里（左灰=已安装、右橙=最新、中间箭头）
    await expect(
      webviewPage.getByText("v2.3.1", { exact: true }),
    ).toBeVisible();
    await expect(
      webviewPage.getByText("v2.1.0", { exact: true }),
    ).toBeVisible();
    const upgrade = webviewPage
      .locator(".settings-plugin-row", { hasText: "Code Reviewer" })
      .locator(".settings-plugin-upgrade");
    await expect(upgrade).toHaveCount(1);
    await expect(upgrade.locator(".settings-plugin-upgrade-from")).toHaveText(
      "v3.1.2",
    );
    await expect(upgrade.locator(".settings-plugin-upgrade-to")).toHaveText(
      "v3.2.0",
    );
    await expect(
      upgrade.locator(".settings-plugin-upgrade-arrow"),
    ).toBeVisible();
    await expect(
      webviewPage
        .locator(".settings-plugin-row", { hasText: "Code Reviewer" })
        .locator(".settings-plugin-version"),
    ).toHaveCount(0);
    await expect(
      webviewPage.getByText("可更新", { exact: true }),
    ).toBeVisible();
    // 已安装且已是最新那一行（Chrome DevTools）没有状态按钮，只有作用域下拉
    await expect(
      webviewPage
        .locator(".settings-plugin-row", { hasText: "Chrome DevTools" })
        .locator(".settings-plugin-act"),
    ).toHaveCount(0);

    /* 行内提示与作用域下拉同款（场景 8/10 + A-020）：升级胶囊、可更新行的「更新」都在
       元素下方出气泡（编辑器气泡配色），而不是系统原生 title（原生提示是系统配色、
       与视图其余提示不同源）；「安装」按钮不给气泡——文字已把动作说清，气泡只会重复
       一遍（A-020）。整行都没有原生 title。 */
    const reviewerRow = webviewPage.locator(".settings-plugin-row", {
      hasText: "Code Reviewer",
    });
    await expect(
      webviewPage.locator(".settings-plugin-row [title]"),
    ).toHaveCount(0);
    await upgrade.hover();
    const upgradeTip = webviewPage.locator(".tooltip-box.visible");
    expect(await upgradeTip.textContent()).toBe(
      "已安装 v3.1.2，最新版本 v3.2.0",
    );
    const upgradeBox = (await upgrade.boundingBox())!;
    const upgradeTipBox = (await upgradeTip.boundingBox())!;
    expect(upgradeTipBox.y).toBeGreaterThanOrEqual(
      upgradeBox.y + upgradeBox.height,
    );
    await webviewPage.mouse.move(0, 0);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);

    await reviewerRow
      .getByRole("button", { name: "更新", exact: true })
      .hover();
    expect(
      await webviewPage.locator(".tooltip-box.visible").textContent(),
    ).toBe("更新到最新版本 v3.2.0");
    await webviewPage.mouse.move(0, 0);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);

    // 未安装行的「安装」：悬浮不出任何气泡
    const installBtn = webviewPage
      .locator(".settings-plugin-row", { hasText: "Git Workflow" })
      .getByRole("button", { name: "安装", exact: true });
    await installBtn.hover();
    await webviewPage.waitForTimeout(300);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);
    await webviewPage.mouse.move(0, 0);

    /* 作用域胶囊的悬浮提示（场景 22）：行内文案维持现状，气泡只说明该插件在当前锚点
       工程的归属——一行「工程名（工程根目录）」，不加「所属项目」这类行首标签、也不列出
       别的工程里的启用记录；只以用户作用域安装的插件不属于任何工程 → 说明「所有项目
       可用」。文案虽只有一行，长工程路径仍必须按宽度折行（默认 nowrap + ellipsis 会
       截成 `.../code-wave`），故气泡仍带 tooltip-multiline；原生 title 已去掉（与图标
       按钮同一套做法，避免系统提示与自定义气泡并弹）。 */
    const devtoolsRow = webviewPage.locator(".settings-plugin-row", {
      hasText: "Chrome DevTools",
    });
    await expect(devtoolsRow.locator(".settings-scope-pill")).toHaveText(
      /项目/,
    );
    await expect(devtoolsRow.locator(".settings-scope-pill")).toHaveAttribute(
      "aria-label",
      "更换安装作用域",
    );
    await expect(
      devtoolsRow.locator(".settings-scope-pill[title]"),
    ).toHaveCount(0);
    await devtoolsRow.locator(".settings-scope-pill").hover();
    const scopeTip = webviewPage.locator(".tooltip-box.visible");
    await expect(scopeTip).toHaveClass(/tooltip-multiline/);
    expect(await scopeTip.textContent()).toBe(
      "code-wave（/Users/me/code-wave）",
    );
    await webviewPage.mouse.move(0, 0);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);

    // 只以用户作用域安装：气泡说明「所有项目可用」
    await webviewPage
      .locator(".settings-plugin-row", { hasText: "Code Reviewer" })
      .locator(".settings-scope-pill")
      .hover();
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveText(
      "用户级安装（所有项目可用）",
    );
    await webviewPage.mouse.move(0, 0);
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(0);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-market.webp",
    );

    /* 当前市场「更新」的确认弹窗（场景 21）：点「更新」先弹确认、不直接下发；正文
       注明作用范围「<市场名> 市场下」，清单只列**该市场**里可更新插件的名称、版本
       变化（v旧 → v新）与安装作用域。先看官方市场那份，再切到社区市场看那份（社区
       那条临时补成可更新且缺作用域 → 覆盖「未知」），截图取后者。 */
    await simulateHostMessage(webviewPage, {
      command: "listPluginsResponse",
      anchorWorkdir: ANCHOR_WORKDIR,
      plugins: PLUGINS.map((p) =>
        p.id === "database-explorer@wave-community"
          ? { ...p, installed: true, version: "0.9.0", latestVersion: "0.9.5" }
          : p,
      ),
    });
    await webviewPage.getByTestId("plugins-update-market").click();
    let updateDialog = webviewPage.getByRole("alertdialog");
    await expect(updateDialog).toBeVisible();
    await expect(updateDialog).toContainText(
      "wave-plugins-official 市场下有 1 个插件可更新",
    );
    await expect(
      updateDialog.getByTestId(
        "plugin-update-item-code-reviewer@wave-plugins-official",
      ),
    ).toContainText("v3.1.2 → v3.2.0");
    // 清单不含其它市场：社区那条不在当前市场的弹窗里
    await expect(
      updateDialog.getByTestId(
        "plugin-update-item-database-explorer@wave-community",
      ),
    ).toHaveCount(0);
    await webviewPage.getByTestId("confirm-dialog-cancel").click();
    await expect(webviewPage.getByRole("alertdialog")).toHaveCount(0);

    await webviewPage.getByRole("tab", { name: /wave-community/ }).click();
    await webviewPage.getByTestId("plugins-update-market").click();
    updateDialog = webviewPage.getByRole("alertdialog");
    await expect(updateDialog).toBeVisible();
    await expect(updateDialog).toContainText(
      "wave-community 市场下有 1 个插件可更新",
    );
    await expect(
      updateDialog.getByTestId(
        "plugin-update-item-database-explorer@wave-community",
      ),
    ).toContainText("未知");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-update-confirm.webp",
    );
    // 取消：关弹窗、不下发更新；宿主数据复原到基线并切回官方市场（后续断言按原数据走）
    await webviewPage.getByTestId("confirm-dialog-cancel").click();
    await expect(webviewPage.getByRole("alertdialog")).toHaveCount(0);
    await simulateHostMessage(webviewPage, {
      command: "listPluginsResponse",
      anchorWorkdir: ANCHOR_WORKDIR,
      plugins: PLUGINS,
    });
    await webviewPage
      .getByRole("tab", { name: /wave-plugins-official/ })
      .click();
    await expect(webviewPage.getByTestId("plugins-update-market")).toHaveText(
      /更新\s*1/,
    );

    /* 切换市场时分段器复位为「全部」（场景 6）：先在官方市场选「已安装」，再切到社区
       市场，分段器应回到「全部」——不继承上一个市场选的分组。 */
    const activeChip = webviewPage.locator(
      '.settings-plugin-chip[aria-pressed="true"]',
    );
    await expect(activeChip).toHaveText(/全部/);
    await webviewPage
      .locator(".settings-plugin-chip", { hasText: "已安装" })
      .click();
    await expect(activeChip).toHaveText(/已安装/);
    await webviewPage.getByRole("tab", { name: /wave-community/ }).click();
    await expect(activeChip).toHaveText(/全部/);
    await webviewPage
      .getByRole("tab", { name: /wave-plugins-official/ })
      .click();

    // 安装：行内「安装」→ 作用域弹窗（默认 user）；exact 避开筛选行的「已安装/未安装」
    await webviewPage
      .getByRole("button", { name: "安装", exact: true })
      .click();
    await expect(
      webviewPage.getByRole("dialog", { name: "选择安装作用域" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByText("写入当前项目配置，项目的其他协作者共享使用"),
    ).toBeVisible();
    /* project / local 两档都标明写进哪个工程（场景 12/13）：**一行**「当前项目：工程名
       （工程根目录）」——只写「项目配置」「本地仓库」用户无法确认是哪个仓库，重名时靠路
       径区分（名字加粗先被读到，路径紧跟其后）；user 档不带工程名（它不属于任何工程）。 */
    for (const scope of ["project", "local"]) {
      await expect(
        webviewPage.getByTestId(`scope-project-${scope}`),
      ).toHaveText(`当前项目：code-wave（${ANCHOR_WORKDIR}）`);
    }
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-scope.webp",
    );
    await webviewPage.keyboard.press("Escape");
    await expect(
      webviewPage.getByRole("dialog", { name: "选择安装作用域" }),
    ).toHaveCount(0);

    /* 管理插件市场（场景 16）：列出全部市场（行文案即市场自身名称）—— 官方市场
       行标「官方」且不可移除，自定义市场可移除；底部是「添加插件市场」。 */
    await webviewPage.getByTestId("plugins-manage-markets").click();
    await expect(
      webviewPage.getByRole("dialog", { name: "管理插件市场" }),
    ).toBeVisible();
    const officialRow = webviewPage.getByTestId(
      "plugins-manage-row-wave-plugins-official",
    );
    await expect(officialRow).toContainText("wave-plugins-official");
    await expect(officialRow).toContainText("官方");
    await expect(officialRow.getByRole("button")).toHaveCount(0);
    await expect(
      webviewPage.getByTestId("plugins-manage-row-wave-community"),
    ).toContainText("wave-community");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-manage-markets.webp",
    );

    /* 市场多到超出弹窗高度（场景 16）：滚动只发生在市场列表这一块，标题行与底部
       「添加插件市场」位置固定。临时把市场堆到 18 个把列表撑到溢出，验证弹窗
       本体不滚（scrollHeight ≤ clientHeight）而列表自身可滚，滚动前后标题与底部
       入口的位置逐像素不变。 */
    await simulateHostMessage(webviewPage, {
      command: "listMarketplacesResponse",
      marketplaces: [
        ...MARKETPLACES,
        { name: "team-toolkit" },
        { name: "data-tools" },
        { name: "design-system" },
        { name: "infra-ops" },
        { name: "mobile-platform" },
        ...Array.from({ length: 11 }, (_, i) => ({
          name: `team-market-${i + 1}`,
        })),
      ],
    });
    const manageDialog = webviewPage.getByRole("dialog", {
      name: "管理插件市场",
    });
    const manageList = manageDialog.locator(".settings-market-manage-list");
    await expect(manageList).toHaveCount(1);
    const listScroll = await manageList.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(listScroll.scrollHeight).toBeGreaterThan(listScroll.clientHeight);
    // 弹窗本体不参与滚动
    const modalScroll = await manageDialog.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(modalScroll.scrollHeight).toBeLessThanOrEqual(
      modalScroll.clientHeight,
    );

    // 标题行与底部入口的几何在列表滚到底前后完全一致
    const chromeBoxes = async () => ({
      header: await manageDialog
        .locator(".settings-modal-header")
        .boundingBox(),
      add: await webviewPage.getByTestId("plugins-manage-add").boundingBox(),
    });
    const chromeAtTop = await chromeBoxes();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-manage-markets-scroll.webp",
    );
    await manageList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await chromeBoxes()).toEqual(chromeAtTop);
    // 滚动确实发生在列表里：滚到底后末行可见、首行已滚出弹窗可视区
    await expect(
      webviewPage.getByTestId("plugins-manage-row-team-market-11"),
    ).toBeInViewport();
    await expect(
      webviewPage.getByTestId("plugins-manage-row-wave-plugins-official"),
    ).not.toBeInViewport();

    // 复原到 2 个市场，后续「添加新市场」链路仍按基线数据走
    await simulateHostMessage(webviewPage, {
      command: "listMarketplacesResponse",
      marketplaces: MARKETPLACES,
    });
    await expect(
      webviewPage.getByTestId("plugins-manage-row-team-market-11"),
    ).toHaveCount(0);

    // 弹窗内入口与 tab 行的加号入口等价（场景 18）：先验证弹窗内那条路径，
    // 再关掉用加号图标走一遍：填远程仓库地址 → 添加 → 宿主刷新列表 → 自动切到新市场。
    // 两个入口打开的弹窗标题都叫「添加插件市场」（标题与入口同名）
    await webviewPage.getByTestId("plugins-manage-add").click();
    await expect(
      webviewPage.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeVisible();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByRole("dialog")).toHaveCount(0);
    await webviewPage.getByTestId("plugins-add-market").click();
    await expect(
      webviewPage.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-new-market.webp",
    );
    await webviewPage.getByRole("tab", { name: "远程仓库" }).click();
    await webviewPage.getByLabel("市场地址").fill("netease/team-plugins");
    // exact：tab 行的加号图标按钮 aria-label「添加插件市场」也含「添加」
    await webviewPage
      .getByRole("button", { name: "添加", exact: true })
      .click();
    await expect(webviewPage.getByRole("dialog")).toHaveCount(0);

    // 宿主添加成功后刷新两份列表：多出来的 team-plugins 成为当前市场
    await simulateHostMessage(webviewPage, {
      command: "listMarketplacesResponse",
      marketplaces: [...MARKETPLACES, { name: "team-plugins" }],
    });
    await simulateHostMessage(webviewPage, {
      command: "listPluginsResponse",
      anchorWorkdir: ANCHOR_WORKDIR,
      plugins: [
        ...PLUGINS,
        {
          id: "team-lint@team-plugins",
          name: "Team Lint",
          description: "团队自定义规范检查",
          marketplace: "team-plugins",
          installed: false,
          latestVersion: "1.0.0",
        },
      ],
    });
    await expect(
      webviewPage.getByRole("tab", { name: /team-plugins/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(webviewPage.getByText("Team Lint")).toBeVisible();

    // 统计只跟当前市场走：新市场里没有可更新插件 → 按钮不出现（数量不跨市场累计）
    await expect(webviewPage.getByTestId("plugins-update-market")).toHaveCount(
      0,
    );

    // 切回官方市场：搜索框贴右端不变
    await webviewPage
      .getByRole("tab", { name: /wave-plugins-official/ })
      .click();
    await expect(
      webviewPage.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "true");

    // 唯一可更新的插件也变成最新版 → 「更新」按钮整体消失（无更新则不显示）
    await simulateHostMessage(webviewPage, {
      command: "listPluginsResponse",
      anchorWorkdir: ANCHOR_WORKDIR,
      plugins: PLUGINS.map((p) =>
        p.latestVersion === "3.2.0" ? { ...p, latestVersion: "3.1.2" } : p,
      ),
    });
    await expect(webviewPage.getByTestId("plugins-update-market")).toHaveCount(
      0,
    );
    // 复原，后续搜索断言仍按原数据走
    await simulateHostMessage(webviewPage, {
      command: "listPluginsResponse",
      anchorWorkdir: ANCHOR_WORKDIR,
      plugins: PLUGINS,
    });
    await expect(webviewPage.getByTestId("plugins-update-market")).toHaveText(
      /更新\s*1/,
    );

    // 搜索：限定在当前市场内按名称 / 描述过滤
    await webviewPage.getByLabel("搜索插件").fill("git");
    await expect(webviewPage.getByText("Git Workflow")).toBeVisible();
    await expect(webviewPage.getByText("Code Reviewer")).toHaveCount(0);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/plugin-search-filtered.webp",
    );

    /* 市场切换条放不下时两端的渐隐提示（场景 5）：条上隐藏了滚动条（设计师 0915
       要求），没有提示用户就无从知道一侧还有市场。这里补足到 6 个市场把条撑到溢出，
       验证：起点只有右端渐隐 → 滚到最右后右端消失、左端出现；渐隐层不占布局宽度，
       切换项与右侧两个图标入口的位置与隐藏渐隐层时逐像素相同。 */
    await simulateHostMessage(webviewPage, {
      command: "listMarketplacesResponse",
      marketplaces: [
        ...MARKETPLACES,
        { name: "team-toolkit" },
        { name: "data-tools" },
        { name: "design-system" },
        { name: "infra-ops" },
        { name: "mobile-platform" },
      ],
    });
    const strip = webviewPage.locator(".settings-tabs");
    const overflow = await strip.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

    const fadeStart = webviewPage.getByTestId("plugins-tabs-fade-start");
    const fadeEnd = webviewPage.getByTestId("plugins-tabs-fade-end");
    await expect(fadeEnd).toHaveCount(1);
    await expect(fadeStart).toHaveCount(0);

    // 渐隐层不占布局宽度：隐藏前后，切换项与右侧入口的位置完全一致
    const boxOf = async () => ({
      ops: await webviewPage
        .locator(".settings-plugin-market-ops")
        .boundingBox(),
      tabs: await strip.boundingBox(),
    });
    const withFade = await boxOf();
    await webviewPage.evaluate(() => {
      document.querySelectorAll(".settings-plugin-tabs-fade").forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    });
    const withoutFade = await boxOf();
    expect(withFade).toEqual(withoutFade);
    await webviewPage.evaluate(() => {
      document.querySelectorAll(".settings-plugin-tabs-fade").forEach((el) => {
        (el as HTMLElement).style.display = "";
      });
    });

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-market-tabs-fade.webp",
    );

    // 滚到最右端：右端渐隐消失、左端出现
    await strip.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(fadeStart).toHaveCount(1);
    await expect(fadeEnd).toHaveCount(0);

    /* 添加市场后自动选中的新切换项若落在可视区外，切换条自动滚过去（场景 18）：
       此刻条已滚到最右，新市场会追加在最右端之外 —— 不滚的话用户看到的是
       「选中项不见了」。加完验证：新 tab 处于选中态、且四边都在切换条可视区内
       （而不是被裁在条外）；右侧入口的位置不因此移动。 */
    const opsBefore = await webviewPage
      .locator(".settings-plugin-market-ops")
      .boundingBox();
    await webviewPage.getByTestId("plugins-add-market").click();
    await webviewPage.getByRole("tab", { name: "远程仓库" }).click();
    await webviewPage.getByLabel("市场地址").fill("netease/platform-team");
    await webviewPage
      .getByRole("button", { name: "添加", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "listMarketplacesResponse",
      marketplaces: [
        ...MARKETPLACES,
        { name: "team-toolkit" },
        { name: "data-tools" },
        { name: "design-system" },
        { name: "infra-ops" },
        { name: "mobile-platform" },
        { name: "platform-team" },
      ],
    });
    const activeTab = webviewPage.locator(
      '.settings-tab[aria-selected="true"]',
    );
    await expect(activeTab).toContainText("platform-team");
    const stripBox = (await strip.boundingBox())!;
    const activeBox = (await activeTab.boundingBox())!;
    // 1px 容差：滚动位置由浏览器按整数像素吸附，而 tab 宽度是分数（这里差 0.45px），
    // 「滚到刚好露出」之后仍可能剩下不足 1px 在条外
    expect(activeBox.x).toBeGreaterThanOrEqual(stripBox.x - 1);
    expect(activeBox.x + activeBox.width).toBeLessThanOrEqual(
      stripBox.x + stripBox.width + 1,
    );
    expect(
      await webviewPage.locator(".settings-plugin-market-ops").boundingBox(),
    ).toEqual(opsBefore);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-plugin-market-tab-autoscroll.webp",
    );
  });
});
