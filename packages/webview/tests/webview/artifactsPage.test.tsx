import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
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

vi.mock("../../src/styles/ArtifactsPage.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));

const SERVER_URL = "https://codechat.test";

interface Harness {
  vscode: { postMessage: ReturnType<typeof vi.fn> };
  onNewFromTemplate: ReturnType<typeof vi.fn>;
  sent: () => Array<Record<string, unknown>>;
  reply: (message: Record<string, unknown>) => void;
}

function renderPage(
  options: {
    categories?: ArtifactCategory[];
    assignments?: Record<string, string>;
  } = {},
): Harness {
  const vscode = { postMessage: vi.fn() };
  const onNewFromTemplate = vi.fn();
  render(
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

  return { vscode, onNewFromTemplate, sent, reply };
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
});

describe("创作集 · 分类", () => {
  it("自定义视图新增分类 → 写本机存储并自动选中（空态）", () => {
    const harness = renderPage();
    fireEvent.click(screen.getByTestId("artifacts-view-custom"));
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
    fireEvent.click(screen.getByTestId("artifacts-view-custom"));

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

  it("批量归类到某分类后就地刷新列表", () => {
    const harness = renderPage({
      categories: [{ id: "cat-1", name: "运营" }] as ArtifactCategory[],
    });
    answerList(harness, [
      mine("a", "页面 A", { shareMode: "owner" }),
      mine("b", "页面 B", { shareMode: "owner" }),
    ]);
    fireEvent.click(screen.getByTestId("artifacts-view-custom"));

    fireEvent.click(screen.getByLabelText("选择 页面 A"));
    expect(screen.getByTestId("artifacts-batch")).toHaveTextContent(
      "已选 1 项",
    );

    fireEvent.click(screen.getByTestId("artifacts-batch-assign"));
    fireEvent.click(screen.getByTestId("artifacts-batch-cat-1"));

    const save = lastSent(harness, "desktopArtifactCategoriesSave");
    expect(save?.assignments).toEqual({ a: "cat-1" });
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
