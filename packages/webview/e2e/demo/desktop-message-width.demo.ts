import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

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

// Demonstrates that the conversation column is capped at 800px and centered,
// lining up with the input box — instead of messages spanning the full pane
// width on a wide window. A wide viewport makes the side gutters obvious.
test.describe("Desktop message column width", () => {
  test("messages are centered and aligned with the input", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    // Wide window so the 800px cap leaves visible gutters on both sides.
    await webviewPage.setViewportSize({ width: 1280, height: 800 });

    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });

    // Wait for the desktop layout to mount ChatApp and attach its message
    // listener before pushing messages — otherwise updateMessages lands in
    // the gap before workdirState triggers the mount and is dropped.
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

    // The conversation column is capped at 800px (matching .input-wrapper's
    // own 800px cap) and centered, so the message column's outer edges line
    // up with the input box's edges exactly. .messages-container is
    // border-box, so its 10px message padding lives inside the 800px column
    // (content 780) rather than overflowing it — the column aligns with
    // .input-wrapper instead of sitting 20px wider.
    const geom = await webviewPage.evaluate(() => {
      const r = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      const cs = (sel: string) =>
        getComputedStyle(document.querySelector(sel)!).backgroundColor;
      const msg = r(".messages-container");
      const input = r(".input-wrapper");
      const main = r(".desktop-chat-main");
      return {
        msgCapped: msg.width < main.width,
        centered: Math.abs(msg.left - main.left - (main.right - msg.right)) < 1,
        columnAlignsInput:
          Math.abs(msg.left - input.left) < 1 &&
          Math.abs(msg.right - input.right) < 1,
        // The gutter (chat-area background showing through the transparent
        // wrappers around the message column) must match the message list's
        // own background, not the host's editor-background body.
        gutterBg: cs(".chat-container"),
        msgBg: cs(".messages-container"),
      };
    });
    expect(geom.msgCapped).toBeTruthy();
    expect(geom.centered).toBeTruthy();
    expect(geom.columnAlignsInput).toBeTruthy();
    expect(geom.gutterBg).toBe(geom.msgBg);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-chat-centered.webp",
    );
  });
});
