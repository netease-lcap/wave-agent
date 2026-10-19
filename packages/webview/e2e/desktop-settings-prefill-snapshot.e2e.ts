import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const DIR_A = "/Users/dev/projects/wave-agent";

/**
 * 线上缺陷回归：桌面端 设置 →「钩子」→「+ 新增钩子」后，会话输入框是空的；
 * 切走会话再切回来，预填提示词才出现。
 *
 * 根因（时序）：关掉设置页后 pane 行重挂载，宿主 `pushInitialState` 按
 * `authStatusResponse` → `setInitialState` 的顺序回放。前者就把 `initialized`
 * 置真、让输入区挂载，于是设置页的预填请求在这一步被写进输入框；紧跟其后的
 * `setInitialState` 又把 `inputContent`（宿主此刻只有空草稿）作为受控值灌回
 * MessageInput，`innerText` 被整段置空 —— 预填文本在首屏被抹掉，只剩宿主的草稿
 * 存储，所以切走再切回（重新回放快照）才看得见。
 *
 * 修复 = 预填写在「本条 pane 的权威快照落地」之后（而不是 authStatus 一到就写），
 * 并在输入框/快照都未就绪时保留请求、就绪后重放。
 */
test.describe("设置页预填提示词 × 宿主快照到达时序（desktop）", () => {
  async function mountPane(webviewPage: Page) {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    // pane 首屏：认证状态到了，但这条 pane 的权威快照还没落地。
    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });
    await expect(webviewPage.getByTestId("message-input")).toBeVisible();
    return injector;
  }

  async function openHooksAndCreate(webviewPage: Page) {
    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await input.focus();
    await webviewPage.keyboard.type("/hooks");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.getByRole("button", { name: /新增钩子/ }).click();
  }

  /**
   * 等两帧：React 的 passive effect（预填写入就在这里）在渲染后的调度任务里跑，
   * 真机上两条宿主消息之间必然隔了至少一帧，所以复现必须在两条消息之间让出执行权
   * ——否则两次 evaluate 可能在 effect 之前连发，把竞态窗口错过去。
   */
  async function nextFrame(webviewPage: Page) {
    await webviewPage.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }

  test("快照落地后预填提示词必须在首屏（不被 setInitialState 冲掉）", async ({
    webviewPage,
  }) => {
    const injector = await mountPane(webviewPage);
    await openHooksAndCreate(webviewPage);

    // 关设置页 → pane 行重挂载 → 宿主真实回放顺序
    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });
    await nextFrame(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [MockDataGenerator.createUserMessage("之前的问题")],
      tasks: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      inputContent: "",
      permissionMode: "default",
    });

    await expect(webviewPage.getByTestId("message-input")).toContainText(
      "用户级钩子",
    );
  });

  test("认证状态到达但快照未落地时不得先写草案（写入会被快照重置）", async ({
    webviewPage,
  }) => {
    const injector = await mountPane(webviewPage);
    await openHooksAndCreate(webviewPage);

    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });
    // 此刻输入框已挂载但 pane 快照未到 —— 这时写进去的草案会被紧随其后的
    // setInitialState 清空，所以应当保持 pending、等快照到了再写。
    const input = webviewPage.getByTestId("message-input");
    await expect(input).toBeVisible();
    await expect(input).not.toContainText("用户级钩子");
  });
});
