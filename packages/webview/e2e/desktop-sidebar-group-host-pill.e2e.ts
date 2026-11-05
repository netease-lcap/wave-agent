import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// 分组头一行里「项目名 + 主机标签 pill」共用 170px（侧栏 260 − 侧栏内衬 24 −
// 组头内衬 16 − 文件夹/间隙/chevron 49）。pill 原上限 40%（≈98px）只给项目名留
// 71px，用户在 Windows（字形更宽）看到的是「wave-ag… + Ubuntu-24.04 (…」——
// 项目名被挤没（用户反馈 2026-11-05）。现在 pill 收在 30%（≈76px）：
// 项目名完整，pill 截断（全文在 title 与菜单里）。
const DIR = "/home/liuyiqi02/github/wave-agent";
const WSL_LABEL = "Ubuntu-24.04 (WSL)";

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

test.describe("Sidebar group header host pill vs project name", () => {
  test("keeps the project name whole and lets the host pill truncate", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1180, height: 760 });
    const injector = new MessageInjector(webviewPage);

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR,
      recentWorkdirs: [DIR],
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [
        {
          host: "wsl:Ubuntu-24.04",
          // spec docs/specs/desktop/desktop-wsl.md 场景 16/17：分组标签显示
          // 「Ubuntu (WSL)」而不是内部主机标识。
          hostLabel: WSL_LABEL,
          workdir: DIR,
          sessions: [treeSession("s1", "clone lewis617 的 claude-code 仓库")],
        },
        {
          host: "local",
          workdir: "/home/liuyiqi02/github/wave-agent-docs",
          sessions: [treeSession("s2", "本地分组")],
        },
      ],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    const headers = webviewPage.locator(".desktop-session-group-header");
    await expect(headers).toHaveCount(2);

    // 1. 项目名不被截断：文字宽度没有超过盒子（否则会出现省略号）。
    const name = headers.first().locator(".desktop-session-group-name");
    const nameMetrics = await name.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(nameMetrics.scroll).toBeLessThanOrEqual(nameMetrics.client);
    await expect(name).toHaveText("wave-agent");

    // 2. 让位的是 pill：它被收在上限内，文字溢出（title 有全文）。
    const pill = headers.first().locator(".desktop-session-group-host");
    await expect(pill).toHaveCount(1);
    await expect(pill).toHaveAttribute("title", WSL_LABEL);
    const pillMetrics = await pill.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(pillMetrics.client).toBeLessThanOrEqual(80);
    expect(pillMetrics.scroll).toBeGreaterThan(pillMetrics.client);

    // 3. 本地分组照旧不带 pill（只有远程/WSL 分组才有）。
    await expect(
      headers.nth(1).locator(".desktop-session-group-host"),
    ).toHaveCount(0);
  });
});
