/**
 * 插件市场视图（spec ecosystem/plugin「插件市场」）：
 * 市场 Tab（显示市场自身名称）+ 计数、筛选计数、搜索、版本文案三态与行操作、
 * 安装/更换作用域弹窗、筛选行里筛选分段器右侧的「更新」（带当前市场的可更新数量）、
 * tab 行两个图标入口、「管理插件市场」弹窗（列出/添加/移除）、「添加插件市场」
 * 弹窗（本地路径 / 远程仓库，标题与入口同名）、空态与自动切市场，
 * 以及打开视图触发的后台清单刷新（只拉检出、不升级插件）。
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  createMockVscode,
  within,
} from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

function renderPluginView(vscode?: { postMessage: (msg: unknown) => void }): {
  vscode: { postMessage: ReturnType<typeof vi.fn> };
} {
  const mockVscode = vscode ?? createMockVscode();
  render(
    <SettingsPage
      configurationData={null}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav="plugins"
      vscode={mockVscode}
      workdir="/work/a"
    />,
  );
  return { vscode: mockVscode as { postMessage: ReturnType<typeof vi.fn> } };
}

/** host 回发：市场列表 + 插件列表（官方内置市场 + 一个自定义市场，覆盖三态版本
 *  与作用域；官方市场带 `isBuiltin`，tab/弹窗行都直接显示这两个市场名） */
const MARKETPLACES = [
  { name: "wave-plugins-official", isBuiltin: true },
  { name: "wave-community" },
];

/** 锚点工程（spec A-018）：宿主在 listPluginsResponse 里回带的「当前工程」，弹窗的
 *  project / local 两档与作用域气泡都相对它讲（与 renderPluginView 的 workdir 同源）。 */
const ANCHOR_WORKDIR = "/work/a";

const PLUGINS = [
  {
    id: "git-workflow@wave-plugins-official",
    name: "Git Workflow",
    description: "集成 Git 工作流",
    marketplace: "wave-plugins-official",
    installed: false,
    latestVersion: "2.3.1",
  },
  {
    id: "code-reviewer@wave-plugins-official",
    name: "Code Reviewer",
    description: "AI 驱动的代码审查工具",
    marketplace: "wave-plugins-official",
    installed: true,
    version: "3.1.2",
    latestVersion: "3.2.0",
    scope: "user",
  },
  {
    id: "document-skills@wave-plugins-official",
    name: "Document Skills",
    description: "文档处理套件",
    marketplace: "wave-plugins-official",
    installed: true,
    version: "2.1.0",
    latestVersion: "2.1.0",
    scope: "project",
  },
  {
    id: "database-explorer@wave-community",
    name: "Database Explorer",
    description: "连接多种数据库",
    marketplace: "wave-community",
    installed: false,
    latestVersion: "0.9.5",
  },
];

/** 筛选胶囊（全部 / 已安装 / 未安装）按容器内顺序取：它们的 accessible name
 *  里带计数角标，故用 DOM 锚定。 */
function filterChip(label: string): HTMLElement {
  const chips = document.querySelectorAll<HTMLElement>(".settings-plugin-chip");
  const found = [...chips].find((c) => c.textContent?.startsWith(label));
  if (!found) throw new Error(`筛选胶囊不存在：${label}`);
  return found;
}

/** 挂载视图并回发两份列表（含刷新完成后的补发：宿主在打开视图触发的后台清单
 *  刷新结束后带 refreshed 标记再推一次，spec 插件市场场景 2/12） */
async function mountWithData() {
  const utils = renderPluginView();
  // 挂载即拉取两份列表 + 触发一次后台清单刷新（只拉检出、不升级插件）
  expect(utils.vscode.postMessage).toHaveBeenCalledWith({
    command: "listMarketplaces",
  });
  expect(utils.vscode.postMessage).toHaveBeenCalledWith({
    command: "listPlugins",
  });
  expect(utils.vscode.postMessage).toHaveBeenCalledWith({
    command: "refreshMarketplaces",
  });
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "listMarketplacesResponse",
          marketplaces: MARKETPLACES,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "listPluginsResponse",
          plugins: PLUGINS,
          // 锚点工程（spec A-018）：宿主回带「当前工程」，与 workdir prop 同源
          anchorWorkdir: ANCHOR_WORKDIR,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "listPluginsResponse",
          plugins: PLUGINS,
          // 补发走同一个 RPC（宿主每次都带 anchorWorkdir），锚点不因刷新而丢
          anchorWorkdir: ANCHOR_WORKDIR,
          refreshed: true,
        },
      }),
    );
  });
  return utils;
}

/** 「添加插件市场」的两个入口等价（spec 场景 18）：tab 行右侧的加号图标按钮直接
 *  打开「添加插件市场」弹窗（标题与入口同名）；「管理插件市场」弹窗内的同名入口
 *  先关管理再开它。 */
async function openNewMarketDialog(via: "add-icon" | "manage" = "add-icon") {
  if (via === "manage") {
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-manage-markets"));
    });
  }
  await act(async () => {
    fireEvent.click(
      via === "add-icon"
        ? screen.getByTestId("plugins-add-market")
        : screen.getByTestId("plugins-manage-add"),
    );
  });
}

/** 走「添加插件市场 → 远程仓库 → 填地址 → 添加」一条龙（响应由调用方按用例模拟） */
async function submitRemoteMarket(input: string): Promise<void> {
  await openNewMarketDialog();
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "远程仓库" }));
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("市场地址"), {
      target: { value: input },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
  });
}

/** jsdom 不做布局：只造视图读的那两个边界值（left / right）。 */
const edgeRect = (left: number, right: number) => ({ left, right }) as DOMRect;

/** 给「切换条滚进可视区」这条逻辑喂假几何（spec 场景 18）：切换条 = 视口 0–400，
 *  切换项按 `rects`（市场名前缀 → 视口坐标）取值、没列到的一律当 0–100（完整可见）；
 *  `scrollLeft` 在 jsdom 里是只读的 0，这里替它接上可读写、可读回的存取器。 */
function stubTabStripLayout(
  rects: Record<string, { left: number; right: number }>,
) {
  const strip = document.querySelector<HTMLElement>(".settings-tabs")!;
  let scrollLeft = 0;
  Object.defineProperty(strip, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });
  const spy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this.classList.contains("settings-tabs")) return edgeRect(0, 400);
      if (this.classList.contains("settings-tab")) {
        const key = Object.keys(rects).find((name) =>
          this.textContent?.startsWith(name),
        );
        return key
          ? edgeRect(rects[key].left, rects[key].right)
          : edgeRect(0, 100);
      }
      return edgeRect(0, 0);
    });
  return {
    strip,
    scrollLeft: () => scrollLeft,
    restore: () => spy.mockRestore(),
  };
}

