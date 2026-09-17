import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";
import { type SessionMetadata } from "wave-agent-sdk";

// Desktop `/resume` screenshot: the in-conversation session switcher opened from
// the input box. Unlike the sidebar tree (sessions this app created) the desktop
// picker shows the host's on-disk scan of the current conversation's host — so
// CLI-created conversations and other projects are reachable — and each row
// carries its project path. The shared webview bundle must be rebuilt first
// (node esbuild.config.mjs).
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/nebula-platform";

test.describe("Desktop /resume screenshots", () => {
  test("in-conversation session switcher", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B],
      host: "local",
      hosts: ["local"],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-rs-1", title: "重构支付服务，拆分下单与退款逻辑" },
      { sessionId: "s-rs-2", title: "为登录页面补充单元测试" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [
        MockDataGenerator.createUserMessage(
          "为什么分布式事务里悲观锁在高并发下性能会下降？",
        ),
        MockDataGenerator.createAssistantMessage(
          "核心原因在于**锁的持有时间与等待队列**：悲观锁（如 `SELECT ... FOR UPDATE`）在提交前一直持有锁，高并发下请求逐个排队，事务吞吐直线下降，同时数据库连接被长时间占用，容易出现连接池耗尽与死锁。",
        ),
      ],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });
    await injector.endStreaming();

    // Send `/resume`. The slash-command popup stays unpopulated here (the mock
    // host never answers requestSlashCommands), so Enter takes the normal submit
    // path instead of selecting the highlighted command.
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/resume");
    await webviewPage.keyboard.press("Enter");

    // The host scans the current conversation host's session directory and
    // answers with the correlated requestId.
    const requestId = await webviewPage.evaluate(async () => {
      const poll = () =>
        new Promise<string>((resolve) => {
          const check = () => {
            const messages = window.getTestMessages
              ? window.getTestMessages()
              : [];
            const reqs = messages.filter(
              (m) => m.command === "desktopListResumeSessions",
            );
            if (reqs.length > 0)
              resolve(String(reqs[reqs.length - 1].requestId));
            else setTimeout(check, 50);
          };
          check();
        });
      return await poll();
    });

    const now = Date.now();
    const sessions: SessionMetadata[] = [
      {
        id: "s-rs-1",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: new Date(now - 1000 * 60 * 90),
        lastActiveAt: new Date(now - 1000 * 60 * 12),
        latestTotalTokens: 32800,
        firstMessage: "重构支付服务，拆分下单与退款逻辑",
      },
      {
        id: "s-rs-2",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: new Date(now - 1000 * 60 * 60 * 26),
        lastActiveAt: new Date(now - 1000 * 60 * 60 * 5),
        latestTotalTokens: 8600,
        firstMessage: "为登录页面补充单元测试",
      },
      {
        id: "s-rs-3",
        sessionType: "main",
        workdir: DIR_B,
        createdAt: new Date(now - 1000 * 60 * 60 * 50),
        lastActiveAt: new Date(now - 1000 * 60 * 60 * 30),
        latestTotalTokens: 15420,
        firstMessage: "排查压测下连接池耗尽的问题",
      },
      {
        id: "s-rs-4",
        sessionType: "main",
        workdir: DIR_B,
        createdAt: new Date(now - 1000 * 60 * 60 * 72),
        lastActiveAt: new Date(now - 1000 * 60 * 60 * 48),
        latestTotalTokens: 24100,
        firstMessage: "帮我分析支付模块的代码结构",
      },
    ];

    await injector.simulateExtensionMessage("desktopResumeSessions", {
      requestId,
      sessions,
    });

    await webviewPage.waitForSelector('[data-testid="resume-session-popup"]');
    // Rows keep the host's own project path, so same-titled sessions from
    // different projects stay distinguishable.
    await expect(
      webviewPage.getByTestId("session-list-item-s-rs-3"),
    ).toContainText(DIR_B);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-resume-sessions.webp",
    );
  });
});
