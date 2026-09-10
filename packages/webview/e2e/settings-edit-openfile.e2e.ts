import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

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

type SentMessage = { command?: string; path?: string; prompt?: string };

function sentMessages(webviewPage: Page) {
  return sentToHost<SentMessage>(webviewPage);
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
    await simulateHostMessage(webviewPage, {
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
    await simulateHostMessage(webviewPage, {
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
    await simulateHostMessage(webviewPage, {
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
    await simulateHostMessage(webviewPage, {
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
    await simulateHostMessage(webviewPage, {
      command: "mcpConfigPathsResponse",
      userPath: "/home/u/.wave/mcp.json",
      projectPath: "/work/a/.mcp.json",
    });

    await webviewPage.getByRole("button", { name: "编辑" }).first().click();

    await expectOpenFileBeforePrefill(webviewPage, "/home/u/.wave/mcp.json");
  });
});