describe("SettingsPage 插件市场视图", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("市场 Tab 显示市场自身名称并带各市场插件数，默认选中第一个市场", async () => {
    await mountWithData();

    // tab 文案即宿主下发的市场名（spec 场景 5 / A-011）
    const officialTab = screen.getByRole("tab", {
      name: /wave-plugins-official/,
    });
    expect(officialTab.textContent).toContain("3");
    expect(
      screen.getByRole("tab", { name: /wave-community/ }),
    ).toBeInTheDocument();
    // 顺序即宿主下发顺序（官方市场在本档排在第一位）
    expect(document.querySelectorAll(".settings-tab")[0].textContent).toContain(
      "wave-plugins-official",
    );

    // 默认选中第一个市场：只展示该市场的插件
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Database Explorer")).not.toBeInTheDocument();

    // 筛选计数（全部 3 / 已安装 2 / 未安装 1）；锚定「筛选胶囊」而非按钮名字
    const all = filterChip("全部");
    expect(all.textContent).toContain("3");
    expect(filterChip("已安装").textContent).toContain("2");
    expect(filterChip("未安装").textContent).toContain("1");
  });

  it("切换市场 Tab 后列表与计数随市场变化", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    expect(screen.getByText("Database Explorer")).toBeInTheDocument();
    expect(screen.queryByText("Git Workflow")).not.toBeInTheDocument();
    expect(filterChip("全部").textContent).toContain("1");
  });

  it("切换市场 Tab 时分段器复位为「全部」，已输入的搜索词保留", async () => {
    await mountWithData();

    // 先在官方市场选「已安装」并留下一个搜索词
    await act(async () => {
      fireEvent.click(filterChip("已安装"));
    });
    const search = screen.getByLabelText("搜索插件");
    await act(async () => {
      fireEvent.change(search, { target: { value: "code" } });
    });
    expect(filterChip("已安装")).toHaveAttribute("aria-pressed", "true");

    // 切到社区市场：分段器回到「全部」（不继承上一个市场的分组），
    // 列表因此按新市场的「全部」判定，未安装的 Database Explorer 重新可见
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    expect(filterChip("全部")).toHaveAttribute("aria-pressed", "true");
    expect(filterChip("已安装")).toHaveAttribute("aria-pressed", "false");
    // 搜索词仍在生效（社区市场里没有命中 "code" 的插件 → 空态）
    expect(search).toHaveValue("code");
    expect(screen.getByText("当前分类下暂无插件")).toBeInTheDocument();

    // 清掉搜索词 → 看到社区市场的全部插件（证明「全部」是真的生效，而非被搜索词掩盖）
    await act(async () => {
      fireEvent.change(search, { target: { value: "" } });
    });
    expect(screen.getByText("Database Explorer")).toBeInTheDocument();
  });

  it("市场切换条两端渐隐：还有未展示市场的那一端才出现，滚到该端即消失", async () => {
    await mountWithData();

    const strip = document.querySelector<HTMLElement>(".settings-tabs")!;
    // jsdom 不做布局（scrollWidth / clientWidth 恒为 0），这里替切换条给出溢出几何
    // 再触发 scroll，与真实浏览器中滚动事件驱动的重算路径一致
    const scrollTo = async (scrollLeft: number) => {
      Object.defineProperty(strip, "clientWidth", {
        value: 400,
        configurable: true,
      });
      Object.defineProperty(strip, "scrollWidth", {
        value: 900,
        configurable: true,
      });
      Object.defineProperty(strip, "scrollLeft", {
        value: scrollLeft,
        configurable: true,
      });
      await act(async () => {
        strip.dispatchEvent(new Event("scroll"));
      });
    };

    // 起点：右边还有市场 → 只有右端渐隐
    await scrollTo(0);
    expect(screen.getByTestId("plugins-tabs-fade-end")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugins-tabs-fade-start"),
    ).not.toBeInTheDocument();

    // 中途：两端都还有市场 → 两端渐隐同时在
    await scrollTo(200);
    expect(screen.getByTestId("plugins-tabs-fade-start")).toBeInTheDocument();
    expect(screen.getByTestId("plugins-tabs-fade-end")).toBeInTheDocument();

    // 滚到最右：右端渐隐消失，左端保留
    await scrollTo(500);
    expect(screen.getByTestId("plugins-tabs-fade-start")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugins-tabs-fade-end"),
    ).not.toBeInTheDocument();
  });

  it("市场都放得下（切换条无溢出）时两端都不出现渐隐", async () => {
    await mountWithData();

    // 未触发过滚动 → 挂载时的重算已按 jsdom 的 0 溢出得出「两端都没有」
    expect(
      screen.queryByTestId("plugins-tabs-fade-start"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("plugins-tabs-fade-end"),
    ).not.toBeInTheDocument();
  });

  it("筛选（已安装 / 未安装）只展示命中项", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(filterChip("已安装"));
    });
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Git Workflow")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(filterChip("未安装"));
    });
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Code Reviewer")).not.toBeInTheDocument();
  });

  it("搜索按名称或描述过滤当前市场内的插件", async () => {
    await mountWithData();

    const search = screen.getByLabelText("搜索插件");
    await act(async () => {
      fireEvent.change(search, { target: { value: "审查" } });
    });
    // 命中描述
    expect(screen.getByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Git Workflow")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(search, { target: { value: "git" } });
    });
    // 命中名称（大小写不敏感）
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Code Reviewer")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(search, { target: { value: "no-such-plugin" } });
    });
    expect(screen.getByText("当前分类下暂无插件")).toBeInTheDocument();
  });

  it("版本三态：未安装=单个可安装版本 / 有新版=升级胶囊＋「可更新」/ 最新=单个版本", async () => {
    await mountWithData();

    // 未安装（Git Workflow v2.3.1）：单个版本胶囊，不带「最新」字样
    expect(screen.getByText("v2.3.1")).toBeInTheDocument();
    // 已安装且最新（Document Skills v2.1.0）：单个版本胶囊
    expect(screen.getByText("v2.1.0")).toBeInTheDocument();

    // 可更新（Code Reviewer）：**一个**升级胶囊「v3.1.2 → v3.2.0」+「可更新」徽标。
    // 两个版本号同在一个胶囊里，靠箭头方向与左右颜色（左灰=已安装、右橙=最新）区分
    const upgrade = document.querySelector(".settings-plugin-upgrade");
    expect(upgrade).not.toBeNull();
    expect(upgrade?.textContent).toBe("v3.1.2v3.2.0");
    expect(
      upgrade?.querySelector(".settings-plugin-upgrade-from")?.textContent,
    ).toBe("v3.1.2");
    expect(
      upgrade?.querySelector(".settings-plugin-upgrade-to")?.textContent,
    ).toBe("v3.2.0");
    // 箭头把两段连起来；提示与作用域下拉同款（spec 场景 10 + A-020）：悬浮/聚焦时
    // 在胶囊下方出气泡说清哪段是已安装，不再用原生 title
    expect(
      upgrade?.querySelector(".settings-plugin-upgrade-arrow"),
    ).not.toBeNull();
    expect(upgrade).not.toHaveAttribute("title");
    const upgradeTip = upgrade
      ?.closest(".tooltip-container")
      ?.querySelector(".tooltip-box") as HTMLElement;
    expect(upgradeTip.classList).toContain("tooltip-bottom");
    expect(upgradeTip.textContent).toBe("已安装 v3.1.2，最新版本 v3.2.0");

    // 同一行里不再有第二个版本胶囊（旧版/最新版不再各自成形）
    const row = screen
      .getByText("Code Reviewer")
      .closest(".settings-plugin-row");
    expect(row?.querySelectorAll(".settings-plugin-version").length).toBe(0);
    expect(row?.querySelectorAll(".settings-plugin-upgrade").length).toBe(1);
    // 只有可更新那一行有「可更新」徽标
    expect(screen.getAllByText("可更新")).toHaveLength(1);
    expect(row?.querySelector(".settings-plugin-update-badge")).not.toBeNull();
    // 未安装/已安装最新那两行仍用单个灰胶囊
    expect(
      screen
        .getByText("Git Workflow")
        .closest(".settings-plugin-row")
        ?.querySelectorAll(".settings-plugin-version").length,
    ).toBe(1);
    expect(
      screen
        .getByText("Document Skills")
        .closest(".settings-plugin-row")
        ?.querySelectorAll(".settings-plugin-version").length,
    ).toBe(1);
  });

  it("行操作：未安装=安装、有新版=更新、已安装且最新无按钮；已安装展示作用域", async () => {
    const { vscode } = await mountWithData();

    const installBtn = screen.getByRole("button", { name: "安装" });
    expect(installBtn).toBeInTheDocument();
    // 插件行内的「更新」（市场级「更新」在筛选行、名字里带数量，不冲突）
    const rowUpdate = screen.getByRole("button", { name: "更新" });
    expect(rowUpdate).toHaveTextContent("更新");
    expect(rowUpdate.closest(".settings-plugin-row")).not.toBeNull();
    // 「更新」的提示走同款气泡（spec 场景 8 + A-020），不再用原生 title
    expect(rowUpdate).not.toHaveAttribute("title");
    const updateTip = rowUpdate
      .closest(".tooltip-container")
      ?.querySelector(".tooltip-box") as HTMLElement;
    expect(updateTip.textContent).toBe("更新到最新版本 v3.2.0");
    expect(updateTip.classList).toContain("tooltip-bottom");
    // 「安装」不给气泡：按钮文字已把动作说清，气泡只会重复一遍（A-020）
    expect(installBtn).not.toHaveAttribute("title");
    expect(installBtn.closest(".tooltip-container")).toBeNull();
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(installBtn);
    });
    await waitFor(() => {
      expect(document.querySelector(".tooltip-box.visible")).toBeNull();
    });

    await act(async () => {
      fireEvent.mouseEnter(
        rowUpdate.closest(".tooltip-container") as HTMLElement,
      );
    });
    await waitFor(() => {
      expect(updateTip.classList).toContain("visible");
    });
    await act(async () => {
      fireEvent.mouseLeave(
        rowUpdate.closest(".tooltip-container") as HTMLElement,
      );
    });
    await waitFor(() => {
      expect(updateTip.classList).not.toContain("visible");
    });
    // 已安装且已是最新（Document Skills）不再有状态按钮（spec 场景 8）：那一行只剩
    // 作用域下拉；另外两行（未安装=安装、有新版=更新）各有一个主操作按钮
    const latestRow = screen
      .getByText("Document Skills")
      .closest(".settings-plugin-row");
    expect(latestRow?.querySelectorAll(".settings-plugin-act").length).toBe(0);
    expect(document.querySelectorAll(".settings-plugin-act")).toHaveLength(2);
    // 已安装行的作用域 pill（当前作用域 + 更换入口）
    // 两个已安装行各有一个作用域 pill（当前作用域 + 更换入口）
    expect(
      screen.getAllByRole("button", { name: "更换安装作用域" })[0],
    ).toBeInTheDocument();
    expect(screen.getByText("用户")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();

    // 更新：安装作用域不变的单个插件更新——单插件更新不弹确认框（spec 场景 21 末句）
    await act(async () => {
      fireEvent.click(rowUpdate);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "updatePlugin",
      pluginId: "code-reviewer@wave-plugins-official",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("安装弹窗：三作用域 + 默认 user，确认后按所选作用域安装", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "安装" }));
    });
    const dialog = screen.getByRole("dialog", { name: "选择安装作用域" });
    expect(
      within(dialog).getByRole("button", { name: /用户（user）/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(dialog).getByRole("button", {
        name: /项目共享（project）/,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: /项目本地（local）/,
      }),
    ).toBeInTheDocument();
    // 标题与说明是定稿文案（spec 场景 12）：逐字断言，防简写漂移
    const descOf = (scope: string) =>
      within(dialog)
        .getByRole("button", { name: new RegExp(`（${scope}）`) })
        .querySelector(".settings-scope-option-desc")?.textContent;
    expect(descOf("user")).toBe("作为你的用户配置，所有项目可用");
    expect(descOf("project")).toBe(
      "写入当前项目配置，项目的其他协作者共享使用",
    );
    expect(descOf("local")).toBe(
      "仅在设备本地仓库配置，当前项目可用，不影响其他项目",
    );
    // 未安装：无「卸载」，确认按钮为「安装」
    expect(
      within(dialog).queryByRole("button", { name: "卸载" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: /项目本地（local）/,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "安装" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "installPlugin",
      pluginId: "git-workflow@wave-plugins-official",
      scope: "local",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("已安装弹窗：标题「更换安装作用域」+ 预选当前作用域 + 保存 / 卸载", async () => {
    const { vscode } = await mountWithData();

    // 两个已安装行各有一个作用域 pill，Code Reviewer 是第一个
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "更换安装作用域" })[0],
      );
    });
    const dialog = screen.getByRole("dialog", { name: "更换安装作用域" });
    // 预选当前作用域（Code Reviewer = user）
    expect(
      within(dialog).getByRole("button", { name: /用户（user）/ }),
    ).toHaveAttribute("aria-pressed", "true");

    // 保存 → 仅变更作用域
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setPluginScope",
      pluginId: "code-reviewer@wave-plugins-official",
      scope: "user",
    });

    // 卸载 → 只清除该弹窗所选作用域的启用记录与安装记录（spec plugin A-015）
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "更换安装作用域" })[0],
      );
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByRole("dialog", { name: "更换安装作用域" }),
        ).getByRole("button", { name: "卸载" }),
      );
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "uninstallPlugin",
      pluginId: "code-reviewer@wave-plugins-official",
      scope: "user",
    });
  });

  /* 托管插件（spec plugin A-024）：行内作用域显示「托管」、气泡说明来源、卸载入口
     置灰并给出原因——不是点了之后才被拒绝。 */
  it("托管插件：行内显示「托管」、气泡说明来源，卸载入口置灰并给出说明", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            anchorWorkdir: ANCHOR_WORKDIR,
            plugins: [
              {
                id: "team-guard@wave-plugins-official",
                name: "Team Guard",
                marketplace: "wave-plugins-official",
                installed: true,
                managed: true,
                version: "1.4.0",
                latestVersion: "1.4.0",
              },
            ],
          },
        }),
      );
    });

    const row = screen.getByText("Team Guard").closest(".settings-plugin-row");
    const pill = row?.querySelector(".settings-scope-pill") as HTMLElement;
    // 托管插件不属于本机任何作用域：标签不给「未知」，也不冒充「用户级」
    expect(pill.textContent).toContain("托管");
    expect(
      pill.closest(".tooltip-container")?.querySelector(".tooltip-box")
        ?.textContent,
    ).toBe("由组织管理，不可卸载");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "更换安装作用域" }));
    });
    const dialog = screen.getByRole("dialog", { name: "更换安装作用域" });
    expect(
      within(dialog).getByTestId("managed-plugin-notice"),
    ).toHaveTextContent(
      "该插件由组织管理，无法卸载或禁用。请联系管理员调整托管配置。",
    );
    expect(within(dialog).getByRole("button", { name: "卸载" })).toBeDisabled();

    // 置灰不是摆设：点它也不下发（真正的拦截在 SDK 侧，界面不给用户假希望）
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "卸载" }));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "uninstallPlugin" }),
    );
  });

  it("打开视图后台刷新清单：刷新完成后自动呈现最新版本并收起「检查更新中」", async () => {
    // spec 插件市场「市场清单自动刷新与插件升级解耦」场景 2/12：打开视图触发
    // 一次只拉检出的刷新，列表先显示进入前的清单（此时无「更新」按钮），宿主在
    // 刷新结束后带 refreshed 标记补发最新清单 → 版本对比可达、提示收起。
    const utils = renderPluginView();
    expect(utils.vscode.postMessage).toHaveBeenCalledWith({
      command: "refreshMarketplaces",
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: MARKETPLACES,
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: [
              {
                id: "code-reviewer@wave-plugins-official",
                name: "Code Reviewer",
                marketplace: "wave-plugins-official",
                installed: true,
                version: "3.1.2",
                latestVersion: "3.1.2",
                scope: "user",
              },
            ],
          },
        }),
      );
    });

    // 刷新未完成：清单是进入前的那份（已装 = 最新，只展示安装版本），且界面给出轻量提示
    expect(screen.getByText("v3.1.2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).toBeNull();
    expect(screen.getByText("检查更新中…")).toBeInTheDocument();

    // 刷新完成：宿主补发最新清单（上游已发布 3.2.0）
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: [
              {
                id: "code-reviewer@wave-plugins-official",
                name: "Code Reviewer",
                marketplace: "wave-plugins-official",
                installed: true,
                version: "3.1.2",
                latestVersion: "3.2.0",
                scope: "user",
              },
            ],
            refreshed: true,
          },
        }),
      );
    });

    // 刷新完成：宿主补发最新清单（上游已发布 3.2.0）→ 版本对比可达（升级胶囊把
    // 已装 3.1.2 与最新 3.2.0 并置），「更新」按钮出现、提示收起
    const upgrade = document.querySelector(".settings-plugin-upgrade");
    expect(upgrade?.textContent).toBe("v3.1.2v3.2.0");
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(screen.queryByText("检查更新中…")).toBeNull();
  });

  it("作用域弹窗的 project / local 两档标明写进哪个工程：一行「当前项目：名称（根目录）」，user 档不带", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "安装" }));
    });
    const dialog = screen.getByRole("dialog", { name: "选择安装作用域" });
    // 两档各自给出「当前项目：工程名（工程根目录）」一行（spec 场景 12/13）：local 与
    // project 写的是同一个工程，只给 project 加名字会让「本地」看起来不属于任何工程
    for (const scope of ["project", "local"]) {
      expect(
        within(dialog).getByTestId(`scope-project-${scope}`),
      ).toHaveTextContent(`当前项目：a（${ANCHOR_WORKDIR}）`);
    }
    // user 档不属于任何工程：一行工程名都不显示
    expect(within(dialog).queryByTestId("scope-project-user")).toBeNull();
  });

  it("锚点为空时 project / local 两档置灰不可选并说明原因，user 档照常可选", async () => {
    await mountWithData();

    // 宿主还没拿到任何工程目录（用户从未选过目录）：回包不带 anchorWorkdir。
    // 此时 project / local 无从判断写进哪个工程，写下去只会落到 CLI 子进程的随机
    // cwd，故两档置灰（spec 场景 12 / A-018）。
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "listPluginsResponse", plugins: PLUGINS },
        }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "安装" }));
    });
    const dialog = screen.getByRole("dialog", { name: "选择安装作用域" });
    for (const scope of ["project", "local"]) {
      const option = within(dialog)
        .getByTestId(`scope-project-${scope}`)
        .closest("button") as HTMLButtonElement;
      expect(option).toBeDisabled();
      expect(option).toHaveTextContent("需先选择项目目录后才能选择此作用域");
    }
    // user 档与工程无关，不受锚点影响，也仍是默认选中项
    expect(
      within(dialog).getByRole("button", { name: /用户（user）/ }),
    ).toBeEnabled();
  });

  it("当前市场「更新」在筛选行、筛选分段器右侧并只统计当前市场，该市场无可更新插件时不出现；市场移除走「管理」弹窗（官方标「官方」且不可移除）", async () => {
    const { vscode } = await mountWithData();

    // 位置（spec 场景 15）：筛选行里、分段器之后、搜索框之前；不在市场切换行
    const updateBtn = screen.getByTestId("plugins-update-market");
    expect(updateBtn).toHaveTextContent("更新");
    expect(updateBtn.textContent).toContain("1");
    // A-020：行内提示都换成自定义气泡了，筛选行「更新 N」的原生 title 是既有例外
    expect(updateBtn).toHaveAttribute(
      "title",
      "更新「wave-plugins-official」市场中的插件",
    );
    expect(
      document
        .querySelector(".settings-plugin-market-ops")
        ?.contains(updateBtn),
    ).toBe(false);
    const toolbarChildren = [
      ...document.querySelectorAll<HTMLElement>(".settings-plugin-toolbar > *"),
    ];
    expect(toolbarChildren.indexOf(updateBtn)).toBe(
      toolbarChildren.indexOf(
        document.querySelector<HTMLElement>(".settings-plugin-filters")!,
      ) + 1,
    );
    expect(toolbarChildren.indexOf(updateBtn)).toBeLessThan(
      toolbarChildren.indexOf(
        document.querySelector<HTMLElement>(".settings-plugin-search")!,
      ),
    );

    // 先弹确认弹窗（spec 场景 21）：这一步不下发
    await act(async () => {
      fireEvent.click(updateBtn);
    });
    const updateDialog = screen.getByRole("alertdialog");
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "updateMarketplace",
    });
    await act(async () => {
      fireEvent.click(
        within(updateDialog).getByRole("button", { name: "更新" }),
      );
    });
    // 带当前市场名下发（SDK updateMarketplace(name) 同语义）
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "updateMarketplace",
      name: "wave-plugins-official",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // 统计只跟当前市场走：社区市场没有可更新插件 → 按钮不出现
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    expect(
      screen.queryByTestId("plugins-update-market"),
    ).not.toBeInTheDocument();

    // 回到官方市场并在列表里把可更新插件清掉 → 按钮同样不出现（无更新则不显示）
    await act(async () => {
      fireEvent.click(
        screen.getByRole("tab", { name: /wave-plugins-official/ }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: PLUGINS.map((p) =>
              p.latestVersion === "3.2.0"
                ? { ...p, latestVersion: "3.1.2" }
                : p,
            ),
          },
        }),
      );
    });
    expect(
      screen.queryByTestId("plugins-update-market"),
    ).not.toBeInTheDocument();

    // 管理入口在市场切换行右侧（纯图标 + title/aria-label），弹窗列出全部市场
    const manageBtn = screen.getByTestId("plugins-manage-markets");
    expect(manageBtn).toHaveAttribute("aria-label", "管理插件市场");
    await act(async () => {
      fireEvent.click(manageBtn);
    });
    const manageDialog = screen.getByRole("dialog", { name: "管理插件市场" });
    const officialRow = within(manageDialog).getByTestId(
      "plugins-manage-row-wave-plugins-official",
    );
    expect(officialRow.textContent).toContain("wave-plugins-official");
    expect(officialRow.textContent).toContain("官方");
    expect(within(officialRow).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(manageDialog).getByTestId("plugins-manage-row-wave-community")
        .textContent,
    ).toContain("wave-community");

    // 自定义市场可移除：二次确认用市场名，确认后按该名下发。该市场下只有 1 个
    // **未安装**的插件 → 副文本整行不出现（spec 场景 17：只数已安装的）
    await act(async () => {
      fireEvent.click(
        within(
          within(manageDialog).getByTestId("plugins-manage-row-wave-community"),
        ).getByRole("button", { name: "移除" }),
      );
    });
    expect(
      screen.getByText("确认移除市场「wave-community」？"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/该市场下的 .* 个已安装插件将一并移除。/),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "removeMarketplace",
      name: "wave-community",
    });
  });

  /* 副文本按**已安装**计数（spec 场景 17）：「已安装」筛选的判据就是 `installed`，
     只列在列表里、没装上的插件不构成「用户要失去什么」，不进这个数字。 */
  it("移除市场确认框的副文本只数已安装插件（未安装的不计入）", async () => {
    await mountWithData();

    // 该市场 3 个插件：1 个已安装 + 2 个未安装 → 副文本说 1，不说 3
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: [
              {
                ...PLUGINS[3],
                installed: true,
                version: "0.9.0",
                scope: "user",
              },
              {
                id: "api-docs@wave-community",
                name: "API Docs",
                description: "生成接口文档",
                marketplace: "wave-community",
                installed: false,
                latestVersion: "1.2.0",
              },
              {
                id: "db-backup@wave-community",
                name: "DB Backup",
                description: "数据库备份",
                marketplace: "wave-community",
                installed: false,
                latestVersion: "0.3.0",
              },
            ],
          },
        }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-manage-markets"));
    });
    const communityRow = screen.getByTestId(
      "plugins-manage-row-wave-community",
    );
    await act(async () => {
      fireEvent.click(
        within(communityRow).getByRole("button", { name: "移除" }),
      );
    });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("确认移除市场「wave-community」？");
    expect(dialog).toHaveTextContent("该市场下的 1 个已安装插件将一并移除。");
    expect(dialog).not.toHaveTextContent("3 个");
  });

  /* 市场一多（真实用户能加十几个市场），整弹窗滚动会把标题和底部入口一起带走
     （spec 场景 16）。滚动区必须只在市场列表这一块：弹窗带 `is-manage`（CSS 据此
     把弹窗设为不滚动的 flex 列、把纵向滚动交给列表），标题行与底部入口都是弹窗的
     直接子元素、不在列表内 —— 列表怎么滚都不带走它们。列表/弹窗的真实几何由 demo
     在浏览器里断言（settings-plugin-market.demo.ts 的管理弹窗溢出段）。 */
  it("「管理插件市场」弹窗的滚动区只在市场列表，标题与底部入口不参与滚动", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-manage-markets"));
    });
    const dialog = screen.getByRole("dialog", { name: "管理插件市场" });
    expect(dialog.className).toContain("is-manage");

    const list = dialog.querySelector(".settings-market-manage-list");
    const header = dialog.querySelector(".settings-modal-header");
    const addBtn = screen.getByTestId("plugins-manage-add");
    expect(list).not.toBeNull();
    expect(list!.contains(header)).toBe(false);
    expect(list!.contains(addBtn)).toBe(false);

    // 顺序：标题行 → 市场列表 → 底部入口（列表是中间那块唯一的可增长区）
    const children = Array.from(dialog.children);
    expect(children.indexOf(header!)).toBeLessThan(children.indexOf(list!));
    expect(children.indexOf(list!)).toBeLessThan(
      children.indexOf(addBtn.parentElement!),
    );
  });

  it("当前市场「更新」的确认弹窗：正文注明市场名、清单只含该市场插件（名称/版本变化/作用域）；取消与 Esc 都不下发", async () => {
    const { vscode } = await mountWithData();

    // 两个市场各一条可更新插件（社区那条缺作用域 → 「未知」）
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: PLUGINS.map((p) =>
              p.id === "database-explorer@wave-community"
                ? {
                    ...p,
                    installed: true,
                    version: "0.9.0",
                    latestVersion: "0.9.5",
                  }
                : p,
            ),
          },
        }),
      );
    });

    // 当前市场是官方：清单只有官方那一条，社区那条不在
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-update-market"));
    });
    let dialog = screen.getByRole("alertdialog", {
      name: "确认更新 1 个插件？",
    });
    expect(dialog.textContent).toContain(
      "wave-plugins-official 市场下有 1 个插件可更新",
    );
    const officialItem = within(dialog).getByTestId(
      "plugin-update-item-code-reviewer@wave-plugins-official",
    );
    expect(officialItem.textContent).toContain("Code Reviewer");
    expect(officialItem.textContent).toContain("v3.1.2 → v3.2.0");
    expect(officialItem.textContent).toContain("用户");
    expect(
      within(dialog).queryByTestId(
        "plugin-update-item-database-explorer@wave-community",
      ),
    ).not.toBeInTheDocument();

    // 取消：只关弹窗
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "updateMarketplace",
    });

    // Esc 同款
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-update-market"));
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "updateMarketplace",
    });

    // 切到社区市场：同一按钮换出该市场的清单与文案（缺作用域 → 「未知」）
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-update-market"));
    });
    dialog = screen.getByRole("alertdialog", { name: "确认更新 1 个插件？" });
    expect(dialog.textContent).toContain(
      "wave-community 市场下有 1 个插件可更新",
    );
    const communityItem = within(dialog).getByTestId(
      "plugin-update-item-database-explorer@wave-community",
    );
    expect(communityItem.textContent).toContain("Database Explorer");
    expect(communityItem.textContent).toContain("v0.9.0 → v0.9.5");
    expect(communityItem.textContent).toContain("未知");
    expect(
      within(dialog).queryByTestId(
        "plugin-update-item-code-reviewer@wave-plugins-official",
      ),
    ).not.toBeInTheDocument();
  });

  it("确认弹窗的待更新清单取打开时刻快照：弹窗期间列表刷新不改清单，确认后仍按该市场名下发", async () => {
    const { vscode } = await mountWithData();
    const itemTestId = "plugin-update-item-code-reviewer@wave-plugins-official";

    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-update-market"));
    });
    expect(
      within(screen.getByRole("alertdialog")).getByTestId(itemTestId),
    ).toBeInTheDocument();

    // 弹窗期间宿主回发一份「已无可更新插件」的列表
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: PLUGINS.map((p) =>
              p.id === "code-reviewer@wave-plugins-official"
                ? { ...p, latestVersion: "3.1.2" }
                : p,
            ),
          },
        }),
      );
    });
    // 快照不变，仍列出打开时刻的那条
    expect(
      within(screen.getByRole("alertdialog")).getByTestId(itemTestId),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    // 快照里的市场名随快照一起冻结
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "updateMarketplace",
      name: "wave-plugins-official",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("tab 行右侧的加号图标直接打开「添加插件市场」弹窗（标题与入口同名）；「管理」弹窗内的入口等价", async () => {
    await mountWithData();

    // tab 行右侧的入口（spec 场景 16/18）：加号 = 添加插件市场、齿轮 = 管理插件市场
    expect(screen.getByTestId("plugins-add-market")).toHaveAttribute(
      "aria-label",
      "添加插件市场",
    );
    await openNewMarketDialog("add-icon");
    expect(
      screen.queryByRole("dialog", { name: "管理插件市场" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeInTheDocument();

    // 关掉再从「管理」弹窗内的入口开一次，两条路径等价
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await openNewMarketDialog("manage");
    expect(
      screen.queryByRole("dialog", { name: "管理插件市场" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeInTheDocument();
  });

  it("tab 行两个图标按钮悬浮时在下方显示提示气泡（不用原生 title）", async () => {
    await mountWithData();

    // spec 场景 16：图标按钮内没有可见文字，文案由 aria-label + 悬浮提示承载；
    // 用共享 Tooltip 而不是原生 title（两者同时出现会叠出两个提示）
    const addBtn = screen.getByTestId("plugins-add-market");
    const manageBtn = screen.getByTestId("plugins-manage-markets");
    expect(addBtn).not.toHaveAttribute("title");
    expect(manageBtn).not.toHaveAttribute("title");

    const addTip = addBtn
      .closest(".tooltip-container")
      ?.querySelector(".tooltip-box") as HTMLElement;
    const manageTip = manageBtn
      .closest(".tooltip-container")
      ?.querySelector(".tooltip-box") as HTMLElement;
    expect(addTip).toHaveTextContent("添加插件市场");
    expect(manageTip).toHaveTextContent("管理插件市场");
    // 气泡在按钮下方（Tooltip 的 position 决定箭头/方位类）
    expect(addTip.classList).toContain("tooltip-bottom");
    expect(manageTip.classList).toContain("tooltip-bottom");
    // 悬浮前都不可见
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(addBtn.closest(".tooltip-container") as HTMLElement);
    });
    await waitFor(() => {
      expect(addTip.classList).toContain("visible");
      expect(manageTip.classList).not.toContain("visible");
    });

    await act(async () => {
      fireEvent.mouseEnter(
        manageBtn.closest(".tooltip-container") as HTMLElement,
      );
    });
    await waitFor(() => {
      expect(manageTip.classList).toContain("visible");
    });
  });

  it("已安装行的作用域按钮悬浮时给出当前锚点工程的一行「名称（地址）」（不用原生 title）", async () => {
    await mountWithData();

    // spec 场景 22：气泡只说明该插件在当前锚点工程的归属——一行「工程名（工程根
    // 目录）」，不加「所属项目」这类行首标签、也不列出别的工程里的启用记录
    const projectPill = screen
      .getByText("Document Skills")
      .closest(".settings-plugin-row")
      ?.querySelector(".settings-scope-pill") as HTMLElement;
    expect(projectPill).not.toHaveAttribute("title");
    // 去掉原生 title 后无障碍名仍要保住
    expect(projectPill).toHaveAttribute("aria-label", "更换安装作用域");

    const projectTip = projectPill
      .closest(".tooltip-container")
      ?.querySelector(".tooltip-box") as HTMLElement;
    expect(projectTip.classList).toContain("tooltip-bottom");
    // 文案只有一行，但仍带 multiline：默认的单行 nowrap 会把长工程路径截成省略号，
    // 而路径正是工程重名时唯一的区分依据（multiline 只控制折行方式，不加行）
    expect(projectTip.classList).toContain("tooltip-multiline");
    expect(projectTip.textContent).toBe(`a（${ANCHOR_WORKDIR}）`);
    expect(document.querySelector(".tooltip-box.visible")).toBeNull();

    await act(async () => {
      fireEvent.mouseEnter(
        projectPill.closest(".tooltip-container") as HTMLElement,
      );
    });
    await waitFor(() => {
      expect(projectTip.classList).toContain("visible");
    });

    // 只以用户作用域安装、没有任何工程归属 → 说明对所有项目可用
    const userPill = screen
      .getByText("Code Reviewer")
      .closest(".settings-plugin-row")
      ?.querySelector(".settings-scope-pill") as HTMLElement;
    expect(
      userPill.closest(".tooltip-container")?.querySelector(".tooltip-box")
        ?.textContent,
    ).toBe("用户级安装（所有项目可用）");
  });

  it("已安装但当前工程没有启用记录时，气泡不冒充「用户级安装」", async () => {
    await mountWithData();

    // 装过又被清掉作用域记录：行内胶囊显示「未知」，气泡必须给同一口径的说法，
    // 否则两个提示互相矛盾（锚点工程仍在，只是它没有这个插件的启用记录）
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            anchorWorkdir: ANCHOR_WORKDIR,
            plugins: [
              {
                id: "document-skills@wave-plugins-official",
                name: "Document Skills",
                marketplace: "wave-plugins-official",
                installed: true,
                version: "2.1.0",
                latestVersion: "2.1.0",
              },
            ],
          },
        }),
      );
    });

    const row = screen
      .getByText("Document Skills")
      .closest(".settings-plugin-row");
    expect(row?.querySelector(".settings-scope-pill")?.textContent).toContain(
      "未知",
    );
    expect(
      row
        ?.querySelector(".settings-scope-pill")
        ?.closest(".tooltip-container")
        ?.querySelector(".tooltip-box")?.textContent,
    ).toBe("未在当前工程启用");
  });

  it("没有锚点工程时气泡只说明「所属工程未知」", async () => {
    await mountWithData();

    // 宿主还没拿到任何工程目录：给不出工程名（spec 场景 22），此时 project / local
    // 两档也不可选（场景 12），所以只能说明归属未知
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "listPluginsResponse", plugins: PLUGINS },
        }),
      );
    });

    const row = screen
      .getByText("Document Skills")
      .closest(".settings-plugin-row");
    expect(
      row
        ?.querySelector(".settings-scope-pill")
        ?.closest(".tooltip-container")
        ?.querySelector(".tooltip-box")?.textContent,
    ).toBe("所属工程未知");
  });

  it("移除当前市场后自动切到剩余市场的第一个；市场列表为空时展示空态引导", async () => {
    const { vscode } = await mountWithData();

    // host 回包：只剩社区市场 → 自动切到它
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [{ name: "wave-community" }],
          },
        }),
      );
    });
    expect(screen.getByText("Database Explorer")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /wave-community/ }),
    ).toBeInTheDocument();

    // 当前市场被移除后，选中项回到宿主下发顺序的第一位（顺序即宿主顺序，视图不重排）
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [{ name: "team-x" }, MARKETPLACES[0]],
          },
        }),
      );
    });
    expect(document.querySelectorAll(".settings-tab")[0].textContent).toContain(
      "team-x",
    );
    expect(screen.queryByText("Git Workflow")).not.toBeInTheDocument();

    // 再回空：进入无市场空态，「管理」入口仍在（引导从这里添加）；插件也随市场
    // 一起清空，当前市场「更新」自然不出现
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "listMarketplacesResponse", marketplaces: [] },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "listPluginsResponse", plugins: [] },
        }),
      );
    });
    expect(
      screen.getByText("暂无插件市场，点击「管理」添加"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("plugins-manage-markets")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plugins-update-market"),
    ).not.toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalled();
  });

  it("添加插件市场（本地路径）：选择文件夹 → host 回路径 → 直接添加为市场", async () => {
    const { vscode } = await mountWithData();

    await openNewMarketDialog();
    expect(
      screen.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));
    });
    const requestId = vscode.postMessage.mock.calls.find(
      (c) => c[0]?.command === "selectPluginMarketFolder",
    )?.[0]?.requestId;
    expect(requestId).toBeTruthy();

    // 归属不符的回复（别处的目录选择器）被丢弃
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "pluginMarketFolderSelected",
            requestId: "stale-request",
            path: "/tmp/other-market",
          },
        }),
      );
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "addMarketplace" }),
    );

    // 归属匹配：选定文件夹即添加为市场，市场名称交给市场自身清单
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "pluginMarketFolderSelected",
            requestId,
            path: "/work/team-plugins",
          },
        }),
      );
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "addMarketplace",
      input: "/work/team-plugins",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("添加插件市场（远程仓库）：owner/repo 或完整 Git 地址 + 添加", async () => {
    const { vscode } = await mountWithData();

    await openNewMarketDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "远程仓库" }));
    });
    // 默认本地路径（远程仓库需手动切换），本地模式不提供地址输入
    expect(screen.getByLabelText("市场地址")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "添加插件市场" });
    // 空输入不可提交
    expect(within(dialog).getByRole("button", { name: "添加" })).toBeDisabled();

    const input = screen.getByLabelText("市场地址");
    await act(async () => {
      fireEvent.change(input, { target: { value: "netease/wave-plugins" } });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "addMarketplace",
      input: "netease/wave-plugins",
    });
  });

  it("添加成功后自动切到新市场的 tab（筛选回到「全部」）", async () => {
    await mountWithData();

    // 先在当前市场落一个非「全部」筛选，验证切到新市场时回到「全部」
    await act(async () => {
      fireEvent.click(filterChip("未安装"));
    });

    await submitRemoteMarket("netease/team-plugins");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [...MARKETPLACES, { name: "team-plugins" }],
          },
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: [
              ...PLUGINS,
              {
                id: "team-lint@team-plugins",
                name: "Team Lint",
                marketplace: "team-plugins",
                installed: false,
                latestVersion: "1.0.0",
              },
            ],
          },
        }),
      );
    });

    expect(screen.getByRole("tab", { name: /team-plugins/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Team Lint")).toBeInTheDocument();
    expect(filterChip("全部")).toHaveAttribute("aria-pressed", "true");
    expect(filterChip("未安装")).toHaveAttribute("aria-pressed", "false");
  });

  /* 选中的切换项必须在可视区里（spec 场景 18）：新市场通常追加在切换条最右端，
     自动切过去之后若不把条滚过去，用户看到的是「选中项不见了」。 */
  it("自动切到的新 tab 落在可视区之外时切换条滚过去；已可见的切换项不触发滚动", async () => {
    await mountWithData();
    // 视口 0–400，新市场 team-plugins 追加在 500–640（条最右端之外）
    const layout = stubTabStripLayout({
      "team-plugins": { left: 500, right: 640 },
    });

    await submitRemoteMarket("netease/team-plugins");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [...MARKETPLACES, { name: "team-plugins" }],
          },
        }),
      );
    });
    expect(screen.getByRole("tab", { name: /team-plugins/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // 只补足被遮住的那一段（640 - 400），不是把它怼到最左端
    expect(layout.scrollLeft()).toBe(240);

    // 再点一个本来就完整可见的切换项：条不动（避免每次切换都抖一下）
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    expect(layout.scrollLeft()).toBe(240);

    layout.restore();
  });

  it("移除当前市场后自动切回的 tab 落在可视区左侧时，切换条向左补足", async () => {
    await mountWithData();
    // 视口 0–400，切回的官方市场被滚到左边之外（-50–50）
    const layout = stubTabStripLayout({
      "wave-plugins-official": { left: -50, right: 50 },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: /wave-community/ }));
    });
    layout.strip.scrollLeft = 300; // 用户先前自己滚到了右边

    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-manage-markets"));
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId("plugins-manage-row-wave-community"),
        ).getByRole("button", { name: "移除" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [MARKETPLACES[0]],
          },
        }),
      );
    });

    expect(
      screen.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(layout.scrollLeft()).toBe(250);

    layout.restore();
  });

  it("添加失败（回包里没有新市场）时保持当前选中的市场", async () => {
    await mountWithData();
    await submitRemoteMarket("netease/team-plugins");
    // 同名 / 来源重复时不新增市场（宿主也会刷新列表）→ 选中项不动
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: MARKETPLACES,
          },
        }),
      );
    });

    expect(
      screen.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();
  });

  it("弹窗内 Esc 关闭（capture 拦截，不穿透到下层）", async () => {
    await mountWithData();

    await openNewMarketDialog();
    expect(
      screen.getByRole("dialog", { name: "添加插件市场" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("点遮罩关闭弹窗，点弹窗内部不关闭", async () => {
    await mountWithData();

    // 添加插件市场弹窗
    await openNewMarketDialog();
    const newMarketDialog = screen.getByRole("dialog", {
      name: "添加插件市场",
    });
    await act(async () => {
      fireEvent.click(newMarketDialog);
    });
    expect(newMarketDialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(document.querySelector(".settings-modal-overlay")!);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 安装作用域弹窗同款
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "安装" }));
    });
    expect(
      screen.getByRole("dialog", { name: "选择安装作用域" }),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(document.querySelector(".settings-modal-overlay")!);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("移除市场后筛选回到「全部」（避免落在新市场的空分类）", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(filterChip("未安装"));
    });
    expect(filterChip("未安装")).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("plugins-manage-markets"));
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId("plugins-manage-row-wave-community"),
        ).getByRole("button", { name: "移除" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(filterChip("全部")).toHaveAttribute("aria-pressed", "true");
    expect(filterChip("未安装")).toHaveAttribute("aria-pressed", "false");
  });
});

