import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Desktop interaction refinements (spec desktop-app.md 交互优化): screenshots
 * for the collapsible sidebar, file drag-and-drop upload overlay, and the
 * multi-tab preview pane. The shared webview bundle must be rebuilt first
 * (node esbuild.config.mjs) or these shots capture the old UI.
 */
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

/** Single-pane desktop layout with one conversation in progress. */
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
    MockDataGenerator.createAssistantMessage(
      "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
      "msg-a1",
    ),
  ]);
}

test.describe("Desktop interaction refinements", () => {
  test("collapsible sidebar: collapse to a header expand button", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();

    // Collapse via the sidebar header button: the tree unmounts entirely and
    // a lone expand button takes the chat header's leading slot.
    await webviewPage.getByTestId("desktop-sidebar-collapse").click();
    await expect(webviewPage.getByTestId("desktop-sidebar")).toHaveCount(0);
    await expect(
      webviewPage.getByTestId("desktop-sidebar-expand"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-sidebar-collapsed.webp",
    );

    // Expand restores the sidebar.
    await webviewPage.getByTestId("desktop-sidebar-expand").click();
    await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
  });

  test("file drag-and-drop upload overlay while hovering", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });
    await setupSinglePane(injector);

    // Drag events are attached only in the desktop host and only react to
    // file drags (dataTransfer "Files"); dispatch a real DragEvent carrying
    // a File on the chat container to raise the overlay.
    await webviewPage.evaluate(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([""], "hello.txt"));
      document.querySelector('[data-testid="chat-container"]')?.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
    });
    await expect(webviewPage.getByTestId("chat-drag-overlay")).toBeVisible();
    await expect(webviewPage.getByTestId("chat-drag-overlay")).toContainText(
      "释放以上传文件",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-drag-upload.webp",
    );
  });

  test("multi-tab preview: a second localhost link opens another tab", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1100, height: 680 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我做一个订单管理页面的原型，先跑起来看看效果",
        "msg-u1",
      ),
      MockDataGenerator.createAssistantMessage(
        "已用 Vite 创建原型并启动开发服务器：主列表在 [http://localhost:5173](http://localhost:5173)，登录页在 [http://localhost:5173/login](http://localhost:5173/login)。点击可在右侧分别预览。",
        "msg-a1",
      ),
    ]);

    // First localhost link → the preview pane opens with one tab.
    const firstLink = webviewPage.locator('a[href="http://localhost:5173"]');
    await expect(firstLink).toBeVisible();
    await firstLink.click();
    await expect(webviewPage.getByTestId("preview-pane")).toBeVisible();
    await expect(
      webviewPage.getByTestId("preview-tab-bar").locator(".preview-tab"),
    ).toHaveCount(1);

    // Second localhost link → a second tab, selected.
    const secondLink = webviewPage.locator(
      'a[href="http://localhost:5173/login"]',
    );
    await secondLink.click();
    await expect(
      webviewPage.getByTestId("preview-tab-bar").locator(".preview-tab"),
    ).toHaveCount(2);
    await expect(webviewPage.getByTestId("preview-tab-bar")).toContainText(
      "localhost:5173/login",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-preview-tabs.webp",
    );
  });
});
