import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const WORKDIR = "/Users/dev/projects/wave-agent";

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

// 桌面端消息列与输入卡宽度关系（第 24 轮后以设计师 Figma 规范为准）：
//   - 消息列 .messages-container 保持既有 cap 800px 居中（base 产品形态，
//     desktop-density-restore 记录：虚拟列表行 inset 联动，列宽不单独改）；
//   - 输入卡 .input-wrapper cap 768px 居中（Figma「Form - 发送消息」768 =
//     Container 800 − pad 16×2，host-desktop.css [data-host=desktop] 覆盖）；
//   - 两列各自居中 → 水平中心对齐，消息列每侧比输入卡宽 16px。
// 宽视口让两侧 gutter 可见，用于断言 cap 与居中不漂移。
test.describe("Desktop message column width", () => {
  test("message column and input card stay capped and centered (composer 768 spec)", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // Wide window so the 800px cap leaves visible gutters on both sides.
    await webviewPage.setViewportSize({ width: 1280, height: 800 });

    // The desktop layout only mounts ChatApp after desktopWorkdirState, so
    // push the initial state only once the mount's message listener exists
    // (webviewReady) — a setInitialState sent before that lands in the gap
    // and is dropped, leaving ChatApp uninitialized with the input area
    // hidden behind the loading sweep.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    // Wait for the layout to attach its message listener before pushing
    // messages — otherwise updateMessages lands in the gap before workdirState
    // triggers the mount and is dropped.
    await expect(webviewPage.getByTestId("desktop-workdir")).toBeVisible();

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我把消息列表加一个最大宽度并居中，跟输入框保持一致，否则消息太宽不好看。",
        "msg-u1",
      ),
      MockDataGenerator.createAssistantMessage(
        "好的，我给 .messages-container 加了 max-width: 800px 和 margin: 0 auto，与 .input-wrapper 的约束方式一致。这样消息内容会居中显示在 800px 的列里，两侧留出与输入框对齐的留白，窗口越宽效果越明显。",
        "msg-a1",
      ),
    ]);

    await expect(webviewPage.locator(".message.user")).toBeVisible();
    await expect(webviewPage.locator(".message.assistant")).toBeVisible();

    // .messages-container 是 border-box：其 10px 消息 padding 在 800px 列内
    // （content 780）。输入卡 768px cap 是 [data-host=desktop] 覆盖，welcome
    // 态输入卡限宽同 768（host-desktop.css），两态一致。
    const geom = await webviewPage.evaluate(() => {
      const r = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      const cs = (sel: string) =>
        getComputedStyle(document.querySelector(sel)!).backgroundColor;
      const msg = r(".messages-container");
      const input = r(".input-wrapper");
      const main = r(".desktop-chat-main");
      const center = (b: DOMRect) => b.left + b.width / 2;
      return {
        msgCapped: msg.width < main.width,
        centered: Math.abs(msg.left - main.left - (main.right - msg.right)) < 1,
        inputCapped: input.width < main.width,
        inputCentered:
          Math.abs(input.left - main.left - (main.right - input.right)) < 1,
        // 两列独立居中 → 中心对齐；消息列 800 比输入卡 768 每侧宽 16px
        // （800−768=32，±2 容差）。
        centersAlign: Math.abs(center(msg) - center(input)) < 1,
        msgWiderBy32: Math.abs(msg.width - input.width - 32) < 2,
        // The gutter (chat-area background showing through the transparent
        // wrappers around the message column) must match the message list's
        // own background, not the host's editor-background body.
        gutterBg: cs(".chat-container"),
        msgBg: cs(".messages-container"),
      };
    });
    expect(geom.msgCapped).toBeTruthy();
    expect(geom.centered).toBeTruthy();
    expect(geom.inputCapped).toBeTruthy();
    expect(geom.inputCentered).toBeTruthy();
    expect(geom.centersAlign).toBeTruthy();
    expect(geom.msgWiderBy32).toBeTruthy();
    expect(geom.gutterBg).toBe(geom.msgBg);
  });
});