/**
 * spec ecosystem/plugin.md 场景 3 + A-016：入口按宿主分工，同一宿主只保留一个——
 * 桌面端靠侧边栏整页（场景 1），设置页左侧导航不再重复一个「插件市场」项；
 * VSCE / JetBrains 没有侧边栏整页，设置页这项是它们唯一入口，必须保留。
 */
describe("设置页导航里的「插件市场」项按宿主区分", () => {
  const renderSettings = () =>
    render(
      <SettingsPage
        configurationData={null}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        vscode={createMockVscode()}
        workdir="/work/a"
      />,
    );

  const navEntry = (label: string) =>
    within(screen.getByRole("navigation", { name: "设置" })).queryByRole(
      "button",
      { name: label },
    );

  afterEach(() => {
    delete window.waveHostType;
  });

  it("桌面端：导航「AI 与扩展」分组里没有「插件市场」，同组其余项照常", () => {
    window.waveHostType = "desktop";
    renderSettings();

    expect(navEntry("插件市场")).toBeNull();
    // 只摘一项——同组其余导航项与分组标题都还在
    expect(navEntry("技能")).not.toBeNull();
    expect(navEntry("子代理")).not.toBeNull();
    expect(navEntry("MCP 服务")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "AI 与扩展" }),
    ).toBeInTheDocument();
  });

  it("IDE 宿主：导航保留「插件市场」项", () => {
    renderSettings();

    expect(navEntry("插件市场")).not.toBeNull();
  });
});
