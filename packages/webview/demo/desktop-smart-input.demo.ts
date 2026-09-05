import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop smart-input screenshots (共享 webview 输入能力，捕获于桌面布局中):
// slash command menu, @-mentions inline tags, bang (quick terminal) command block
// and the /btw side panel — all captured inside the desktop layout (sidebar +
// session tree). The shared webview bundle must be rebuilt first
// (node esbuild.config.mjs).
const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

/** Single-pane desktop layout, new-session state. */
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(injector, DIR_A, [
    { sessionId: "s-si-1", title: "分析支付服务并发问题", running: true },
    {
      sessionId: "s-si-2",
      title: "为乐观锁中间件补测试",
      hasWorktree: true,
    },
    {
      sessionId: "s-si-3",
      title: "梳理登录页样式适配",
      waitingConfirmation: true,
    },
  ]);
  await injector.simulateExtensionMessage("setInitialState", initialState);
}

test.describe("Desktop smart-input screenshots", () => {
  test("1) plus menu (image/file upload)", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    // Open the "+" (添加) menu in the input toolbar.
    await webviewPage.getByRole("button", { name: "添加" }).click();
    const menu = webviewPage.locator(".plus-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("上传文件")).toBeVisible();
    await expect(menu.getByText("历史提示词")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-plus-menu.webp",
    );
  });

  test("2) slash command menu", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/");
    await webviewPage.waitForFunction(() => {
      const messages = window.getTestMessages ? window.getTestMessages() : [];
      return messages.some((m) => m.command === "requestSlashCommands");
    });
    await injector.simulateExtensionMessage("slashCommandsResponse", {
      commands: [
        { id: "explain", name: "explain", description: "解释选中代码" },
        { id: "fix", name: "fix", description: "修复代码问题" },
        { id: "review", name: "review", description: "审查代码变更" },
        { id: "model", name: "model", description: "切换 AI 模型" },
        // 桌面端 /clear 已移除（2026-09-05），popup 不再含 clear 条目。
      ],
    });
    await webviewPage.waitForSelector(".slash-command-item", {
      state: "visible",
    });
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-slash-commands.webp",
    );
  });

  test("3) @-mention inline tags", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    // Type "@" → the webview asks the host for file suggestions.
    await webviewPage.focus('[data-testid="message-input"]');
    const countBefore = await injector.getMessageCount();
    await webviewPage.keyboard.type("@");
    await injector.waitForFileSuggestionRequest(2000, countBefore);

    // Capture the actual requestId from the message log.
    const latestRequestId = await webviewPage.evaluate(() => {
      const messages = window.getTestMessages ? window.getTestMessages() : [];
      const reqs = messages.filter(
        (m) => m.command === "requestFileSuggestions",
      );
      return reqs.length > 0 ? reqs[reqs.length - 1].requestId : "fallback-id";
    });

    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      requestId: latestRequestId,
      filterText: "",
      suggestions: [
        {
          path: `${DIR_A}/src/pages/login.tsx`,
          relativePath: "src/pages/login.tsx",
          name: "login.tsx",
          icon: "codicon-file-code",
          isDirectory: false,
        },
        {
          path: `${DIR_A}/src/styles/login.css`,
          relativePath: "src/styles/login.css",
          name: "login.css",
          icon: "codicon-file-code",
          isDirectory: false,
        },
      ],
    });
    await webviewPage.waitForSelector(".suggestion-item", { state: "visible" });
    await webviewPage.keyboard.press("ArrowDown");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.keyboard.type(" 帮我检查这里的样式对齐问题");

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-inline-mentions.webp",
    );
  });

  test("4) bang quick terminal command block", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    await injector.updateMessages([
      MockDataGenerator.createBangMessage(
        "kubectl get pods -n payment",
        "NAME                            READY   STATUS    RESTARTS   AGE\npayment-service-7f4d           1/1     Running   0          2d\npayment-worker-9c2a            1/1     Running   0          2d\npayment-scheduler-5x8b         1/1     Running   0          5h",
        false,
        0,
      ),
    ]);
    await webviewPage.waitForSelector(".bash-command-unified", {
      state: "visible",
    });
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-bang-command.webp",
    );
  });

  test("5) /btw side panel", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我看下 PaymentService 的并发问题"),
      MockDataGenerator.createAssistantMessage(
        "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件，建议改用乐观锁...",
      ),
    ]);
    await injector.endStreaming();

    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/btw 乐观锁的实现思路是什么？");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.waitForFunction(() => {
      const messages = window.getTestMessages ? window.getTestMessages() : [];
      return messages.some((m) => m.command === "askBtw");
    });
    await injector.simulateExtensionMessage("btwResponse", {
      question: "乐观锁的实现思路是什么？",
      answer:
        "**乐观锁**的核心思路是：读取时不加锁，更新时通过版本号（`version`）或时间戳校验数据是否被他人修改。\n\n- 读取数据并记录版本号\n- 更新时 `SET version = version + 1 WHERE version = 旧值`\n- 受影响行数为 0 时说明已被修改，重试或放弃\n\n相比悲观锁，乐观锁在低冲突场景下吞吐更高，适合读多写少的业务。",
    });
    await expect(
      webviewPage.locator('[data-testid="btw-panel-answer"]'),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-btw-panel.webp",
    );
  });
});
