import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../e2e/utils/screenshot.js";
import fs from "node:fs";
import path from "node:path";

/**
 * 设置页「子代理」「技能」选项卡 demo（/agents、/skills 斜杠命令落地页）：
 * 独立加载 settings.js bundle（settings-preview-entry），模拟 host 下发
 * settingsState(nav) 选中选项卡，再回 subagentConfigurationsResponse /
 * skillMetadataResponse 展示 4 个来源 Tab（插件 / 内置 / 用户 / 项目）的
 * agent 定义与技能列表，以及项目技能在当前项目下的平铺列表形态。
 */

// SettingsPage 的颜色全部走 --vscode-* 变量，独立 settings.html 没有宿主注入，
// 必须手动带上深色主题变量集，否则截图为白底浅色（实测 2026-08-29）。
const themeStyles = fs.readFileSync(
  path.join(process.cwd(), "theme", "theme-base-dark.css"),
  "utf8",
);

const mockVscodeApiJs = `
    window.process = { env: { NODE_ENV: 'production' } };
    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
        },
        setState: () => {},
        getState: () => ({})
    });
    window.simulateExtensionMessage = (message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    };
`;

const settingsHtml = `
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Settings</title>
    <style>${themeStyles}</style>
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/settings.css">
</head>
<body>
    <div id="root"></div>
    <script>${mockVscodeApiJs}</script>
    <script src="vscode-webview://mock-extension-id/settings.js"></script>
</body>
</html>`;

const WORKDIR = "/work/wave-agent";

const agentConfigurations = [
  {
    name: "Explore",
    description:
      'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase. When calling this agent, specify the desired thoroughness level: "quick", "medium", or "very thorough".',
    model: "glm-5.2",
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
    systemPrompt:
      "You are a file search specialist. You excel at thoroughly navigating and exploring codebases.\n\n=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===\nThis is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:\n- Creating new files (no Write, touch, or file creation of any kind)\n- Modifying existing files (no Edit operations)\n- Moving or copying files (no mv or cp)\n\nWhen answering: show the exact file path and line numbers for each relevant piece of code.",
    filePath: "/builtin/subagents/explore.md",
    scope: "builtin",
    priority: 0,
  },
  {
    name: "Plan",
    description:
      "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task.",
    model: "glm-5.2",
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
    systemPrompt:
      "You are a careful software architect. Before proposing a plan: read the relevant code, identify the critical files, and consider architectural trade-offs. Prefer the simplest approach that satisfies the requirements.",
    filePath: "/builtin/subagents/plan.md",
    scope: "builtin",
    priority: 1,
  },
  {
    name: "code-review",
    description: "代码评审助手，检查潜在缺陷、类型错误与改进点",
    model: "deepseek-v4-flash",
    tools: ["Bash", "Read", "Grep"],
    systemPrompt:
      "你是严格的代码评审专家。逐文件检查：\n1. 潜在缺陷与边界条件\n2. 类型安全与空值处理\n3. 错误处理与日志\n输出按严重程度分组的问题清单，并给出修改建议。",
    filePath: "~/.wave/agents/code-review.md",
    scope: "user",
    priority: 0,
  },
  {
    name: "release-bot",
    description:
      "仓库级发布助手：检查 changelog、版本号与 CI 状态，执行发布前检查",
    tools: ["Bash", "Read", "Grep"],
    systemPrompt:
      "你是发布检查专家。发布前依次验证：版本号一致性、changelog 完整性、CI 状态与工作区干净度。任一检查失败时给出明确的修复指引。",
    filePath: ".wave/agents/release-bot.md",
    scope: "project",
    priority: 0,
  },
  {
    name: "sdd:specify",
    description:
      "根据自然语言描述创建或更新功能规格说明，生成用户故事与验收场景",
    model: "glm-5.2",
    tools: ["Read", "Write"],
    systemPrompt:
      "你是规格编写专家。需求变更时先更新对应规格说明（新增用户故事、验收场景），边界模糊时先写 spec 草稿请用户确认。",
    filePath: "/plugins/sdd/agents/specify.md",
    scope: "plugin",
    priority: 0,
    pluginRoot: "/plugins/sdd",
  },
];

