import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Regression e2e (real browser) — 「后台任务运行期禁止原地切会话」状态机。
 *
 * 出处：
 *  - PR #2144 `hasRunningBackgroundTask` 门禁（新建对话按钮禁用 + 历史会话选择被
 *    忽略 + /clear 被忽略），防清空/替换会话中断正在跑的后台任务。
 *  - PR #2154 后台子代理/workflow 终态只改 in-map task 从不 notifyTasksChange，
 *    webview 侧 `backgroundTasks` 最后一份快照恒 running → 门禁锁死到重启。
 *    修好后终态快照会补推，门禁必须立即恢复 —— 本用例断言 webview 对「终态快照
 *    到达」的契约（真机上「快照会不会到」由 agent-sdk 侧 subagentManager /
 *    workflowManager 的 notify 保证，见 packages/agent-sdk 回归）。
 *
 * 语义对照单测 packages/webview/tests/webview/backgroundTaskBlocksSessionSwitch.test.tsx；
 * 这里跑在真实浏览器 + 真实 webview bundle 上，覆盖 contenteditable / 弹窗 / 焦点
 * 等 jsdom 测不到的交互路径。
 */

const runningShell = {
  id: "bg-shell-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "sleep 300",
  description: "long-running build",
};

const runningSubagent = {
  id: "bg-subagent-1",
  type: "subagent",
  status: "running",
  startTime: 1000,
  description: "background subagent exploration",
};

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    model: "claude-sonnet-4-20250514",
  },
  permissionMode: "default",
};

const historySessions = [
  {
    id: "session-1",
    sessionType: "main",
    workdir: "/test/project",
    firstMessage: "First session hello",
    lastActiveAt: "2023-12-01T10:00:00Z",
    latestTotalTokens: 150,
  },
  {
    id: "session-2",
    sessionType: "main",
    workdir: "/test/project",
    firstMessage: "Second session world",
    lastActiveAt: "2023-12-01T11:00:00Z",
    latestTotalTokens: 250,
  },
];

async function setup(webviewPage: import("@playwright/test").Page) {
  const injector = new MessageInjector(webviewPage);
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  return injector;
}

function sentCommands(
  webviewPage: import("@playwright/test").Page,
): Promise<string[]> {
  return webviewPage.evaluate(() =>
    (
      (
        window as unknown as { getTestMessages?: () => unknown[] }
      ).getTestMessages?.() ?? []
    ).map((m) => (m as { command?: string }).command ?? ""),
  );
}

test.describe("后台任务门禁（新建对话 / 加载历史）", () => {
  test("running 后台 shell 禁用「新建对话」，终态快照到达后恢复并可发 clearChat", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);
    const newSessionBtn = webviewPage.getByTestId("new-session-btn");
    await expect(newSessionBtn).toBeEnabled();

    // running → 禁用
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [runningShell],
    });
    await expect(newSessionBtn).toBeDisabled();

    // 点击禁用按钮不得发出 clearChat（守卫 + 原生 disabled 双保险）
    await injector.clearMessageLog();
    await newSessionBtn.click({ force: true });
    await webviewPage.waitForTimeout(100);
    expect(await sentCommands(webviewPage)).not.toContain("clearChat");

    // 终态快照（completed）到达 → 立即恢复（回归 #2154 锁死到重启）
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [
        { ...runningShell, status: "completed", endTime: 2000, exitCode: 0 },
      ],
    });
    await expect(newSessionBtn).toBeEnabled();

    // 恢复后点击 → clearChat 真的发出
    await injector.clearMessageLog();
    await newSessionBtn.click();
    await expect
      .poll(async () => sentCommands(webviewPage))
      .toContain("clearChat");
  });

  test("终态快照 semantic：subagent 仍 running 则继续禁用，全部终态才放行", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);
    const newSessionBtn = webviewPage.getByTestId("new-session-btn");

    // 一 shell + 一 subagent 都在跑
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [runningShell, runningSubagent],
    });
    await expect(newSessionBtn).toBeDisabled();

    // shell 完成但 subagent 还跑 → 仍禁用（不是「有终态项就放行」）
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [{ ...runningShell, status: "completed" }, runningSubagent],
    });
    await expect(newSessionBtn).toBeDisabled();

    // subagent 变 failed 也是终态 → 放行
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [
        { ...runningShell, status: "completed" },
        { ...runningSubagent, status: "failed", endTime: 3000 },
      ],
    });
    await expect(newSessionBtn).toBeEnabled();

    // killed 同样视为终态：重新注入一个 killed 项仍放行
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [{ ...runningSubagent, status: "killed" }],
    });
    await expect(newSessionBtn).toBeEnabled();

    // 清空列表 → 放行
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [],
    });
    await expect(newSessionBtn).toBeEnabled();
  });

  test("running 时历史会话选择被忽略（弹窗仍关闭、会话不被替换），终态后恢复", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);
    await injector.simulateExtensionMessage("updateSessions", {
      sessions: historySessions,
    });

    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [runningSubagent],
    });
    await injector.clearMessageLog();

    await webviewPage.getByTestId("history-btn").click();
    await expect(webviewPage.getByTestId("session-list-popup")).toBeVisible();
    await webviewPage.getByTestId("session-list-item-session-2").click();

    // 守卫拦截 restoreSession；弹窗按既有 UX 关闭
    await expect(webviewPage.getByTestId("session-list-popup")).toHaveCount(0);
    await webviewPage.waitForTimeout(100);
    expect(await sentCommands(webviewPage)).not.toContain("restoreSession");

    // 终态后同一路径恢复可用
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [{ ...runningSubagent, status: "completed" }],
    });
    await injector.clearMessageLog();
    await webviewPage.getByTestId("history-btn").click();
    await webviewPage.getByTestId("session-list-item-session-2").click();

    await expect
      .poll(async () =>
        webviewPage.evaluate(() =>
          (
            (
              window as unknown as { getTestMessages?: () => unknown[] }
            ).getTestMessages?.() ?? []
          ).find(
            (m) => (m as { command?: string }).command === "restoreSession",
          ),
        ),
      )
      .toMatchObject({ command: "restoreSession", sessionId: "session-2" });
  });

  test("running 时 /clear 斜杠命令被忽略，终态后可清空", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [runningShell],
    });
    await injector.clearMessageLog();

    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await input.focus();
    await webviewPage.keyboard.type("/clear");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.waitForTimeout(150);

    let sent = await sentCommands(webviewPage);
    expect(sent).not.toContain("clearChat");
    expect(sent).not.toContain("sendMessage");

    // 终态后 /clear 生效
    await injector.simulateExtensionMessage("updateBackgroundTasks", {
      tasks: [{ ...runningShell, status: "killed" }],
    });
    await injector.clearMessageLog();
    await input.click();
    await input.focus();
    await webviewPage.keyboard.type("/clear");
    await webviewPage.keyboard.press("Enter");

    await expect
      .poll(async () => sentCommands(webviewPage))
      .toContain("clearChat");
  });

  test("setInitialState 携带 running 任务时开局即禁用（冷启动快照路径）", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      backgroundTasks: [runningShell, runningSubagent],
    });
    await expect(webviewPage.getByTestId("new-session-btn")).toBeDisabled();
  });
});
