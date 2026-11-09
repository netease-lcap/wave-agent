import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 一条会把详情撑满的命令（真实里 `node -e '...'` 就是这个形状）。 */
const LONG_COMMAND = `node -e "${"console.log('build step');".repeat(40)}"`;

const longOutput = (marker: string) =>
  Array.from({ length: 120 }, (_, i) => `${marker} line ${i} —— 构建日志`).join(
    "\n",
  );

const runningTask = {
  id: "bg-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: LONG_COMMAND,
  description: "long-running build",
};

/**
 * Real-browser geometry for the background-tasks pane (spec
 * `desktop/desktop-right-panel.md`「后台任务面板」场景 13/14).
 *
 * jsdom has no layout, so these are the only place the two size rules can be
 * asserted:
 * - the command block and the output block each cap their own height (~200px)
 *   and scroll inside, instead of stretching the panel;
 * - the output only auto-follows while the user is parked at the bottom, so
 *   scrolling up to read earlier lines is not yanked back.
 *
 * Mounts the production single-pane path (same as desktop-panel-tabs-overflow):
 * `desktopPanes` with a session-bound pane → DesktopShell wraps the pane-scoped
 * ChatApp, which is where the panel slot actually gets laid out.
 */
test.describe("Desktop background tasks pane geometry", () => {
  async function setupTasksPane(webviewPage: Page) {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "sess-a1" }],
      focusedPaneId: "pane-1",
    });
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      paneId: "pane-1",
    });
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      paneId: "pane-1",
      tasks: [runningTask],
    });
    await expect(webviewPage.getByTestId("desktop-pane-pane-1")).toBeVisible();

    // 空态入口打开「后台任务」tab（`/tasks` 的路由由单测覆盖，这里要的是布局）。
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-tasks").click();
    await expect(webviewPage.getByTestId("tasks-pane")).toBeVisible();
    return injector;
  }

  test("command block and output block cap their height and scroll inside", async ({
    webviewPage,
  }) => {
    const injector = await setupTasksPane(webviewPage);

    await webviewPage.getByTestId("tasks-pane-row-bg-1").click();
    const command = webviewPage.getByTestId("tasks-pane-command");
    await expect(command).toBeVisible();

    const commandBox = await command.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        maxHeight: style.maxHeight,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: style.overflowY,
      };
    });
    // 命令行自己限高：不随命令长度把面板撑长（与 CC 的 max-h-200 同口径）。
    expect(commandBox.maxHeight).toBe("200px");
    expect(commandBox.overflowY).toBe("auto");
    expect(commandBox.clientHeight).toBeLessThanOrEqual(200);
    expect(commandBox.scrollHeight).toBeGreaterThan(commandBox.clientHeight);

    await injector.simulateExtensionMessage("backgroundTaskOutput", {
      paneId: "pane-1",
      taskId: "bg-1",
      output: {
        stdout: longOutput("first"),
        stderr: "",
        status: "running",
        type: "shell",
      },
    });

    const output = webviewPage.getByTestId("tasks-pane-output");
    const outputBox = await output.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        maxHeight: style.maxHeight,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
    });
    expect(outputBox.maxHeight).toBe("200px");
    expect(outputBox.clientHeight).toBeLessThanOrEqual(200);
    expect(outputBox.scrollHeight).toBeGreaterThan(outputBox.clientHeight);

    // 面板本身没有被这两个块撑长：槽位高度稳定在视口内。
    const slotHeight = await webviewPage
      .getByTestId("desktop-panel-slot")
      .evaluate((el) => el.clientHeight);
    expect(slotHeight).toBeLessThanOrEqual(720);
  });

  test("output follows new lines only while parked at the bottom", async ({
    webviewPage,
  }) => {
    const injector = await setupTasksPane(webviewPage);
    await webviewPage.getByTestId("tasks-pane-row-bg-1").click();

    const output = webviewPage.getByTestId("tasks-pane-output");
    await injector.simulateExtensionMessage("backgroundTaskOutput", {
      paneId: "pane-1",
      taskId: "bg-1",
      output: {
        stdout: longOutput("first"),
        stderr: "",
        status: "running",
        type: "shell",
      },
    });

    // 打开时贴底：新内容把视口带到最新一行。
    const atBottom = () =>
      output.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2,
      );
    await expect.poll(atBottom).toBe(true);

    // 用户上滚阅读历史：刷新不能把阅读位置抢走。
    await output.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await injector.simulateExtensionMessage("backgroundTaskOutput", {
      paneId: "pane-1",
      taskId: "bg-1",
      output: {
        stdout: `${longOutput("second")}\nsecond tail`,
        stderr: "",
        status: "running",
        type: "shell",
      },
    });
    await expect.poll(() => output.evaluate((el) => el.scrollTop)).toBe(0);

    // 回到底部后恢复自动跟随。
    await output.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await injector.simulateExtensionMessage("backgroundTaskOutput", {
      paneId: "pane-1",
      taskId: "bg-1",
      output: {
        stdout: `${longOutput("third")}\nthird tail\nthird tail line`,
        stderr: "",
        status: "running",
        type: "shell",
      },
    });
    await expect.poll(atBottom).toBe(true);
  });
});
