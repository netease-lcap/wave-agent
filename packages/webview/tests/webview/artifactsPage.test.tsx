import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, act, within } from "@testing-library/react";
import React from "react";
import { ArtifactsPage } from "../../src/components/ArtifactsPage";
import type {
  ArtifactGalleryItem,
  ArtifactCategory,
} from "wave-webview-fixtures";

/**
 * 创作集整页（spec desktop/desktop-artifacts.md）。
 *
 * 页面的数据全部经宿主消息往来：列表 `desktopArtifactsList`、分类
 * `desktopArtifactCategories`、撤销 `desktopArtifactRevoke`、分享弹层的
 * `desktopArtifactShareView` / `desktopArtifactMemberSearch` /
 * `desktopArtifactShareSave`。测试直接渲染页面并注入这些回包，锚定 testid。
 */

const SERVER_URL = "https://codechat.test";

// 视图偏好落在本机存储里（进页面沿用上次那一档），用例之间必须清掉，
// 否则前一个用例切到自定义视图会让后一个用例从非默认档起步。
beforeEach(() => {
  window.localStorage.clear();
});

/** 视图是页头右上角的下拉（辅助开关）：先展开菜单再选项。 */
function switchView(view: "default" | "custom") {
  fireEvent.click(screen.getByTestId("artifacts-view-toggle"));
  fireEvent.click(screen.getByTestId(`artifacts-view-${view}`));
}

interface Harness {
  vscode: { postMessage: ReturnType<typeof vi.fn> };
  onNewFromTemplate: ReturnType<typeof vi.fn>;
  sent: () => Array<Record<string, unknown>>;
  reply: (message: Record<string, unknown>) => void;
  /** 卸载页面（重新进入创作集 = 重新挂载）。 */
  unmount: () => void;
}

function renderPage(
  options: {
    categories?: ArtifactCategory[];
    assignments?: Record<string, string>;
  } = {},
): Harness {
  const vscode = { postMessage: vi.fn() };
  const onNewFromTemplate = vi.fn();
  const view = render(
    <ArtifactsPage
      onBack={vi.fn()}
      vscode={vscode as never}
      serverUrl={SERVER_URL}
      onNewFromTemplate={onNewFromTemplate}
    />,
  );

  const sent = () =>
    vscode.postMessage.mock.calls.map(
      ([msg]) => msg as Record<string, unknown>,
    );
  const reply = (message: Record<string, unknown>) => {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  };

  // The page asks for the list + the local categories on mount; answer both
  // with the requestIds it just used (the page discards stale replies).
  const listReq = sent().find((m) => m.command === "desktopArtifactsList");
  reply({
    command: "desktopArtifactsList",
    requestId: listReq?.requestId,
    items: [],
  });
  const catReq = sent().find(
    (m) => m.command === "desktopArtifactCategoriesGet",
  );
  reply({
    command: "desktopArtifactCategories",
    requestId: catReq?.requestId,
    categories: options.categories ?? [],
    assignments: options.assignments ?? {},
  });

  return { vscode, onNewFromTemplate, sent, reply, unmount: view.unmount };
}

const answerList = (harness: Harness, items: ArtifactGalleryItem[]) => {
  const req = [...harness.sent()]
    .reverse()
    .find((m) => m.command === "desktopArtifactsList");
  harness.reply({
    command: "desktopArtifactsList",
    requestId: req?.requestId,
    items,
  });
};

/** 最后一条匹配的命令负载（测试里的 tests tsconfig 不支持 Array.prototype.at）。 */
const lastSent = (
  harness: Harness,
  command: string,
): Record<string, unknown> | undefined => {
  const matching = harness.sent().filter((m) => m.command === command);
  return matching[matching.length - 1];
};

