import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 右键「添加到 CodeWave IDE」的选区标签插入。
 *
 * 出处：VS Code 命令 wave-code.addToWave（packages/vscode/src/extension.ts:80）
 * → ChatProvider.addToWave（chatProvider.ts:277，focusView() 后广播 postMessage）
 * → WebviewManager.postMessage（session/webviewManager.ts:307）
 * → 本仓库 webview 的 MessageInput.insertSelectionTag。
 *
 * 为什么必须在 e2e 层守：插入点解析依赖「光标快照」lastCaretOffsetRef —— 它只在
 * 输入框失焦时写入，而输入框被清空（发送后清 contenteditable / 手动删空）时不重置。
 * 于是快照偏移会大于当前文本长度，findTextOffset 解析不出位置，插入被静默丢弃：
 * 右键后界面上「完全没反应」（无 tag、无 toast、无报错）。
 *
 * 单测（packages/webview/tests/webview/selectionFeature.test.tsx）跑在 jsdom 里，那一层
 * 测不出这个缺陷：旧用例都从「全新挂载」起步（从未打过字、快照为 null），走不到这条路径；
 * jsdom 的 focus()/选区语义又比真机宽松（清空子节点后它仍认为选区落在输入框内）。
 * 真机语义由这里守：打过字 → 光标移出（写入快照）→ 清空输入框 →
 * 派发 addSelectionToInput → 标签必须落进输入框。
 */

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

const selection = {
  filePath: "/src/services/payment/PaymentService.ts",
  fileName: "PaymentService.ts",
  startLine: 45,
  endLine: 62,
  selectedText: "async processPayment(tx: PaymentTx): Promise<Result> {",
  isEmpty: false,
};

const tagSelector =
  '#messageInput .context-tag-container[data-is-selection="true"]';

test.describe("Selection tag insertion", () => {
  test("inserts the tag after the input was typed in, blurred and cleared", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    const input = webviewPage.getByTestId("message-input");
    // 输入区由 setInitialState 触发挂载，它的 useHostMessage 监听器随之上线；
    // 早于挂载派发的命令会被 webview 直接丢弃（无重放），故先等它就位。
    await webviewPage.waitForSelector('[data-testid="message-input"]');

    // 1. 在输入框里打字：产生文本节点，光标落在其中
    await input.click();
    await webviewPage.keyboard.type("hello world");
    await expect(input).toHaveText("hello world");

    // 2. 光标移出输入框：blur 时记下光标偏移（快照 = 文本末尾）
    await webviewPage.locator("body").click({ position: { x: 5, y: 5 } });

    // 3. 清空输入框（等价于发送后清 contenteditable / 手动删空）——
    //    这一步不会重置上面的快照，快照随之过期
    await input.click();
    await webviewPage.keyboard.press("Control+A");
    await webviewPage.keyboard.press("Backspace");
    expect(await input.textContent()).toBe("");

    // 4. 右键「添加到 CodeWave IDE」：宿主把选区投递进 webview
    await injector.simulateExtensionMessage("addSelectionToInput", {
      selection,
    });

    // 5. 标签必须真的落进输入框。修好前这里 count 恒为 0，且界面上没有任何反馈。
    await expect(webviewPage.locator(tagSelector)).toHaveCount(1);
    await expect(input).toContainText("PaymentService.ts#45-62");
  });

  // 对照：输入框从未被聚焦过（用户曾怀疑这条路径在真机上同样会静默失效 ——
  // 实测 contenteditable.focus() 一定会把光标造进该文档的选区，故它是好的）。
  // 固定住它，免得日后有人把 resolveInsertionPoint 的实时选区那半段删掉。
  test("still inserts when the input was never touched", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await webviewPage.waitForSelector('[data-testid="message-input"]');

    await injector.simulateExtensionMessage("addSelectionToInput", {
      selection,
    });

    await expect(webviewPage.locator(tagSelector)).toHaveCount(1);
  });
});
