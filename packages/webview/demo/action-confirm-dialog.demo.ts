import {
  test as webviewTest,
  expect,
} from "../e2e/utils/webviewTestHarness.js";
import { test as desktopTest } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { UIStateVerifier } from "../e2e/utils/uiStateVerifier.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

webviewTest.describe("Product Spec: Action Confirm Dialog (Rewind)", () => {
  webviewTest(
    "should capture the rewind confirmation dialog",
    async ({ webviewPage }) => {
      const injector = new MessageInjector(webviewPage);
      const ui = new UIStateVerifier(webviewPage);

      const messages = [
        MockDataGenerator.createUserMessage(
          "帮我分析 PaymentService 的并发问题，看看有没有竞态条件",
        ),
        MockDataGenerator.createAssistantMessage(
          "我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...",
        ),
        MockDataGenerator.createUserMessage(
          "好的，请为乐观锁实现编写单元测试，覆盖并发冲突场景",
        ),
      ];
      await injector.updateMessages(messages);
      await injector.endStreaming();

      // Hover the first user message and click its rewind button
      const firstUserMessage = ui.userMessages.first();
      await firstUserMessage.hover();
      const rewindBtn = firstUserMessage.locator(".message-action-btn");
      await expect(rewindBtn).toBeVisible();
      await rewindBtn.click();

      // The in-webview confirmation dialog appears centered; no command sent yet
      const overlay = webviewPage.getByTestId("confirm-dialog-overlay");
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText("确定要回滚到此消息吗？");
      await expect(overlay).toContainText(
        "这将删除之后的所有消息并撤销相关的文件更改。",
      );

      await screenshotWebp(
        webviewPage,
        "../../docs/public/screenshots/spec-confirm-rewind.webp",
      );
    },
  );
});

desktopTest.describe(
  "Product Spec: Action Confirm Dialog (Delete Session)",
  () => {
    desktopTest(
      "should capture the delete-session confirmation dialog",
      async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await webviewPage.setViewportSize({ width: 960, height: 640 });

        await injector.simulateExtensionMessage("setInitialState", {
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
        });
        await injector.simulateExtensionMessage("desktopWorkdirState", {
          workdir: "/Users/dev/projects/wave-agent",
          recentWorkdirs: ["/Users/dev/projects/wave-agent"],
        });
        await injector.simulateExtensionMessage("desktopSessionTree", {
          groups: [
            {
              workdir: "/Users/dev/projects/wave-agent",
              sessions: [
                {
                  sessionId: "sess-a1",
                  title: "帮我修复登录页的样式问题",
                  lastActiveAt: new Date("2026-07-27T10:12:00Z").getTime(),
                  hasWorktree: true,
                },
                {
                  sessionId: "sess-a2",
                  title: "给 bashTool 增加超时参数",
                  lastActiveAt: new Date("2026-07-26T09:40:00Z").getTime(),
                  hasWorktree: false,
                },
              ],
            },
          ],
        });

        // Hover the session item to reveal its 更多 button, open the row menu
        // and pick 删除会话
        const item = webviewPage.getByTestId("desktop-session-item-sess-a1");
        await item.hover();
        await webviewPage.getByTestId("desktop-session-more-sess-a1").click();
        await webviewPage.getByTestId("desktop-session-menu-delete").click();

        // Worktree sessions also warn about the worktree dir + temp branch
        const overlay = webviewPage.getByTestId("confirm-dialog-overlay");
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText(
          "确定删除会话「帮我修复登录页的样式问题」？",
        );
        await expect(overlay).toContainText(
          "worktree 目录与临时分支将一并删除",
        );

        await screenshotWebp(
          webviewPage,
          "../../docs/public/screenshots/desktop-confirm-delete.webp",
        );
      },
    );
  },
);