const mine = (
  slug: string,
  title: string,
  extra: Partial<ArtifactGalleryItem> = {},
): ArtifactGalleryItem => ({ slug, title, rel: "mine", ...extra });

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("创作集 · 列表", () => {
  it("默认停在「我发布的」，五列齐全并按最近发布时间倒序", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("old", "旧页面", {
        updatedAt: "2026-10-01T00:00:00Z",
        ownerEmail: "me@corp.com",
        shareMode: "owner",
      }),
      mine("new", "新页面", {
        updatedAt: "2026-10-19T00:00:00Z",
        ownerEmail: "me@corp.com",
        shareMode: "org",
      }),
    ]);

    expect(screen.getByText("文件名称")).toBeInTheDocument();
    expect(screen.getByText("发布人")).toBeInTheDocument();
    expect(screen.getByText("最近发布时间")).toBeInTheDocument();
    expect(screen.getByText("分享给")).toBeInTheDocument();
    expect(screen.getByText("操作")).toBeInTheDocument();

    const rows = screen.getAllByTestId(/^artifacts-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "artifacts-row-new",
      "artifacts-row-old",
    ]);
  });

  it("发布人列：自己发布的邮箱后标「（我）」，共享给我的行不标", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("m", "我的页面", { ownerEmail: "me@corp.com" }),
      {
        slug: "s",
        title: "别人的页面",
        rel: "shared",
        ownerEmail: "bob@corp.com",
      },
    ]);

    // 默认视图「我发布的」：自己发布的行带（我）。
    expect(screen.getByTestId("artifacts-row-m")).toHaveTextContent(
      "me@corp.com（我）",
    );

    // 「共享给我的」里发布人是分享者，不带（我）。
    fireEvent.click(screen.getByTestId("artifacts-tab-shared"));
    const sharedRow = screen.getByTestId("artifacts-row-s");
    expect(sharedRow).toHaveTextContent("bob@corp.com");
    expect(sharedRow.textContent).not.toContain("（我）");
  });

  it("「分享给」三档文案：仅自己 / 企业成员（不列人名不带人数）/ 团队成员+最多两位", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("s-owner", "仅自己页面", { shareMode: "owner" }),
      mine("s-org", "企业页面", { shareMode: "org" }),
      mine("s-users", "成员页面", {
        shareMode: "users",
        sharedEmails: ["a@corp.com", "b@corp.com", "c@corp.com"],
      }),
    ]);

    const row = (slug: string) => screen.getByTestId(`artifacts-row-${slug}`);
    expect(row("s-owner").textContent).toContain("仅自己");

    const org = row("s-org").textContent ?? "";
    expect(org).toContain("企业成员");
    expect(org).not.toContain("@corp.com");
    expect(org).not.toContain("3 人");

    const users = row("s-users").textContent ?? "";
    expect(users).toContain("团队成员");
    expect(users).toContain("a@corp.com");
    expect(users).toContain("b@corp.com");
    expect(users).not.toContain("c@corp.com");
    expect(users).toContain("等 3 人");
  });

  it("共享给我的行：「发布人」是分享者、「分享给」是 —、没有「分享」按钮", () => {
    const harness = renderPage();
    answerList(harness, [
      {
        slug: "peer",
        title: "同事的页面",
        rel: "shared",
        ownerEmail: "peer@corp.com",
      },
    ]);
    fireEvent.click(screen.getByTestId("artifacts-tab-shared"));

    const row = screen.getByTestId("artifacts-row-peer");
    expect(row.textContent).toContain("peer@corp.com");
    expect(row.textContent).toContain("—");
    expect(
      screen.queryByTestId("artifacts-share-peer"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("artifacts-browser-peer")).toBeInTheDocument();
  });

  it("空列表给空态文案，不渲染空表格", () => {
    renderPage();
    expect(screen.getByTestId("artifacts-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-table")).not.toBeInTheDocument();
  });

  it("401 → 「请先登录」，不当成空列表", () => {
    const harness = renderPage();
    const req = [...harness.sent()]
      .reverse()
      .find((m) => m.command === "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      authRequired: true,
    });

    expect(screen.getByTestId("artifacts-auth")).toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-empty")).not.toBeInTheDocument();
  });

  it("未登录空态里登录成功后自动重取列表与分类（3500345467492608）", () => {
    const harness = renderPage();
    const req = [...harness.sent()]
      .reverse()
      .find((m) => m.command === "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      authRequired: true,
    });
    // 先让页面知道「此刻是未登录」——宿主登录成功前会推一次 false。
    harness.reply({ command: "desktopAccountInfo", isAuthenticated: false });
    expect(screen.getByTestId("artifacts-auth")).toBeInTheDocument();

    const before = harness.sent().length;
    harness.reply({ command: "loginResponse", success: true });

    // 登录成功 → 重新要一次列表与分类。
    expect(harness.sent().length).toBeGreaterThan(before);
    expect(lastSent(harness, "desktopArtifactsList")).toBeDefined();
    expect(lastSent(harness, "desktopArtifactCategoriesGet")).toBeDefined();

    // 回包后空态消失，列表按新账号渲染。
    answerList(harness, [mine("a", "登录后可见", { shareMode: "owner" })]);
    expect(screen.queryByTestId("artifacts-auth")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifacts-row-a")).toBeInTheDocument();
  });

  it("登录态从窗口级广播翻到已登录也会重取一次（不依赖 loginResponse）", () => {
    const harness = renderPage();
    const req = [...harness.sent()]
      .reverse()
      .find((m) => m.command === "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      authRequired: true,
    });
    harness.reply({ command: "desktopAccountInfo", isAuthenticated: false });

    const before = harness.sent().length;
    harness.reply({ command: "desktopAccountInfo", isAuthenticated: true });
    expect(harness.sent().length).toBeGreaterThan(before);

    // 同一状态再推一次不重复请求。
    const after = harness.sent().length;
    harness.reply({ command: "desktopAccountInfo", isAuthenticated: true });
    expect(harness.sent().length).toBe(after);
  });

  it("403 → 普通错误提示，不弹登录入口", () => {
    const harness = renderPage();
    const req = [...harness.sent()]
      .reverse()
      .find((m) => m.command === "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      error: "没有权限执行该操作（HTTP 403）",
    });

    expect(screen.queryByTestId("artifacts-auth")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifacts-error")).toHaveTextContent(
      "没有权限执行该操作（HTTP 403）",
    );
  });

  it("请求失败给错误与重试，点击重试重新拉取", () => {
    const harness = renderPage();
    const req = [...harness.sent()]
      .reverse()
      .find((m) => m.command === "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      error: "network down",
    });

    expect(screen.getByTestId("artifacts-error")).toBeInTheDocument();
    const before = harness.sent().length;
    fireEvent.click(screen.getByText("重试"));
    expect(harness.sent().length).toBeGreaterThan(before);
  });

  it("手动刷新成功给「刷新成功」提示；首屏加载与失败重试都不提示", () => {
    const harness = renderPage();
    // 首屏那次加载不是刷新，不给轻提示。
    answerList(harness, [mine("a", "首页", { shareMode: "owner" })]);
    expect(screen.queryByTestId("artifacts-toast")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("artifacts-refresh"));
    answerList(harness, [mine("b", "刷新后", { shareMode: "owner" })]);
    expect(screen.getByTestId("artifacts-toast")).toHaveTextContent("刷新成功");

    // 刷新失败不给成功提示（只保留原有错误态）。
    fireEvent.click(screen.getByTestId("artifacts-refresh"));
    const req = lastSent(harness, "desktopArtifactsList");
    harness.reply({
      command: "desktopArtifactsList",
      requestId: req?.requestId,
      error: "network down",
    });
    expect(screen.getByTestId("artifacts-error")).toBeInTheDocument();
  });

  it("文件名搜索按子串过滤（大小写不敏感）", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("a", "Pricing Page", { shareMode: "owner" }),
      mine("b", "报表", { shareMode: "owner" }),
    ]);

    fireEvent.change(screen.getByTestId("artifacts-search"), {
      target: { value: "pricing" },
    });

    expect(screen.getByTestId("artifacts-row-a")).toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-row-b")).not.toBeInTheDocument();
  });

  it("搜索框有内容时出现清除按钮，点击后清空并恢复全量（3500400967563520）", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("a", "Pricing Page", { shareMode: "owner" }),
      mine("b", "报表", { shareMode: "owner" }),
    ]);

    // 空搜索时不渲染清除按钮。
    expect(
      screen.queryByTestId("artifacts-search-clear"),
    ).not.toBeInTheDocument();

    const input = screen.getByTestId("artifacts-search");
    fireEvent.change(input, { target: { value: "pricing" } });
    expect(screen.queryByTestId("artifacts-row-b")).not.toBeInTheDocument();

    const clear = screen.getByTestId("artifacts-search-clear");
    fireEvent.click(clear);

    expect(input).toHaveValue("");
    expect(screen.getByTestId("artifacts-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("artifacts-row-b")).toBeInTheDocument();
    // 清空后清除按钮自身消失，焦点交还输入框。
    expect(
      screen.queryByTestId("artifacts-search-clear"),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it("搜索无结果的空态文案区分「分类下」与「无分类」", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }],
      assignments: { a: "cat-1" },
    });
    answerList(harness, [mine("a", "Pricing Page", { shareMode: "owner" })]);

    switchView("custom");
    fireEvent.click(screen.getByTestId("artifacts-category-cat-1"));
    fireEvent.change(screen.getByTestId("artifacts-search"), {
      target: { value: "报表" },
    });
    expect(screen.getByTestId("artifacts-empty")).toHaveTextContent(
      "该分类下暂无相关文件",
    );

    // 「全部」和默认视图都没有具体分类，措辞退回通用说法。
    fireEvent.click(screen.getByTestId("artifacts-category-all"));
    expect(screen.getByTestId("artifacts-empty")).toHaveTextContent(
      "没有找到相关文件",
    );

    switchView("default");
    expect(screen.getByTestId("artifacts-empty")).toHaveTextContent(
      "没有找到相关文件",
    );
  });

  it("没有搜索词时分类空态仍是「这个分类下还没有文件」", () => {
    renderPage({ categories: [{ id: "cat-1", name: "运营" }] });
    switchView("custom");
    fireEvent.click(screen.getByTestId("artifacts-category-cat-1"));
    expect(screen.getByTestId("artifacts-empty")).toHaveTextContent(
      "这个分类下还没有文件",
    );
  });
});

