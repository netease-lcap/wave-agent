import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

test.describe("Desktop split-view panes", () => {
  test("editable session title hugs its text and leaves the header draggable", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1" },
        { paneId: "pane-2", sessionId: "sess-a2" },
      ],
      focusedPaneId: "pane-1",
    });
    // pane 头部标题要能改名才算「可点标题」（role=button）——这正是最容易把
    // 整个头部变成不可拖拽区域的形态，所以本用例必须带上 session。
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      paneId: "pane-1",
      session: {
        id: "sess-a1",
        sessionType: "main",
        workdir: DIR_A,
        firstMessage: "修复登录页样式",
      },
    });

    const pane = webviewPage.getByTestId("desktop-pane-pane-1");
    const header = pane.getByTestId("chat-header");
    const title = pane.getByTestId("header-title");
    await expect(title).toHaveClass(/header-title-editable/);
    await expect(title).toHaveText("修复登录页样式");

    // 标题盒只包住文字：撑满剩余宽度（flex:1）时 hover 高亮会糊满整个头部。
    const headerBox = await header.boundingBox();
    const titleBox = await title.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.width).toBeLessThan(headerBox!.width * 0.5);

    // 标题右侧的头部空白区必须是可拖拽起手点：拖拽逻辑挂在 .chat-header 上，
    // 但按下落在标题（[role=button]）上会被否决，所以这块不能是标题的地盘。
    const probe = await webviewPage.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return {
          isHeader: el?.classList.contains("chat-header") === true,
          blockedBy:
            el
              ?.closest('button, a, input, select, textarea, [role="button"]')
              ?.getAttribute("data-testid") ?? null,
        };
      },
      {
        x: titleBox!.x + titleBox!.width + 80,
        y: headerBox!.y + headerBox!.height / 2,
      },
    );
    expect(probe).toEqual({ isHeader: true, blockedBy: null });

    // 真按一次：从该点起手应带上 pane 载荷（未被否决）；落在标题文字上则是
    // 「点击改名」优先，拖拽被否决。两半都要成立，否则不是修好了而是换了个坏法。
    await webviewPage.evaluate(() => {
      const w = window as unknown as { __dragStarts?: Array<unknown> };
      w.__dragStarts = [];
      document.addEventListener(
        "dragstart",
        (e) => {
          const dt = (e as DragEvent).dataTransfer;
          w.__dragStarts!.push({
            prevented: e.defaultPrevented,
            payload: dt?.getData("application/x-wave-pane") ?? "",
          });
        },
        false,
      );
    });
    const dragFrom = async (x: number) => {
      const y = headerBox!.y + headerBox!.height / 2;
      await webviewPage.mouse.move(x, y);
      await webviewPage.mouse.down();
      await webviewPage.mouse.move(x + 40, y, { steps: 6 });
      await webviewPage.mouse.move(x + 80, y + 30, { steps: 6 });
      await webviewPage.mouse.up();
    };

    await dragFrom(titleBox!.x + titleBox!.width + 80);
    await dragFrom(titleBox!.x + titleBox!.width / 2);

    const dragStarts = await webviewPage.evaluate(
      () =>
        (window as unknown as { __dragStarts: Array<unknown> }).__dragStarts,
    );
    expect(dragStarts).toEqual([
      { prevented: false, payload: JSON.stringify({ paneId: "pane-1" }) },
      { prevented: true, payload: "" },
    ]);
  });

  test("pane close button does not overlap the header panel toggle", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1" },
        { paneId: "pane-2", sessionId: "sess-a2" },
      ],
      focusedPaneId: "pane-1",
    });

    const pane = webviewPage.getByTestId("desktop-pane-pane-1");
    const closeButton = webviewPage.getByTestId("desktop-pane-close-pane-1");
    const panelToggle = pane.getByTestId("panel-toggle-btn");
    await expect(closeButton).toBeVisible();
    await expect(panelToggle).toBeVisible();

    // The absolutely-positioned close button must sit in its own reserved
    // header space, not on top of the right-most header button.
    const closeBox = await closeButton.boundingBox();
    const toggleBox = await panelToggle.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    const intersects =
      closeBox!.x < toggleBox!.x + toggleBox!.width &&
      closeBox!.x + closeBox!.width > toggleBox!.x &&
      closeBox!.y < toggleBox!.y + toggleBox!.height &&
      closeBox!.y + closeBox!.height > toggleBox!.y;
    expect(intersects).toBe(false);

    // The close button must be vertically centered with the header buttons
    // (44px header, 22px button) — not pinned to the top edge.
    const closeCenterY = closeBox!.y + closeBox!.height / 2;
    const toggleCenterY = toggleBox!.y + toggleBox!.height / 2;
    expect(Math.abs(closeCenterY - toggleCenterY)).toBeLessThanOrEqual(1.5);
  });

  test("two-row split layout packs overflow into a second row", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    // Four panes: pane-1/pane-2 on the top row, pane-3/pane-4 on the bottom
    // row (row:1). rowHeights [0.6, 0.4] gives the top row 60% of the height.
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", row: 0, width: 0.5 },
        { paneId: "pane-2", sessionId: "sess-a2", row: 0, width: 0.5 },
        { paneId: "pane-3", sessionId: "sess-a3", row: 1, width: 0.5 },
        { paneId: "pane-4", sessionId: "sess-a4", row: 1, width: 0.5 },
      ],
      focusedPaneId: "pane-1",
      rowHeights: [0.6, 0.4],
    });

    // Each pane gets its own conversation; route messages by paneId.
    const paneMsg = (id: string, user: string, reply: string) =>
      injector.simulateExtensionMessage("updateMessages", {
        paneId: id,
        messages: [
          MockDataGenerator.createUserMessage(user, `u-${id}`),
          MockDataGenerator.createAssistantMessage(reply, `a-${id}`),
        ],
      });
    await paneMsg("pane-1", "修复登录页样式", "我先看一下样式文件。");
    await paneMsg("pane-2", "给购物车加测试", "我会先补充测试用例。");
    await paneMsg("pane-3", "梳理会话索引", "从持久化层开始梳理。");
    await paneMsg("pane-4", "补全终端面板测试", "覆盖首次聚焦路径。");

    await expect(webviewPage.getByTestId("desktop-pane-pane-1")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-pane-pane-3")).toBeVisible();
    // Two rows + a draggable separator between them.
    await expect(webviewPage.getByTestId("desktop-pane-row")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-pane-row-1")).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-row-separator"),
    ).toBeVisible();
  });
});
