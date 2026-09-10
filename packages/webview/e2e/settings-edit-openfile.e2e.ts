import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression（VS Code / JetBrains 设置页四个视图点「编辑」都不打开配置文件）：
 *
 * 设置页「编辑」= 关闭设置 webview 并预填 AI 提示词 + 让宿主打开对应配置文件。
 * 入口（settings-preview-entry）过去按 `prefillPrompt` → `openFile` 顺序发送，
 * 而宿主处理 `prefillPrompt` 会立刻关闭/销毁设置 webview（VSCE
 * disposeSettingsPanel → WebviewPanel.dispose() 释放 onDidReceiveMessage；
 * JB closeSettings → WaveSettingsFileEditor.dispose() → bridge.dispose()），
 * 随后到达的 `openFile` 被丢弃 → 点「编辑」等于没反应。
 *
 * 修复 = 入口先发 `openFile` 再发 `prefillPrompt`。本用例驱动真实 settings.js
 * bundle 逐视图断言「openFile 先于 prefillPrompt」——修复前四个用例全红。
 */

// SettingsPage 的颜色全部走 --vscode-* 变量，独立 settings.html 没有宿主注入，
// 必须手动带上深色主题变量集（与 settings-project-toggle.e2e.ts 同法）。
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

async function openSettings(webviewPage: Page) {
  await webviewPage.setViewportSize({ width: 1000, height: 760 });
  await webviewPage.setContent(settingsHtml);
  await expect(webviewPage.locator(".settings-page")).toBeVisible();
  // 设置入口挂载时会请求 getConfiguration
  await webviewPage.evaluate(() => {
    window.simulateExtensionMessage({
      command: "configurationResponse",
      configurationData: { language: "zh-CN", contextLength: 200 },
    });
  });
}

function sentMessages(webviewPage: Page) {
  return webviewPage.evaluate(
    () =>
      (window.testMessages ?? []) as Array<{
        command?: string;
        path?: string;
        prompt?: string;
      }>,
  );
}

/** 断言最后两条消息是 openFile(path) → prefillPrompt，即 openFile 未被关闭丢弃。 */
async function expectOpenFileBeforePrefill(
  webviewPage: Page,
  expectedPath: string,
) {
  await expect
    .poll(async () => {
      const messages = await sentMessages(webviewPage);
      return messages.filter((m) => m.command === "prefillPrompt").length;
    })
    .toBe(1);

  const messages = await sentMessages(webviewPage);
  const openFileIdx = messages.findIndex((m) => m.command === "openFile");
  const prefillIdx = messages.findIndex((m) => m.command === "prefillPrompt");
  expect(openFileIdx).toBeGreaterThanOrEqual(0);
  expect(prefillIdx).toBeGreaterThan(openFileIdx);
  // 打开的必须是 host 下发的绝对路径（宿主无法展开 `~`）
  expect(messages[openFileIdx].path).toBe(expectedPath);
  expect(messages[openFileIdx].path).not.toContain("~");
}

test.describe("设置页「编辑」打开的配置文件顺序（settings tab）", () => {
  test("钩子：openFile(host 回带 configPath) 先于 prefillPrompt", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage.getByRole("button", { name: "钩子" }).click();
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "hooksResponse",
        scope: "user",
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo hi" }],
            },
          ],
        },
        // host（CLI/SDK）解析出的绝对路径（见 getHookConfigPath）
        configPath: "/home/u/.wave/settings.json",
      });
    });

    await webviewPage.getByRole("button", { name: "编辑" }).first().click();

    await expectOpenFileBeforePrefill(
      webviewPage,
      "/home/u/.wave/settings.json",
    );
  });

  test("技能：openFile(SKILL.md) 先于 prefillPrompt", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage.getByRole("button", { name: "技能" }).click();
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "skillMetadataResponse",
        skills: [
          {
            name: "my-skill",
            description: "d",
            type: "personal",
            skillPath: "/home/u/.wave/skills/my-skill",
          },
        ],
      });
    });
    await webviewPage.getByRole("tab", { name: "用户技能" }).click();

    await webviewPage.getByRole("button", { name: "编辑" }).first().click();

    await expectOpenFileBeforePrefill(
      webviewPage,
      "/home/u/.wave/skills/my-skill/SKILL.md",
    );
  });

  test("子代理：openFile(agent markdown) 先于 prefillPrompt", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage.getByRole("button", { name: "子代理" }).click();
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "subagentConfigurationsResponse",
        configurations: [
          {
            name: "demo",
            description: "d",
            scope: "user",
            filePath: "/home/u/.wave/agents/demo.md",
            systemPrompt: "x",
          },
        ],
      });
    });
    await webviewPage.getByRole("tab", { name: "用户子代理" }).click();

    await webviewPage.getByRole("button", { name: "编辑" }).first().click();

    await expectOpenFileBeforePrefill(
      webviewPage,
      "/home/u/.wave/agents/demo.md",
    );
  });

  test("MCP 服务：openFile(host 回带 userPath) 先于 prefillPrompt", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage.getByRole("button", { name: "MCP 服务" }).click();
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "mcpServersResponse",
        servers: [
          {
            name: "github",
            config: { command: "npx" },
            scope: "user",
            status: "connected",
          },
        ],
      });
      window.simulateExtensionMessage({
        command: "mcpConfigPathsResponse",
        userPath: "/home/u/.wave/mcp.json",
        projectPath: "/work/a/.mcp.json",
      });
    });

    await webviewPage.getByRole("button", { name: "编辑" }).first().click();

    await expectOpenFileBeforePrefill(webviewPage, "/home/u/.wave/mcp.json");
  });
});