describe("创作集 · 视图偏好", () => {
  it("记住上次选的视图：重新进入页面直接落到自定义视图", () => {
    const first = renderPage();
    switchView("custom");
    // 主 tab 已经是当前视图下的分类（不再是我发布的 / 共享给我的）。
    expect(screen.getByTestId("artifacts-category-all")).toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-tab-mine")).not.toBeInTheDocument();

    first.unmount();
    renderPage();

    // 没有点任何开关：挂载即沿用上次那一档。
    expect(screen.getByTestId("artifacts-view-toggle")).toHaveTextContent(
      "自定义视图",
    );
    expect(screen.getByTestId("artifacts-category-all")).toBeInTheDocument();
  });

  it("「全部」列表有「所属分类」列：显示分类名，未归类显示「未分类」，分类 tab 下不出现", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }] as ArtifactCategory[],
      // b 的归属指向一个已不存在的分类（旧数据），按「未分类」兜底。
      assignments: { a: "cat-1", b: "cat-gone" },
    });
    answerList(harness, [
      mine("a", "页面 A"),
      mine("b", "页面 B"),
      mine("c", "页面 C"),
    ]);
    switchView("custom");

    expect(screen.getByText("所属分类")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("artifacts-row-a")).getByText("运营"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("artifacts-row-b")).getByText("未分类"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("artifacts-row-c")).getByText("未分类"),
    ).toBeInTheDocument();

    // 切到分类 tab：每行都同属这个分类，这一列不再重复展示。
    fireEvent.click(screen.getByTestId("artifacts-category-cat-1"));
    expect(screen.queryByText("所属分类")).not.toBeInTheDocument();
  });

  it("存储不可用时（原型 artifact 的沙箱）仍记住本次会话里的视图选择", () => {
    // sandbox srcdoc iframe（origin null）里 localStorage 一读就抛 SecurityError，
    // 原来会静默退回默认视图 —— 设计师看到的就是「没记住我的偏好」。
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });

    const first = renderPage();
    switchView("custom");
    expect(screen.getByTestId("artifacts-view-toggle")).toHaveTextContent(
      "自定义视图",
    );

    // 关掉创作集再进来（组件重挂载）：本次页面会话内仍是自定义视图。
    first.unmount();
    renderPage();
    expect(screen.getByTestId("artifacts-view-toggle")).toHaveTextContent(
      "自定义视图",
    );

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("视图开关的图标随视图切换（两档不共用同一颗图标）", () => {
    renderPage();
    const toggle = () => screen.getByTestId("artifacts-view-toggle");
    const iconMarkup = () => toggle().querySelector("svg")?.innerHTML;

    expect(toggle()).toHaveAttribute("data-view", "default");
    const defaultIcon = iconMarkup();
    expect(defaultIcon).toBeTruthy();

    switchView("custom");
    expect(toggle()).toHaveAttribute("data-view", "custom");
    expect(iconMarkup()).not.toBe(defaultIcon);

    switchView("default");
    expect(iconMarkup()).toBe(defaultIcon);
  });
});

