import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const WORKDIR = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

// 桌面端消息列与输入卡宽度关系（第 24 轮后以设计师 Figma 规范为准）：
//   - 对话列 .messages-column 保持既有 cap 800px 居中（base 产品形态，
//     desktop-density-restore 记录：虚拟列表行 inset 联动，列宽不单独改）；
//   - 输入卡 .input-wrapper cap 768px 居中（Figma「Form - 发送消息」768 =
//     Container 800 − pad 16×2，host-desktop.css [data-host=desktop] 覆盖）；
//   - 两列各自居中 → 水平中心对齐，对话列每侧比输入卡宽 16px。
// 宽视口让两侧 gutter 可见，用于断言 cap 与居中不漂移。
//
// 2026-09-23 结构变更（滚动交互面扩展到整个面板）：cap 从滚动容器
// .messages-container **下移**到内层包裹层 .messages-column —— 外层滚动容器
// 现在铺满整个 pane（滚轮/触控板在 gutter 上也能滚），内层仍是 800px 居中。
// 因此本用例的几何断言改成：滚动容器宽 == pane 宽、内容列宽仍 800（桌面输入卡
// 仍 768）、两列中心仍对齐；并新增「gutter 上的滚轮能滚动」的断言。
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
        "好的，我给对话列加了 max-width: 800px 和 margin: 0 auto，与 .input-wrapper 的约束方式一致。这样消息内容会居中显示在 800px 的列里，两侧留出与输入框对齐的留白，窗口越宽效果越明显。",
        "msg-a1",
      ),
    ]);

    await expect(webviewPage.locator(".message.user")).toBeVisible();
    await expect(webviewPage.locator(".message.assistant")).toBeVisible();

    // .messages-column 是 border-box：其 10px 消息 padding 在 800px 列内
    // （content 780）。输入卡 768px cap 是 [data-host=desktop] 覆盖，welcome
    // 态输入卡限宽同 768（host-desktop.css），两态一致。
    const geom = await webviewPage.evaluate(() => {
      const r = (sel: string) =>
        document.querySelector(sel)!.getBoundingClientRect();
      const cs = (sel: string) =>
        getComputedStyle(document.querySelector(sel)!).backgroundColor;
      const container = r(".messages-container");
      const col = r(".messages-column");
      const input = r(".input-wrapper");
      const main = r(".desktop-chat-main");
      const center = (b: DOMRect) => b.left + b.width / 2;
      return {
        // 滚动容器铺满整个 pane（滚轮/触控板的作用面 = 整个面板）
        containerSpansPane: Math.abs(container.width - main.width) < 1,
        // 限宽下移到内层包裹层：内容列仍是 800px 居中
        colCapped: col.width < main.width,
        colCentered:
          Math.abs(col.left - main.left - (main.right - col.right)) < 1,
        inputCapped: input.width < main.width,
        inputCentered:
          Math.abs(input.left - main.left - (main.right - input.right)) < 1,
        // 两列独立居中 → 中心对齐；对话列 800 比输入卡 768 每侧宽 16px
        // （800−768=32，±2 容差）。
        centersAlign: Math.abs(center(col) - center(input)) < 1,
        colWiderBy32: Math.abs(col.width - input.width - 32) < 2,
        // The gutter (chat-area background showing through the transparent
        // wrappers around the message column) must match the message list's
        // own background, not the host's editor-background body.
        gutterBg: cs(".chat-container"),
        containerBg: cs(".messages-container"),
        // The inner column paints no background of its own — it must stay
        // transparent so the gutters read as one surface.
        colBg: cs(".messages-column"),
      };
    });
    expect(geom.containerSpansPane).toBeTruthy();
    expect(geom.colCapped).toBeTruthy();
    expect(geom.colCentered).toBeTruthy();
    expect(geom.inputCapped).toBeTruthy();
    expect(geom.inputCentered).toBeTruthy();
    expect(geom.centersAlign).toBeTruthy();
    expect(geom.colWiderBy32).toBeTruthy();
    expect(geom.gutterBg).toBe(geom.containerBg);
    expect(geom.colBg).toBe("rgba(0, 0, 0, 0)");
  });

  // 回归守卫：滚轮/触控板的作用面覆盖整个面板。改动前滚动容器就是那条被限宽居中
  // 的 800px 列，两侧 gutter 上没有滚动容器，`elementFromPoint` 命中
  // .desktop-chat-main、滚轮不改变 scrollTop（用户报「鼠标只能在粉色区域操作」）。
  test("wheel over the side gutter scrolls the message list", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 800 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await expect(webviewPage.getByTestId("desktop-workdir")).toBeVisible();

    // Enough content to overflow the 614px-tall viewport.
    const messages = [];
    for (let i = 0; i < 8; i++) {
      messages.push(
        MockDataGenerator.createUserMessage(`第 ${i} 轮问题`, `msg-u${i}`),
        MockDataGenerator.createAssistantMessage(
          `第 ${i} 轮回答：`.repeat(1) + "内容".repeat(200),
          `msg-a${i}`,
        ),
      );
    }
    await injector.updateMessages(messages);
    await expect(
      webviewPage.locator(".message.assistant").first(),
    ).toBeVisible();

    const probe = await webviewPage.evaluate(() => {
      const container = document.querySelector(
        ".messages-container",
      ) as HTMLElement;
      const main = document
        .querySelector(".desktop-chat-main")!
        .getBoundingClientRect();
      container.scrollTop = container.scrollHeight / 2;
      const y = Math.round(container.getBoundingClientRect().top + 200);
      const points = {
        right: { x: Math.round(main.right - 20), y },
        left: { x: Math.round(main.left + 20), y },
      };
      const hitIsScrollSurface = (p: { x: number; y: number }) => {
        const el = document.elementFromPoint(p.x, p.y);
        return !!el?.closest(".messages-container");
      };
      const col = document
        .querySelector(".messages-column")!
        .getBoundingClientRect();
      return {
        points,
        hitRight: hitIsScrollSurface(points.right),
        hitLeft: hitIsScrollSurface(points.left),
        // Both probe points must sit OUTSIDE the conversation column, i.e.
        // in the gutter — that is the whole point of this test.
        rightInGutter: points.right.x > col.right,
        leftInGutter: points.left.x < col.left,
        scrollTop: container.scrollTop,
      };
    });
    expect(probe.rightInGutter).toBeTruthy();
    expect(probe.leftInGutter).toBeTruthy();
    expect(probe.hitRight).toBeTruthy();
    expect(probe.hitLeft).toBeTruthy();

    const scrollFrom = async (p: { x: number; y: number }, dy: number) => {
      const before = await webviewPage.evaluate(
        () =>
          (document.querySelector(".messages-container") as HTMLElement)
            .scrollTop,
      );
      await webviewPage.mouse.move(p.x, p.y);
      await webviewPage.mouse.wheel(0, dy);
      await webviewPage.waitForTimeout(250);
      const after = await webviewPage.evaluate(
        () =>
          (document.querySelector(".messages-container") as HTMLElement)
            .scrollTop,
      );
      return { before, after };
    };

    const right = await scrollFrom(probe.points.right, -200);
    expect(right.after).toBeLessThan(right.before);
    const left = await scrollFrom(probe.points.left, 200);
    expect(left.after).toBeGreaterThan(left.before);
  });
});
