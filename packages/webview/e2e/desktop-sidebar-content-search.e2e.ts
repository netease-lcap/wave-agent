import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * 侧栏会话**正文**搜索（spec desktop/desktop-sessions.md「侧栏会话内容搜索」）在
 * 真实浏览器里的两段式布局与「点命中就落到那条消息」。
 *
 * 扫盘由宿主负责（`packages/desktop/tests/sessionContentSearch.test.ts`），这里用
 * harness 的 mock 回包（`window.__contentSearchMatches`）只验界面这一层——两段
 * 之间的分隔、片段的命中高亮、以及点击之后的落点。jsdom 无布局，第二段的
 * 「在树下面而不是混进分组」只能在真引擎里量。
 */

declare global {
  interface Window {
    /** mock 宿主回给 `desktopSearchSessionContents` 的命中（默认空）。 */
    __contentSearchMatches?: unknown[];
    __contentSearchFailed?: boolean;
    __contentSearchTruncated?: boolean;
    /** 扣住应答，用 `__flushContentSearch()` 放行（观察「搜索中」用）。 */
    __deferContentSearch?: boolean;
    __flushContentSearch?: () => void;
  }
}

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

const seedSidebar = async (page: import("@playwright/test").Page) => {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
    host: "local",
    hosts: ["local"],
  });
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: DIR_A,
        sessions: [
          treeSession("s1", "连接池排查"),
          treeSession("s2", "发版清单"),
        ],
      },
      {
        host: "local",
        workdir: DIR_B,
        sessions: [treeSession("s3", "订单服务重构")],
      },
    ],
  });
  await page.waitForSelector('[data-testid="desktop-session-tree"]');
};

test.describe("侧栏会话内容搜索", () => {
  test.beforeEach(async ({ webviewPage: page }) => {
    await seedSidebar(page);
  });

  test("输入关键词：树在上、「内容命中」平铺在下，命中词有高亮", async ({
    webviewPage: page,
  }) => {
    await page.evaluate(() => {
      window.__contentSearchMatches = [
        {
          sessionId: "s2",
          hitCount: 2,
          snippets: [
            {
              text: "发版前先确认连接池上限",
              offset: 7,
              length: 3,
              hitIndex: 0,
            },
            {
              text: "连接池配置写进了发版清单",
              offset: 0,
              length: 3,
              hitIndex: 1,
            },
          ],
        },
      ];
    });

    await page.getByTestId("desktop-session-search").fill("连接池");

    const hits = page.getByTestId("desktop-content-hits");
    await expect(hits).toBeVisible();
    // 命中的会话不混进目录分组：树里按标题过滤后一条都不剩。
    await expect(page.getByTestId("desktop-session-item-s2")).toHaveCount(0);
    // 每行含会话标题、片段与所属目录名。
    await expect(hits).toContainText("发版清单");
    await expect(hits).toContainText("wave-agent");
    await expect(hits.locator(".desktop-content-hit-mark")).toHaveCount(2);

    // 两段之间的几何：命中区必须落在树的滚动区里、在树内容之后，且有分隔线。
    const geometry = await page.evaluate(() => {
      const tree = document.querySelector(
        '[data-testid="desktop-session-tree"]',
      ) as HTMLElement;
      const section = document.querySelector(
        '[data-testid="desktop-content-hits"]',
      ) as HTMLElement;
      return {
        sectionInsideTree: tree.contains(section),
        sectionTop: section.getBoundingClientRect().top,
        treeTop: tree.getBoundingClientRect().top,
        borderTop: getComputedStyle(section).borderTopWidth,
      };
    });
    expect(geometry.sectionInsideTree).toBe(true);
    expect(geometry.sectionTop).toBeGreaterThan(geometry.treeTop);
    expect(geometry.borderTop).toBe("1px");

    // 清空关键词 → 整段消失。
    await page.getByTestId("desktop-session-search").fill("");
    await expect(page.getByTestId("desktop-content-hits")).toHaveCount(0);
  });

  test("点命中项：进入该会话并就地打开查找条落在这一处", async ({
    webviewPage: page,
  }) => {
    const injector = new MessageInjector(page);
    await page.evaluate(() => {
      window.clearTestMessages();
      window.__contentSearchMatches = [
        {
          sessionId: "s1",
          hitCount: 2,
          snippets: [
            { text: "检查发现连接池耗尽", offset: 4, length: 3, hitIndex: 1 },
          ],
        },
      ];
      // 会话正文：两处命中，第 2 处正是片段里的 hitIndex。
    });
    await injector.simulateExtensionMessage("updateCurrentSession", {
      session: { id: "s1", firstMessage: "连接池" },
    });
    await injector.updateMessages([
      {
        id: "m1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "先看连接池指标" }],
      },
      {
        id: "m2",
        role: "assistant",
        timestamp: "2026-01-01T00:00:01.000Z",
        blocks: [
          { type: "text", content: "检查发现连接池耗尽，另有一处连接池上限" },
        ],
      },
    ] as unknown as Parameters<typeof injector.updateMessages>[0]);

    await page.getByTestId("desktop-session-search").fill("连接池");
    await page.getByTestId("desktop-content-hit-s1-1").click();

    // 进入该会话（宿主侧命令）。
    const selected = await page.evaluate(() =>
      window
        .getTestMessages()
        .filter(
          (m: { command?: string }) => m.command === "desktopSelectSession",
        ),
    );
    expect(selected).toEqual([
      expect.objectContaining({ workdir: DIR_A, sessionId: "s1" }),
    ]);

    // 查找条以该关键词打开并落在第 2 处（hitIndex 0 起）；两段正文共 3 处。
    await expect(page.getByTestId("transcript-find-input")).toHaveValue(
      "连接池",
    );
    await expect(page.getByTestId("transcript-find-count")).toHaveText("2/3");
    // 当前命中就地画成 mark（虚拟列表里这一行是挂载的）。
    await expect(page.locator("mark.transcript-find-hit--current")).toHaveCount(
      1,
    );
  });

  test("搜索中与失败两态各自给话，失败不静默成「无结果」", async ({
    webviewPage: page,
  }) => {
    await page.evaluate(() => {
      window.__deferContentSearch = true;
    });

    await page.getByTestId("desktop-session-search").fill("连接池");
    await expect(
      page.getByTestId("desktop-content-hits-searching"),
    ).toContainText("正在搜索会话内容");

    // 请求是防抖后才发出的：先等它真的发出去，再放行被扣住的那个应答。
    await page.waitForFunction(() =>
      window
        .getTestMessages()
        .some(
          (m: { command?: string }) =>
            m.command === "desktopSearchSessionContents",
        ),
    );
    await page.evaluate(() => {
      window.__contentSearchFailed = true;
      window.__contentSearchMatches = [];
      window.__flushContentSearch?.();
    });
    await expect(page.getByTestId("desktop-content-hits-error")).toContainText(
      "内容搜索暂不可用",
    );
    await expect(page.getByTestId("desktop-content-hits-empty")).toHaveCount(0);

    // 重试会再发一笔查询（旧的 requestId 已作废）。
    await page.evaluate(() => {
      window.clearTestMessages();
      window.__contentSearchFailed = false;
      window.__deferContentSearch = false;
    });
    await page.getByTestId("desktop-content-hits-retry").click();
    const requests = await page.evaluate(() =>
      window
        .getTestMessages()
        .filter(
          (m: { command?: string }) =>
            m.command === "desktopSearchSessionContents",
        ),
    );
    expect(requests).toHaveLength(1);
  });
});