describe("创作集 · 分类", () => {
  it("自定义视图新增分类 → 写本机存储并自动选中（空态）", () => {
    const harness = renderPage();
    switchView("custom");
    fireEvent.click(screen.getByTestId("artifacts-new-category"));

    fireEvent.change(screen.getByTestId("artifacts-category-name"), {
      target: { value: "运营" },
    });
    fireEvent.click(screen.getByTestId("artifacts-category-confirm"));

    const save = lastSent(harness, "desktopArtifactCategoriesSave");
    expect(save?.categories).toEqual([
      expect.objectContaining({ name: "运营" }),
    ]);
    expect(screen.getByTestId("artifacts-empty")).toHaveTextContent(
      "这个分类下还没有文件",
    );
  });

  it("重名 / 超 20 字 / 保留名 / 空名 均拒绝创建并给出理由", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }] as ArtifactCategory[],
    });
    switchView("custom");

    const cases: Array<[string, string]> = [
      ["运营", "分类名称不能重复"],
      ["我发布的", "这是默认视图的分组名，请换一个"],
      ["a".repeat(21), "分类名称最多 20 个字"],
      ["   ", "请输入分类名称"],
    ];
    for (const [name, reason] of cases) {
      fireEvent.click(screen.getByTestId("artifacts-new-category"));
      fireEvent.change(screen.getByTestId("artifacts-category-name"), {
        target: { value: name },
      });
      fireEvent.click(screen.getByTestId("artifacts-category-confirm"));
      // 被拒：不写本机存储，弹层留着并就地说明原因。
      expect(
        harness
          .sent()
          .some((m) => m.command === "desktopArtifactCategoriesSave"),
      ).toBe(false);
      expect(screen.getByTestId("artifacts-category-dialog")).toHaveTextContent(
        reason,
      );
      fireEvent.click(screen.getByText("取消"));
    }
  });

  it("删除分类：文案统一，原分类下的文件自动移出（不再要求选迁移目标）", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }] as ArtifactCategory[],
      assignments: { a: "cat-1" },
    });
    answerList(harness, [
      mine("a", "页面 A", { shareMode: "owner" }),
      mine("b", "页面 B", { shareMode: "owner" }),
    ]);
    switchView("custom");

    fireEvent.click(screen.getByTestId("artifacts-category-more-cat-1"));
    fireEvent.click(screen.getByTestId("artifacts-category-menu-delete"));

    const dialog = screen.getByTestId("artifacts-category-dialog");
    expect(dialog).toHaveTextContent("确定删除分类「运营」吗？");
    expect(dialog).toHaveTextContent("删除后，原分类下的文件将自动移出该分类");
    // 不再有「移入哪个分类」的下拉，也不需要先选目标才能删。
    expect(
      screen.queryByTestId("artifacts-category-move-target"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("artifacts-category-confirm"));

    const save = lastSent(harness, "desktopArtifactCategoriesSave");
    expect(save?.categories).toEqual([]);
    expect(save?.assignments).toEqual({});
    expect(
      screen.queryByTestId("artifacts-category-dialog"),
    ).not.toBeInTheDocument();
  });

  it("输入时实时校验：超过 20 字立刻提示，改回合规即消失", () => {
    renderPage();
    switchView("custom");
    fireEvent.click(screen.getByTestId("artifacts-new-category"));
    const input = screen.getByTestId("artifacts-category-name");

    fireEvent.change(input, { target: { value: "a".repeat(21) } });
    expect(screen.getByTestId("artifacts-category-dialog")).toHaveTextContent(
      "分类名称最多 20 个字",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, { target: { value: "a".repeat(20) } });
    expect(
      screen.getByTestId("artifacts-category-dialog"),
    ).not.toHaveTextContent("分类名称最多 20 个字");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("多选动作收在页头：未选置灰、勾选后「修改分类」可点，改完就地刷新列表", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }] as ArtifactCategory[],
    });
    answerList(harness, [
      mine("a", "页面 A", { shareMode: "owner" }),
      mine("b", "页面 B", { shareMode: "owner" }),
    ]);
    switchView("custom");

    // 没有批量条、也没有「取消选择」键，只剩页头一颗常驻的「修改分类」，
    // 未选时置灰（spec 场景 5）。
    expect(screen.queryByTestId("artifacts-batch")).not.toBeInTheDocument();
    expect(screen.queryByText("取消选择")).not.toBeInTheDocument();
    const moveButton = () => screen.getByTestId("artifacts-batch-category");
    expect(moveButton()).toHaveTextContent("修改分类");
    expect(moveButton()).toBeDisabled();

    // 勾选后按钮可点；Tooltip 的包装层随禁用态增删，节点会重挂，所以每次重新取。
    fireEvent.click(screen.getByLabelText("选择 页面 A"));
    expect(moveButton()).toBeEnabled();

    fireEvent.click(moveButton());
    // 菜单顶部是一行只读说明「已选 N 个文件移至分类…」，随勾选数变化，且不参与
    // ↑↓ 走查（不是 menuitem）—— spec 场景 5。
    const header = screen.getByTestId("artifacts-batch-menu-header");
    expect(header).toHaveTextContent("已选 1 个文件移至分类…");
    expect(header).not.toHaveAttribute("role", "menuitem");
    fireEvent.click(screen.getByTestId("artifacts-batch-cat-1"));

    const save = lastSent(harness, "desktopArtifactCategoriesSave");
    expect(save?.assignments).toEqual({ a: "cat-1" });
    // 归类后分类本身仍在，不能「归完类分类就没了」。tab 只写分类名（设计师
    // 2026-11-06：不再挂计数角标），计数只出现在删除分类弹窗里。
    const tab = screen.getByTestId("artifacts-category-cat-1");
    expect(tab).toHaveTextContent("运营");
    expect(tab).not.toHaveTextContent("1");
  });

  it("「修改分类」置灰时 hover 提示「请先选择文件」，勾选后提示撤掉", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "页面 A", { shareMode: "owner" })]);
    switchView("custom");

    const button = screen.getByTestId("artifacts-batch-category");
    const container = button.closest(".tooltip-container") as HTMLElement;
    expect(container).not.toBeNull();
    // 气泡常驻渲染，隐藏态是 `visibility: hidden`——按 role 查会被可访问性树
    // 过滤掉（`getByRole` 默认排除 hidden），所以直接取节点、再验 class 翻面。
    const bubble = container.querySelector(".tooltip-box") as HTMLElement;
    expect(bubble).toHaveTextContent("请先选择文件");
    fireEvent.mouseEnter(container);
    expect(bubble).toHaveClass("visible");

    // 勾选后按钮可点，气泡连同包装层一起撤掉（节点随包装层重挂，重新取）。
    fireEvent.click(screen.getByLabelText("选择 页面 A"));
    expect(
      screen
        .getByTestId("artifacts-batch-category")
        .closest(".tooltip-container"),
    ).toBeNull();
  });

  it("取消勾选后「修改分类」回到置灰", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "页面 A", { shareMode: "owner" })]);
    switchView("custom");

    const checkbox = screen.getByLabelText("选择 页面 A");
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);

    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("artifacts-batch-category")).toBeDisabled();
  });
});

