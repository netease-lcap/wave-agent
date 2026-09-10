import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

/**
 * Regression（设置页删除后列表整段空白，Bug #2092）：
 *
 * 四个管理视图（技能 / 子代理 / 钩子 / MCP 服务）的删除是「二次确认 + 直接删
 * 配置」，删完必须把**剩余条目**渲染出来。曾经出现「确认删除后列表整段空白」：
 * host 回了新列表但视图没有写回（或写回时用了空值），用户须重进设置页才看到
 * 真实列表。本文件驱动真实 settings.js bundle 跑完整链路
 * 「点删除 → 确认框 → 点确认 → 发出 deleteXxx → host 回发新列表 → 剩余条目
 * 仍在、空态占位不出现」，四个视图各一例。
 */

/** 列表行（.mcp-server-item）按名称定位后取其「删除」按钮。 */
function rowDeleteButton(webviewPage: Page, name: string) {
  return webviewPage
    .locator(".mcp-server-item")
    .filter({
      has: webviewPage.locator(".mcp-server-name", { hasText: name }),
    })
    .getByRole("button", { name: "删除" });
}

/** 断言确认框标题并点「确认删除」（调用前应已点过该行的「删除」）。 */
async function confirmDelete(webviewPage: Page, expectedTitle: string) {
  const dialog = webviewPage.getByTestId("confirm-dialog-overlay");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".confirm-dialog-title")).toHaveText(
    expectedTitle,
  );
  await webviewPage.getByTestId("confirm-dialog-confirm").click();
  await expect(dialog).toHaveCount(0);
}

/** 断言 host 收到的消息里存在（且含指定字段的）某条命令。 */
async function expectSentMessage(
  webviewPage: Page,
  expected: Record<string, unknown>,
) {
  await expect
    .poll(async () => {
      const messages = await sentToHost(webviewPage);
      return messages.some((m) =>
        Object.entries(expected).every(([k, v]) => m[k] === v),
      );
    })
    .toBe(true);
}

/** 断言「剩余条目仍在、空态占位不出现」——即删除后列表没有整段空白。 */
async function expectListNotBlank(
  webviewPage: Page,
  remainingName: string,
  emptyStateText: string,
) {
  await expect(
    webviewPage.getByText(remainingName, { exact: true }),
  ).toBeVisible();
  await expect(webviewPage.getByText(emptyStateText)).toHaveCount(0);
}

