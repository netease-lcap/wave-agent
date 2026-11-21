/**
 * 侧栏会话**正文**搜索（spec desktop/desktop-sessions.md「侧栏会话内容搜索」）在
 * 真浏览器里的两段式布局与「点命中就落到那条消息」。
 *
 * 迁移自 `e2e/desktop-sidebar-content-search.e2e.ts`。扫盘由宿主负责
 * （`packages/desktop/tests/sessionContentSearch.test.ts`），这里只验界面这一层——
 * 两段之间的分隔、片段的命中高亮、以及点击之后的落点。jsdom 无布局，第二段的
 * 「在树下面而不是混进分组」只能在真引擎里量。
 *
 * 原文用 `window.__contentSearchMatches` 让 mock 宿主**同步**回包（`__deferContentSearch`
 * 那条路只是把同一份回包扣住）。这里统一改成「等请求真发出去 → 用这条请求自己的
 * requestId/query 回包」，与真宿主（以及侧栏按 requestId 认领的契约）一致：迟到的
 * 应答本来就会被丢掉，测试不该绕开这件事。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  lastSent,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

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

type Sidebar = ReturnType<typeof renderDesktopApp>;

/**
 * 起侧栏：工作目录（这一步才挂上分屏里的 ChatApp）→ 初值 → 两组会话。
 * 每条命令各自 `act()`，见 `desktopHarness` 文件头的时序说明。
 */