describe("创作集 · 模板新建与撤销", () => {
  it("选模板 → 把提示词交给宿主（宿主负责建会话并预填）", () => {
    const harness = renderPage();
    fireEvent.click(screen.getByTestId("artifacts-new"));
    fireEvent.click(screen.getByTestId("artifacts-template-hifi"));

    expect(harness.onNewFromTemplate).toHaveBeenCalledTimes(1);
    expect(harness.onNewFromTemplate.mock.calls[0][0]).toContain(
      "帮我做一个高保真原型",
    );
    // 末尾固定带发布节奏收尾（spec「模板新建直达对话页」场景 3）：先本地出稿，
    // 之后每轮生成结束都在「继续调整」/「发布为创作（artifact）」之间征求用户意见。
    expect(harness.onNewFromTemplate.mock.calls[0][0]).toContain(
      "都给我「继续调整」和「发布为创作（artifact）」两个选项让我选",
    );
  });

  it("撤销发布二次确认后发命令，成功后行消失并提示", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "页面 A", { shareMode: "owner" })]);

    fireEvent.click(screen.getByTestId("artifacts-share-a"));
    fireEvent.click(screen.getByTestId("artifacts-share-revoke"));
    fireEvent.click(screen.getByTestId("artifacts-revoke-confirm"));

    const revoke = harness
      .sent()
      .find((m) => m.command === "desktopArtifactRevoke");
    expect(revoke?.slug).toBe("a");

    harness.reply({
      command: "desktopArtifactRevoke",
      requestId: revoke?.requestId,
      slug: "a",
      ok: true,
    });

    expect(screen.queryByTestId("artifacts-row-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("artifacts-toast")).toHaveTextContent(
      "已撤销发布",
    );
  });
});