test.describe("设置页子代理选项卡 Demo", () => {
  test("should show 4 source tabs, grouped list and detail", async ({
    webviewPage,
  }) => {
    // Settings full-page is wider than the default 400px demo viewport
    await webviewPage.setViewportSize({ width: 1000, height: 760 });

    // Reload the harness page with the settings entry bundle
    await webviewPage.setContent(settingsHtml);

    // Wait for the settings page to render
    await expect(webviewPage.locator(".settings-page")).toBeVisible();

    // Host opens the settings tab with the subagents nav (mirrors /agents →
    // openSettings(nav:"subagents") → settingsState)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "settingsState",
        workdir: "/work/wave-agent",
        nav: "subagents",
      });
    });

    // The settings entry pulls config on open; reply so the page stays healthy
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "configurationResponse",
        configurationData: { language: "zh-CN", contextLength: 200 },
      });
    });

    // Simulate the host replying with subagent configurations
    await webviewPage.evaluate((configurations) => {
      window.simulateExtensionMessage({
        command: "subagentConfigurationsResponse",
        configurations,
      });
    }, agentConfigurations);

    // 4 source tabs exist and the default tab is 插件子代理
    await expect(webviewPage.getByText("插件子代理")).toBeVisible();
    await expect(webviewPage.getByText("内置子代理")).toBeVisible();
    await expect(webviewPage.getByText("用户子代理")).toBeVisible();
    await expect(webviewPage.getByText("项目子代理")).toBeVisible();
    await expect(webviewPage.getByText("sdd:specify")).toBeVisible();

    // Screenshot the whole settings page (left nav included, 子代理 highlighted)
    // so the shot reads as "settings page — subagents tab" in the docs.
    const view = webviewPage.locator(".settings-page");
    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-agents-list.webp",
    );

    // Switch to the builtin tab and open the Explore agent detail view
    await view.getByText("内置子代理", { exact: true }).click();
    await expect(
      webviewPage.getByText("Explore", { exact: true }),
    ).toBeVisible();
    await view.getByText("Explore", { exact: true }).click();
    await expect(webviewPage.getByText("系统提示词：")).toBeVisible();

    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-agents-detail.webp",
    );
  });
});

const skills = [
  {
    name: "deep-research",
    description: "深度研究：并行检索并交叉验证信息源，产出带引用的报告",
    type: "builtin",
    skillPath: "/builtin/skills/deep-research.md",
    allowedTools: ["WebFetch", "Grep"],
    userInvocable: true,
  },
  {
    name: "sdd:specify",
    description: "根据自然语言描述创建或更新功能规格说明",
    type: "builtin",
    skillPath: "/plugins/sdd/skills/specify.md",
    pluginName: "sdd",
    userInvocable: true,
  },
  {
    name: "my-skill",
    description: "个人自定义技能，用于日常代码审查",
    type: "personal",
    skillPath: "~/.wave/skills/my-skill.md",
    model: "glm-5.2",
    allowedTools: ["Read", "Write"],
    userInvocable: true,
  },
  {
    name: "deploy",
    description: "部署检查技能：验证构建产物与发布清单",
    type: "project",
    skillPath: "/work/wave-agent/.wave/skills/deploy/SKILL.md",
    userInvocable: true,
  },
  {
    name: "code-review",
    description: "项目级代码评审技能",
    type: "project",
    skillPath: "/work/wave-agent/.wave/skills/code-review/SKILL.md",
    userInvocable: true,
  },
];

test.describe("设置页技能选项卡 Demo", () => {
  test("should show 4 source tabs with flat project skill list", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 1000, height: 760 });
    await webviewPage.setContent(settingsHtml);
    await expect(webviewPage.locator(".settings-page")).toBeVisible();

    // /skills → openSettings(nav:"skills") → settingsState
    await webviewPage.evaluate((workdir) => {
      window.simulateExtensionMessage({
        command: "settingsState",
        workdir,
        nav: "skills",
      });
    }, WORKDIR);
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "configurationResponse",
        configurationData: { language: "zh-CN", contextLength: 200 },
      });
    });
    await webviewPage.evaluate((skillList) => {
      window.simulateExtensionMessage({
        command: "skillMetadataResponse",
        skills: skillList,
      });
    }, skills);

    // 4 source tabs exist
    await expect(webviewPage.getByText("插件技能")).toBeVisible();
    await expect(webviewPage.getByText("内置技能")).toBeVisible();
    await expect(webviewPage.getByText("用户技能")).toBeVisible();
    await expect(webviewPage.getByText("项目技能")).toBeVisible();

    const view = webviewPage.locator(".settings-page");

    // 项目技能平铺展示（仅当前项目，无分组卡片，2026-09-01 拍板）
    await view.getByText("项目技能", { exact: true }).click();
    await expect(
      webviewPage.getByText("/deploy", { exact: true }),
    ).toBeVisible();
    await expect(
      webviewPage.getByText("/code-review", { exact: true }),
    ).toBeVisible();

    await elementScreenshotWebp(
      view,
      "../../docs/public/screenshots/spec-skills-list.webp",
    );
  });
});