test.describe("设置页四视图删除后列表不空白（settings tab）", () => {
  test("技能：确认删除后 host 回新列表，剩余技能仍渲染", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "技能", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "skillMetadataResponse",
      skills: [
        {
          name: "skill-a",
          description: "a",
          type: "personal",
          skillPath: "/home/u/.wave/skills/skill-a",
        },
        {
          name: "skill-b",
          description: "b",
          type: "personal",
          skillPath: "/home/u/.wave/skills/skill-b",
        },
      ],
    });
    await webviewPage.getByRole("tab", { name: "用户技能" }).click();
    await expect(
      webviewPage.getByText("skill-a", { exact: true }),
    ).toBeVisible();

    await rowDeleteButton(webviewPage, "skill-a").click();
    await confirmDelete(webviewPage, "删除技能「skill-a」");

    // webview → host：删除请求 + 立即重新拉取列表（删除后刷新）
    await expectSentMessage(webviewPage, {
      command: "deleteSkill",
      name: "skill-a",
    });
    await expect
      .poll(async () => {
        const messages = await sentToHost(webviewPage);
        return messages.filter((m) => m.command === "getSkillMetadata").length;
      })
      .toBeGreaterThanOrEqual(2);

    // host 回发删除后的新列表
    await simulateHostMessage(webviewPage, {
      command: "skillMetadataResponse",
      skills: [
        {
          name: "skill-b",
          description: "b",
          type: "personal",
          skillPath: "/home/u/.wave/skills/skill-b",
        },
      ],
    });

    await expect(webviewPage.getByText("skill-a", { exact: true })).toHaveCount(
      0,
    );
    await expectListNotBlank(webviewPage, "skill-b", "用户技能暂无内容");
  });

  test("子代理：确认删除后 host 回新列表，剩余子代理仍渲染", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "子代理", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "subagentConfigurationsResponse",
      configurations: [
        {
          name: "agent-a",
          description: "a",
          scope: "user",
          filePath: "/home/u/.wave/agents/agent-a.md",
          systemPrompt: "x",
        },
        {
          name: "agent-b",
          description: "b",
          scope: "user",
          filePath: "/home/u/.wave/agents/agent-b.md",
          systemPrompt: "y",
        },
      ],
    });
    await webviewPage.getByRole("tab", { name: "用户子代理" }).click();
    await expect(
      webviewPage.getByText("agent-a", { exact: true }),
    ).toBeVisible();

    await rowDeleteButton(webviewPage, "agent-a").click();
    await confirmDelete(webviewPage, "删除子代理「agent-a」");

    await expectSentMessage(webviewPage, {
      command: "deleteSubagent",
      name: "agent-a",
    });
    await expect
      .poll(async () => {
        const messages = await sentToHost(webviewPage);
        return messages.filter((m) => m.command === "getSubagentConfigurations")
          .length;
      })
      .toBeGreaterThanOrEqual(2);

    await simulateHostMessage(webviewPage, {
      command: "subagentConfigurationsResponse",
      configurations: [
        {
          name: "agent-b",
          description: "b",
          scope: "user",
          filePath: "/home/u/.wave/agents/agent-b.md",
          systemPrompt: "y",
        },
      ],
    });

    await expect(webviewPage.getByText("agent-a", { exact: true })).toHaveCount(
      0,
    );
    await expectListNotBlank(webviewPage, "agent-b", "用户子代理暂无内容");
  });

  test("钩子：确认删除后乐观移除，host 回新列表仍不空白", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "钩子", exact: true })
      .click();
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
        PostToolUse: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "echo bye" }],
          },
        ],
      },
      configPath: "/home/u/.wave/settings.json",
    });
    await expect(
      webviewPage.getByText("PreToolUse:Bash", { exact: true }),
    ).toBeVisible();

    await rowDeleteButton(webviewPage, "PreToolUse:Bash").click();
    await confirmDelete(webviewPage, "删除钩子「PreToolUse:Bash」");

    await expectSentMessage(webviewPage, {
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse:Bash",
    });
    // 乐观移除：不等 host 回包，被删钩子先消失
    await expect(
      webviewPage.getByText("PreToolUse:Bash", { exact: true }),
    ).toHaveCount(0);

    await simulateHostMessage(webviewPage, {
      command: "hooksResponse",
      scope: "user",
      hooks: {
        PostToolUse: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "echo bye" }],
          },
        ],
      },
      configPath: "/home/u/.wave/settings.json",
    });

    await expectListNotBlank(
      webviewPage,
      "PostToolUse:Write",
      "用户级钩子暂无内容",
    );
  });

  test("MCP 服务：确认删除后乐观移除，host 回新列表仍不空白", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "MCP 服务", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: [
        {
          name: "mcp-a",
          scope: "user",
          status: "connected",
          config: { command: "npx" },
        },
        {
          name: "mcp-b",
          scope: "user",
          status: "connected",
          config: { command: "npx" },
        },
      ],
    });
    await simulateHostMessage(webviewPage, {
      command: "mcpConfigPathsResponse",
      userPath: "/home/u/.wave/mcp.json",
      projectPath: "/work/a/.mcp.json",
    });
    await expect(webviewPage.getByText("mcp-a", { exact: true })).toBeVisible();

    await rowDeleteButton(webviewPage, "mcp-a").click();
    await confirmDelete(webviewPage, "删除 MCP 服务「mcp-a」");

    await expectSentMessage(webviewPage, {
      command: "removeMcpServer",
      scope: "user",
      serverName: "mcp-a",
    });
    await expect(webviewPage.getByText("mcp-a", { exact: true })).toHaveCount(
      0,
    );

    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: [
        {
          name: "mcp-b",
          scope: "user",
          status: "connected",
          config: { command: "npx" },
        },
      ],
    });

    await expectListNotBlank(webviewPage, "mcp-b", "用户级 MCP暂无内容");
  });
});
