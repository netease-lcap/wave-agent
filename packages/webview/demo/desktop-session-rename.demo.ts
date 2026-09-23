import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop 会话重命名截图（spec desktop-sessions.md「会话重命名（侧边栏行内
// 编辑）」）：行菜单（并排打开 / 重命名 / 删除会话）与行内输入态。共享 webview
// bundle 需先构建（node esbuild.config.mjs）。
const DIR = "/Users/dev/projects/nebula-platform";

test.describe("Desktop 会话重命名截图", () => {
  test("侧边栏行菜单与行内改名", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR,
      recentWorkdirs: [DIR],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR, [
      { sessionId: "s-rn-1", title: "重构支付服务，拆分下单与退款逻辑" },
      { sessionId: "s-rn-2", title: "为登录页面补充单元测试" },
      { sessionId: "s-rn-3", title: "排查压测下连接池耗尽的问题" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [
        MockDataGenerator.createUserMessage("帮我分析支付模块的代码结构"),
        MockDataGenerator.createAssistantMessage(
          "支付模块分成三层：`api`（对外契约）、`service`（编排与事务边界）、`gateway`（渠道适配）。核心的下单与退款流程都在 `service/payment-service.ts` 里，我先从它开始逐层展开。",
        ),
      ],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
      // 头部标题取当前会话（真宿主随快照一起下发）：否则图上头部显示「新对话」，
      // 与侧边栏正在改名的那个会话对不上。
      session: {
        id: "s-rn-2",
        sessionType: "main",
        workdir: DIR,
        lastActiveAt: Date.now(),
        latestTotalTokens: 8600,
        firstMessage: "为登录页面补充单元测试",
      },
    });
    await injector.endStreaming();

    // 1. 行菜单：悬停出现「更多」，菜单三项（并排打开 / 重命名 / 删除会话）
    const row = webviewPage.getByTestId("desktop-session-item-s-rn-2");
    await row.hover();
    await webviewPage.getByTestId("desktop-session-more-s-rn-2").click();
    await webviewPage.waitForSelector('[data-testid="desktop-session-menu"]');
    // 行的 hover tooltip（「可拖拽或 Cmd+点击 并排打开」）有 0.1s 淡出，指针移到
    // 「更多」上之后等它消失再截图，否则图上会在对话区留一层半透明的鬼影字。
    await webviewPage.waitForTimeout(200);
    await expect(
      webviewPage.getByTestId("desktop-session-menu-rename"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-rename-menu.webp",
    );

    // 2. 行内输入态：标题位被输入框就地顶掉（预填并全选原标题）
    await webviewPage.getByTestId("desktop-session-menu-rename").click();
    const input = webviewPage.getByTestId(
      "desktop-session-rename-input-s-rn-2",
    );
    await expect(input).toBeFocused();
    await input.fill("登录页单测：补齐边界用例");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-rename.webp",
    );
    // Esc 取消，保持截图流程无副作用（不改标题、不发请求）
    await webviewPage.keyboard.press("Escape");
  });
});
