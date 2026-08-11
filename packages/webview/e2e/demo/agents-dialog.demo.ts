import { test, expect } from "../utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../utils/screenshot.js";

test.describe("Agents Dialog Demo", () => {
  test("should show agent definitions list and detail", async ({
    webviewPage,
  }) => {
    // Dialog max-width is 760px, wider than the default 400px demo viewport — widen so the full dialog is captured
    await webviewPage.setViewportSize({ width: 900, height: 760 });

    // 1. Open the dialog via showDialog
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "showDialog",
        dialogType: "agents",
      });
    });

    // 2. Simulate the host replying with subagent configurations
    //    (same payload shape as `agent.getSubagentConfigurations()`)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "subagentConfigurationsResponse",
        configurations: [
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
        ],
      });
    });

    // Verify dialog is visible
    await expect(webviewPage.getByTestId("agents-dialog")).toBeVisible();

    // Screenshot the list view (grouped by scope)
    const dialog = webviewPage.getByTestId("agents-dialog");
    await elementScreenshotWebp(
      dialog,
      "../../docs/public/screenshots/spec-agents-list.webp",
    );

    // 3. Click the Explore agent to enter the detail view
    await dialog.getByText("Explore", { exact: true }).click();
    await expect(webviewPage.getByText("系统提示词：")).toBeVisible();

    // Screenshot the detail view
    await elementScreenshotWebp(
      dialog,
      "../../docs/public/screenshots/spec-agents-detail.webp",
    );
  });
});
