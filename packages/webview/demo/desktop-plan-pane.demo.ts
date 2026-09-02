import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop plan pane (spec desktop-app.md 计划面板): the host pushes the plan
// file contents to the shared Plan pane (same routing as an ExitPlanMode plan)
// — rendered markdown in a conversation-level side panel. The shared webview
// bundle must be rebuilt first (node esbuild.config.mjs).
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

const PLAN_CONTENT = `# 修复登录页样式问题

## 背景

登录页按钮与输入框在深色主题下对比度不足，需要统一品牌色变量。

## 实施步骤

1. **抽取主题变量** — 在 \`src/styles/tokens.css\` 中定义主色 \`#4A90D9\`
2. **更新登录页样式** — 输入框边框、按钮背景改用主题变量
3. **深色主题适配** — 补充 \`prefers-color-scheme: dark\` 下的对比度调整
4. **验证** — 在浅色/深色主题下分别检查登录流程

## 关键文件

| 文件 | 操作 |
| --- | --- |
| \`src/styles/tokens.css\` | 新增主题变量 |
| \`src/pages/login.css\` | 替换硬编码颜色 |

## 风险

- 改动仅涉及样式层，不影响登录逻辑；
- 主题变量变更需同步到其他页面（影响面小）。
`;

test.describe("Desktop plan pane screenshots", () => {
  test("plan panel renders the plan file markdown", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    // Host pushes the current plan file → the plan panel opens automatically.
    await injector.simulateExtensionMessage("planContent", {
      content: PLAN_CONTENT,
    });
    await expect(webviewPage.getByTestId("plan-pane")).toBeVisible();
    await expect(webviewPage.getByText("修复登录页样式问题")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-plan-pane.webp",
    );
  });
});
