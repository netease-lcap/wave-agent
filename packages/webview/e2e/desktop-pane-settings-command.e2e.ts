import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

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

/**
 * spec agent-config.md 场景 5 回归：desktop pane 布局已生效（desktopPanes 推送、
 * 对话发过消息）后，/config、/agents、/skills、/mcp 必须打开全页设置页——pane
 * 自身不渲染设置视图，命令委托根实例。旧 bug：pane-scoped ChatApp 的 settingsOpen
 * 是孤儿 state，输入命令「没反应」（新对话时 desktopPanes 未推送、走单页分支所以
 * 正常，发过消息后失效；单 pane 与多 pane 均可复现）。
 */
test.describe("Desktop pane 布局斜杠命令打开设置页", () => {
  async function setupPanes(
    webviewPage: Page,
    panes: Array<{ paneId: string; sessionId: string }>,
  ) {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.simulateExtensionMessage("desktopPanes", {
      panes,
      focusedPaneId: panes[0].paneId,
    });
    // pane-scoped ChatApp 用 forThisPane 门控忽略无 paneId 的消息——真机由
    // desktopHost 在 pane 绑定时按 paneId 重推快照。这里模拟「有消息的对话」：
    // 每个 pane 收到自己的 setInitialState（initialized/isAuthenticated）+ 历史消息。
    for (const pane of panes) {
      await injector.simulateExtensionMessage("setInitialState", {
        ...initialState,
        paneId: pane.paneId,
      });
      await injector.simulateExtensionMessage("updateMessages", {
        paneId: pane.paneId,
        messages: [
          MockDataGenerator.createUserMessage(
            "修复登录页样式",
            `u-${pane.paneId}`,
          ),
          MockDataGenerator.createAssistantMessage(
            "我先看一下样式文件。",
            `a-${pane.paneId}`,
          ),
        ],
      });
    }
    await expect(
      webviewPage.getByTestId(`desktop-pane-${panes[0].paneId}`),
    ).toBeVisible();
  }

  async function typeAndEnter(webviewPage: Page, paneId: string, text: string) {
    const input = webviewPage
      .getByTestId(`desktop-pane-${paneId}`)
      .getByTestId("message-input");
    await input.click();
    await input.focus();
    await webviewPage.keyboard.type(text);
    await webviewPage.keyboard.press("Enter");
  }

  test("单 pane：/config 打开全页设置页并选中「全局设置」", async ({
    webviewPage,
  }) => {
    await setupPanes(webviewPage, [{ paneId: "pane-1", sessionId: "sess-a1" }]);
    await typeAndEnter(webviewPage, "pane-1", "/config");

    // 全页设置页由根实例渲染（取代 pane 视图），全局设置选项卡激活
    await expect(webviewPage.locator(".settings-page")).toBeVisible();
    await expect(
      webviewPage.getByText("管理 Wave 的界面、模型和基础行为。"),
    ).toBeVisible();
    const nav = webviewPage.locator(".settings-navigation .settings-nav-item", {
      hasText: "全局设置",
    });
    await expect(nav).toHaveClass(/is-active/);

    // 命令被拦截消费，未作为消息发给 agent
    const sent = await webviewPage.evaluate(() =>
      (
        window as unknown as { getTestMessages: () => unknown[] }
      ).getTestMessages(),
    );
    expect(
      sent.some(
        (m) =>
          (m as { command?: string }).command === "sendMessage" &&
          JSON.stringify(m).includes("/config"),
      ),
    ).toBe(false);
  });

  test("多 pane：pane-2 内 /mcp 打开设置页并选中「MCP 服务」", async ({
    webviewPage,
  }) => {
    await setupPanes(webviewPage, [
      { paneId: "pane-1", sessionId: "sess-a1" },
      { paneId: "pane-2", sessionId: "sess-a2" },
    ]);
    await typeAndEnter(webviewPage, "pane-2", "/mcp");

    await expect(webviewPage.locator(".settings-page")).toBeVisible();
    const nav = webviewPage.locator(".settings-navigation .settings-nav-item", {
      hasText: "MCP 服务",
    });
    await expect(nav).toHaveClass(/is-active/);
    // MCP 视图标题可见（对应选项卡内容区渲染）
    await expect(
      webviewPage.getByRole("heading", { name: "MCP 服务" }),
    ).toBeVisible();
  });
});
