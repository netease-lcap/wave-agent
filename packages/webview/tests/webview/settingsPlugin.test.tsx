/**
 * 设置页「插件市场」视图（spec ecosystem/plugin「设置页插件市场」）：
 * 市场 Tab + 计数、筛选计数、搜索、版本文案三态与行操作、安装/更换作用域弹窗、
 * 批量更新插件 / 移除市场、新建市场（本地路径 / 远程仓库）、空态与自动切市场，
 * 以及打开视图触发的后台清单刷新（只拉检出、不升级插件）。
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
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

/** host 回发：市场列表 + 插件列表（分两个市场，覆盖三态版本与作用域） */
const MARKETPLACES = [
  { name: "wave-plugins-official" },
  { name: "wave-community" },
];

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
 *  里带计数角标，且「已安装」与行内「✓ 已安装」按钮名字相近，故用 DOM 锚定。 */
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
        data: { command: "listPluginsResponse", plugins: PLUGINS },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "listPluginsResponse",
          plugins: PLUGINS,
          refreshed: true,
        },
      }),
    );
  });
  return utils;
}

describe("SettingsPage 插件市场视图", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("市场 Tab 带各市场插件数，默认选中第一个市场（列表与筛选计数按市场划分）", async () => {
    await mountWithData();

    // 市场 Tab（名称 + 计数角标）
    expect(
      screen.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /wave-community/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /wave-plugins-official/ }).textContent,
    ).toContain("3");

    // 默认选中第一个市场：只展示该市场的插件
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Database Explorer")).not.toBeInTheDocument();

    // 筛选计数（全部 3 / 已安装 2 / 未安装 1）；锚定「筛选胶囊」的名字前缀，
    // 避免与行内「✓ 已安装」按钮的 accessible name 撞车
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

  it("版本文案三态：未安装=最新版 / 有新版=两版并列 / 最新=单版", async () => {
    await mountWithData();

    expect(screen.getByText("最新 v2.3.1")).toBeInTheDocument();
    expect(screen.getByText("已安装 v3.1.2 · 最新 v3.2.0")).toBeInTheDocument();
    expect(screen.getByText("v2.1.0")).toBeInTheDocument();
  });

  it("行操作：未安装=安装、有新版=更新、最新=已安装；已安装展示作用域", async () => {
    const { vscode } = await mountWithData();

    expect(screen.getByRole("button", { name: "安装" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "✓ 已安装" }),
    ).toBeInTheDocument();
    // 已安装行的作用域 pill（当前作用域 + 更换入口）
    // 两个已安装行各有一个作用域 pill（当前作用域 + 更换入口）
    expect(screen.getAllByTitle("更换安装作用域")[0]).toBeInTheDocument();
    expect(screen.getByText("用户")).toBeInTheDocument();
    expect(screen.getByText("项目")).toBeInTheDocument();

    // 更新：安装作用域不变的单个插件更新
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "更新" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "updatePlugin",
      pluginId: "code-reviewer@wave-plugins-official",
    });
  });

  it("安装弹窗：三作用域 + 默认 user，确认后按所选作用域安装", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "安装" }));
    });
    const dialog = screen.getByRole("dialog", { name: "选择安装作用域" });
    expect(
      within(dialog).getByRole("button", { name: /为你安装（user）/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(dialog).getByRole("button", {
        name: /为此仓库的所有协作者安装（project）/,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", {
        name: /仅为你在此仓库中安装（local）/,
      }),
    ).toBeInTheDocument();
    // 未安装：无「卸载」，确认按钮为「安装」
    expect(
      within(dialog).queryByRole("button", { name: "卸载" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: /仅为你在此仓库中安装（local）/,
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
      fireEvent.click(screen.getAllByTitle("更换安装作用域")[0]);
    });
    const dialog = screen.getByRole("dialog", { name: "更换安装作用域" });
    // 预选当前作用域（Code Reviewer = user）
    expect(
      within(dialog).getByRole("button", { name: /为你安装（user）/ }),
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
      fireEvent.click(screen.getAllByTitle("更换安装作用域")[0]);
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

    expect(screen.getByText("已安装 v3.1.2 · 最新 v3.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(screen.queryByText("检查更新中…")).toBeNull();
  });

  it("批量更新插件按当前市场名下发，移除市场二次确认后按名下发", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "批量更新插件" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "updateMarketplace",
      name: "wave-plugins-official",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "移除市场" }));
    });
    // 确认框提示将一并移除的插件数
    expect(
      screen.getByText("确认移除市场「wave-plugins-official」？"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("该市场下的 3 个插件将一并移除。"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "移除" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "removeMarketplace",
      name: "wave-plugins-official",
    });
  });

  it("移除当前市场后自动切到剩余市场；全部移除后展示空态引导", async () => {
    const { vscode } = await mountWithData();

    // host 回包：只剩社区市场
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

    // 再回空：进入无市场空态
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "listMarketplacesResponse", marketplaces: [] },
        }),
      );
    });
    expect(
      screen.getByText("暂无插件市场，点击右上角「＋ 新建市场」添加"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新建市场" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "批量更新插件" }),
    ).not.toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalled();
  });

  it("新建市场（本地路径）：选择文件夹 → host 回路径 → 直接添加为市场", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    expect(
      screen.getByRole("dialog", { name: "新建市场" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("添加一个插件市场源，添加后可在顶部切换。"),
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

  it("新建市场（远程仓库）：owner/repo 或完整 Git 地址 + 添加", async () => {
    const { vscode } = await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "远程仓库" }));
    });
    // 默认本地路径（远程仓库需手动切换），本地模式不提供地址输入
    expect(screen.getByLabelText("市场地址")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "新建市场" });
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

  it("新建市场成功后自动选中该新市场 Tab，筛选回到「全部」", async () => {
    const { vscode } = await mountWithData();

    // 先落在「已安装」筛选上：添加成功后应回到「全部」（否则新市场的空分类会像坏掉）
    await act(async () => {
      fireEvent.click(filterChip("已安装"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "远程仓库" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("市场地址"), {
        target: { value: "netease/team-plugins" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "addMarketplace",
      input: "netease/team-plugins",
    });

    // host 刷新两份列表：市场名由市场自身清单决定，只有回包才知道新市场叫什么
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listMarketplacesResponse",
            marketplaces: [...MARKETPLACES, { name: "team-plugins" }],
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "listPluginsResponse",
            plugins: [
              ...PLUGINS,
              {
                id: "release-notes@team-plugins",
                name: "Release Notes",
                description: "从提交记录生成发布说明",
                marketplace: "team-plugins",
                installed: false,
                latestVersion: "1.0.0",
              },
            ],
          },
        }),
      );
    });

    // 选中新市场：列表与筛选计数随即显示它的内容
    expect(screen.getByRole("tab", { name: /team-plugins/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: /wave-plugins-official/ }),
    ).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Release Notes")).toBeInTheDocument();
    expect(screen.queryByText("Git Workflow")).not.toBeInTheDocument();
    expect(filterChip("全部")).toHaveAttribute("aria-pressed", "true");
  });

  it("添加市场失败（回包未出现新市场）时保持原选中市场", async () => {
    await mountWithData();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "远程仓库" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("市场地址"), {
        target: { value: "netease/duplicated" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
    });

    // 重名 / 无效来源 ⇒ 宿主只提示失败，随后任何一次列表刷新都不含新市场名
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    expect(
      screen.getByRole("dialog", { name: "新建市场" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("点遮罩关闭弹窗，点弹窗内部不关闭", async () => {
    await mountWithData();

    // 新建市场弹窗
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "新建市场" }));
    });
    const newMarketDialog = screen.getByRole("dialog", { name: "新建市场" });
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
      fireEvent.click(screen.getByRole("button", { name: "移除市场" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "移除" }));
    });
    expect(filterChip("全部")).toHaveAttribute("aria-pressed", "true");
    expect(filterChip("未安装")).toHaveAttribute("aria-pressed", "false");
  });
});