describe("创作集 · 分享弹层", () => {
  it("回显服务端范围，勾选成员后保存提交 userIds", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "页面 A")]);

    fireEvent.click(screen.getByTestId("artifacts-share-a"));
    const view = harness
      .sent()
      .find((m) => m.command === "desktopArtifactShareView");
    expect(view?.slug).toBe("a");
    harness.reply({
      command: "desktopArtifactShareView",
      requestId: view?.requestId,
      slug: "a",
      mode: "org",
      pinnedVersion: null,
      sharedUsers: [],
      versions: [{ version: 2 }, { version: 1 }],
    });

    expect(screen.getByTestId("artifacts-share-mode-org")).toBeChecked();
    expect(screen.getByTestId("artifacts-share-mode-users")).not.toBeChecked();

    fireEvent.click(screen.getByTestId("artifacts-share-mode-users"));
    const search = lastSent(harness, "desktopArtifactMembersSearch");
    harness.reply({
      command: "desktopArtifactMembersSearch",
      requestId: search?.requestId,
      members: [
        { userId: "u1", email: "x@corp.com" },
        { userId: "u2", email: "y@corp.com" },
      ],
    });

    fireEvent.click(screen.getByTestId("artifacts-member-u1"));
    fireEvent.click(screen.getByTestId("artifacts-share-save"));

    const save = lastSent(harness, "desktopArtifactShareSave");
    expect(save).toMatchObject({ slug: "a", mode: "users", userIds: ["u1"] });
  });
});

