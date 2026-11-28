import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import type { Message } from "wave-agent-sdk";

const tallText = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `第 ${i} 行长文本内容`).join("\n");

/** 撑高的一屏多：20 条长助手消息足够把 400x600 的视口顶出 800px 以上。 */
const tallMessages: Message[] = [];
for (let i = 0; i < 20; i++) {
  tallMessages.push(
    MockDataGenerator.createUserMessage(`问题 ${i}`, `u-${i}`),
    MockDataGenerator.createAssistantMessage(tallText(12), `a-${i}`),
  );
}

/** 内容压回一屏之内：一条短消息，滚动量归零。 */
const shortMessages: Message[] = [
  MockDataGenerator.createUserMessage("问题", "u-short"),
  MockDataGenerator.createAssistantMessage("答复", "a-short"),
];

/**
 * 「回到最新」入口挂在**输入框上方**这条线上，与内容多高无关（spec
 * ui/message-rendering-system.md：离开底部时的「回到最新」入口）。
 *
 * 这条断言只能写在 e2e：单测（vitest browser）默认不加载 CSS 文件，`bottom: 100%`
 * 与 `.jump-to-bottom-anchor` 的定位在那里量不到 —— 那边锁的是「层不在消息流里」
 * 这个结构（见 tests/webview/jumpToBottom.test.tsx），这里锁的是它落在哪儿。
 *
 * 旧实现的残影就出在这条线上：层 sticky 在正文列里，内容一矮它落到内容末尾，
 * 淡出的 180ms 里就压在刚收起的折叠卡上（用户报障「收起时按钮跑到折叠组件上」）。
 */
test.describe("「回到最新」入口的位置", () => {
  test("内容压回一屏内时，按钮仍贴在输入框上方", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });
    await injector.updateMessages(tallMessages);
    await webviewPage.waitForTimeout(400);

    // 滚到顶：离末尾很远 ⇒ 入口出现。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = 0;
      c.dispatchEvent(new Event("scroll"));
    });
    const layer = webviewPage.locator('[data-testid="jump-to-bottom-layer"]');
    await expect(layer).toHaveAttribute("data-visible", "true");

    // 内容压回一屏之内（等价于聚焦视图收起一轮折叠卡：账本一变，距离归零）。
    await injector.updateMessages(shortMessages);
    await webviewPage.waitForTimeout(50);

    const geom = await webviewPage.evaluate(() => {
      const container = document.getElementById("messagesContainer")!;
      const layerEl = document.querySelector(
        '[data-testid="jump-to-bottom-layer"]',
      )!;
      const button = document.querySelector('[data-testid="jump-to-bottom"]')!;
      return {
        containerBottom: container.getBoundingClientRect().bottom,
        buttonBottom: button.getBoundingClientRect().bottom,
        visible: layerEl.getAttribute("data-visible"),
        layerParent: layerEl.parentElement?.className ?? "",
      };
    });

    // 位置：按钮底边贴着消息区下沿（= 输入区上沿）上方一点点，而不是跟着内容
    // 末尾落回页面中段。
    expect(geom.buttonBottom).toBeLessThanOrEqual(geom.containerBottom + 1);
    expect(geom.buttonBottom).toBeGreaterThan(geom.containerBottom - 60);
    // 结构：层挂在锚点里，不在滚动面/正文列内（真正修掉残影的那一步）。
    expect(geom.layerParent).toContain("jump-to-bottom-anchor");
    expect(geom.visible).toBe("false");
  });
});