function seedSidebar(): Sidebar {
  const result = renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
    host: "local",
    hosts: ["local"],
  });
  sendCommand("setInitialState", initialState);
  sendCommand("desktopSessionTree", {
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
  return result;
}

const searchBox = () =>
  screen.getByTestId("desktop-session-search") as HTMLInputElement;

/** 发给宿主的正文搜索请求（按发送顺序）。 */
const contentSearchRequests = (vscode: Sidebar["vscode"]) =>
  sentCommands(vscode).filter(
    (message) => message.command === "desktopSearchSessionContents",
  );

type Reply = { matches: unknown[]; failed?: boolean; truncated?: boolean };

/**
 * 应答最近一条正文搜索请求：等它真的发出去（防抖之后），再用它自己的
 * requestId / query 回包——真宿主就是这么原样带回这两项的，少了任一项 webview
 * 都会丢掉这份应答。
 */
async function answerContentSearch(vscode: Sidebar["vscode"], reply: Reply) {
  await expect
    .poll(() => contentSearchRequests(vscode).length, { timeout: 4000 })
    .toBeGreaterThan(0);
  const requests = contentSearchRequests(vscode);
  const request = requests[requests.length - 1];
  sendCommand("desktopSessionContentMatches", {
    requestId: request.requestId,
    query: request.query,
    matches: reply.matches,
    truncated: reply.truncated === true,
    failed: reply.failed === true,
  });
  return request;
}

const el = (selector: string) =>
  document.querySelector<HTMLElement>(selector) as HTMLElement | null;

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("侧栏会话内容搜索", () => {
  it("输入关键词：树在上、「内容命中」平铺在下，命中词有高亮", async () => {
    await page.viewport(400, 600);
    const { vscode } = seedSidebar();

    await userEvent.fill(searchBox(), "连接池");
    await answerContentSearch(vscode, {
      matches: [
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
      ],
    });

    await expect
      .poll(() => isVisible('[data-testid="desktop-content-hits"]'))
      .toBe(true);
    // 命中的会话不混进目录分组：树里按标题过滤后一条都不剩。
    expect(
      document.querySelectorAll('[data-testid="desktop-session-item-s2"]')
        .length,
    ).toBe(0);
    const hits = el('[data-testid="desktop-content-hits"]')!;
    // 每行含会话标题、片段与所属目录名。
    expect(hits.textContent ?? "").toContain("发版清单");
    expect(hits.textContent ?? "").toContain("wave-agent");
    expect(hits.querySelectorAll(".desktop-content-hit-mark").length).toBe(2);

    // 两段之间的几何：命中区必须落在树的滚动区里、在树内容之后，且有分隔线。
    const tree = el('[data-testid="desktop-session-tree"]')!;
    const section = el('[data-testid="desktop-content-hits"]')!;
    expect(tree.contains(section)).toBe(true);
    expect(section.getBoundingClientRect().top).toBeGreaterThan(
      tree.getBoundingClientRect().top,
    );
    expect(getComputedStyle(section).borderTopWidth).toBe("1px");

    // 清空关键词 → 整段消失。
    await userEvent.fill(searchBox(), "");
    await expect
      .poll(
        () =>
          document.querySelectorAll('[data-testid="desktop-content-hits"]')
            .length,
      )
      .toBe(0);
  });

  it("点命中项：进入该会话并就地打开查找条落在这一处", async () => {
    await page.viewport(400, 600);
    const { vscode } = seedSidebar();

    // 会话正文：两处命中，第 2 处正是片段里的 hitIndex。
    sendCommand("updateCurrentSession", {
      session: { id: "s1", firstMessage: "连接池" },
    });
    sendCommand("updateMessages", {
      messages: [
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
            {
              type: "text",
              content: "检查发现连接池耗尽，另有一处连接池上限",
            },
          ],
        },
      ],
    });

    await userEvent.fill(searchBox(), "连接池");
    await answerContentSearch(vscode, {
      matches: [
        {
          sessionId: "s1",
          hitCount: 2,
          snippets: [
            { text: "检查发现连接池耗尽", offset: 4, length: 3, hitIndex: 1 },
          ],
        },
      ],
    });

    await userEvent.click(screen.getByTestId("desktop-content-hit-s1-1"));

    // 进入该会话（宿主侧命令）。
    await expect
      .poll(() => lastSent(vscode, "desktopSelectSession"))
      .toMatchObject({ workdir: DIR_A, sessionId: "s1" });
    const selects = sentCommands(vscode).filter(
      (message) => message.command === "desktopSelectSession",
    );
    expect(selects).toEqual([
      { command: "desktopSelectSession", workdir: DIR_A, sessionId: "s1" },
    ]);

    // 查找条以该关键词打开并落在第 2 处（hitIndex 0 起）；两段正文共 3 处。
    await expect
      .poll(
        () =>
          document.querySelector<HTMLInputElement>(
            '[data-testid="transcript-find-input"]',
          )?.value ?? null,
      )
      .toBe("连接池");
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="transcript-find-count"]')
            ?.textContent ?? "",
      )
      .toBe("2/3");
    // 当前命中就地画成 mark（虚拟列表里这一行是挂载的）。落在第 2 条消息上，
    // 列表要先滚过去才挂得上，所以这里是重试查询（等价原文的 `toHaveCount`）。
    await expect
      .poll(
        () =>
          document.querySelectorAll("mark.transcript-find-hit--current").length,
      )
      .toBe(1);
  });

  it("搜索中与失败两态各自给话，失败不静默成「无结果」", async () => {
    await page.viewport(400, 600);
    const { vscode } = seedSidebar();

    await userEvent.fill(searchBox(), "连接池");
    await expect
      .poll(
        () =>
          el('[data-testid="desktop-content-hits-searching"]')?.textContent ??
          "",
      )
      .toContain("正在搜索会话内容");

    // 请求是防抖后才发出的：先等它真的发出去，再回一份「失败」的应答。
    await answerContentSearch(vscode, { matches: [], failed: true });
    await expect
      .poll(
        () =>
          el('[data-testid="desktop-content-hits-error"]')?.textContent ?? "",
      )
      .toContain("内容搜索暂不可用");
    expect(
      document.querySelectorAll('[data-testid="desktop-content-hits-empty"]')
        .length,
    ).toBe(0);

    // 重试会再发一笔查询（旧的 requestId 已作废）。
    const before = contentSearchRequests(vscode).length;
    await userEvent.click(screen.getByTestId("desktop-content-hits-retry"));
    const fresh = contentSearchRequests(vscode).slice(before);
    expect(fresh).toHaveLength(1);
  });
});