/**
 * 文件名行内重命名（spec「重命名创作」）。
 *
 * 服务端还没有改标题接口，当前实现是交互原型：只改本页 state，不发命令，
 * 也因此不重新拉列表。用例锚定 testid，不依赖图标类名。
 */
describe("创作集 · 重命名", () => {
  const openRename = (slug: string) =>
    fireEvent.click(screen.getByTestId(`artifacts-rename-${slug}`));

  it("自有行有铅笔入口；共享行没有；点开是带原名的输入框", () => {
    const harness = renderPage();
    answerList(harness, [
      mine("a", "旧名字", { shareMode: "owner" }),
      {
        slug: "s",
        title: "同事的页面",
        rel: "shared",
        ownerEmail: "peer@corp.com",
      },
    ]);

    expect(screen.getByTestId("artifacts-rename-a")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("artifacts-tab-shared"));
    expect(screen.queryByTestId("artifacts-rename-s")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("artifacts-tab-mine"));
    openRename("a");
    const input = screen.getByTestId(
      "artifacts-rename-input-a",
    ) as HTMLInputElement;
    expect(input.value).toBe("旧名字");
    expect(screen.queryByTestId("artifacts-open-a")).not.toBeInTheDocument();
  });

  it("回车保存：文件名就地更新、提示「已重命名」，不重新拉列表", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);
    const listCalls = harness
      .sent()
      .filter((m) => m.command === "desktopArtifactsList").length;

    openRename("a");
    const input = screen.getByTestId("artifacts-rename-input-a");
    fireEvent.change(input, { target: { value: "  新名字  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    // 首尾空白被去掉。
    expect(screen.getByTestId("artifacts-open-a")).toHaveTextContent("新名字");
    expect(screen.getByTestId("artifacts-toast")).toHaveTextContent("已重命名");
    expect(
      screen.queryByTestId("artifacts-rename-input-a"),
    ).not.toBeInTheDocument();
    expect(
      harness.sent().filter((m) => m.command === "desktopArtifactsList").length,
    ).toBe(listCalls);
  });

  it("空名就地提示「名称不能为空」，输入框留着不退出", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);

    openRename("a");
    fireEvent.change(screen.getByTestId("artifacts-rename-input-a"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByTestId("artifacts-rename-input-a"), {
      key: "Enter",
    });

    expect(screen.getByTestId("artifacts-rename-error")).toHaveTextContent(
      "名称不能为空",
    );
    expect(screen.getByTestId("artifacts-rename-input-a")).toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-toast")).not.toBeInTheDocument();
  });

  it("超过 60 字拦下并提示上限，不写回列表", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);

    openRename("a");
    fireEvent.change(screen.getByTestId("artifacts-rename-input-a"), {
      target: { value: "长".repeat(61) },
    });
    fireEvent.keyDown(screen.getByTestId("artifacts-rename-input-a"), {
      key: "Enter",
    });

    expect(screen.getByTestId("artifacts-rename-error")).toHaveTextContent(
      "名称最多 60 个字",
    );
    expect(screen.getByTestId("artifacts-rename-input-a")).toBeInTheDocument();
  });

  it("Esc 取消：不保存、不回显改动、不出提示", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);

    openRename("a");
    const input = screen.getByTestId("artifacts-rename-input-a");
    fireEvent.change(input, { target: { value: "改了一半" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // Esc 关掉输入框会顺带触发一次 blur，不能把它当成「失焦保存」。
    fireEvent.blur(input);

    expect(screen.getByTestId("artifacts-open-a")).toHaveTextContent("旧名字");
    expect(screen.queryByTestId("artifacts-toast")).not.toBeInTheDocument();
  });

  it("原样回车（名字没改）：收起输入框，不写数据也不给提示", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);

    openRename("a");
    fireEvent.keyDown(screen.getByTestId("artifacts-rename-input-a"), {
      key: "Enter",
    });

    expect(screen.getByTestId("artifacts-open-a")).toHaveTextContent("旧名字");
    expect(
      screen.queryByTestId("artifacts-rename-input-a"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifacts-toast")).not.toBeInTheDocument();
  });

  it("失焦保存（接口未就绪前的本地写）", () => {
    const harness = renderPage();
    answerList(harness, [mine("a", "旧名字", { shareMode: "owner" })]);

    openRename("a");
    const input = screen.getByTestId("artifacts-rename-input-a");
    fireEvent.change(input, { target: { value: "失焦保存" } });
    fireEvent.blur(input);

    expect(screen.getByTestId("artifacts-open-a")).toHaveTextContent(
      "失焦保存",
    );
    expect(screen.getByTestId("artifacts-toast")).toHaveTextContent("已重命名");
  });
});
