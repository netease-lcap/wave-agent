import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import {
  openSettings,
  simulateHostMessage,
  waitForSentCommand,
} from "../e2e/utils/settingsHarness.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * 设置页「MCP 服务」截图与态验证（spec ecosystem/mcp）。
 *
 * `/mcp` 不再唤起聊天区弹窗（2026-08-29 起改为打开设置页并选中本选项卡），
 * 旧的 `McpDialog` 已删除；因此这里走 settings.js 独立 bundle（settingsHarness），
 * 而不是 chat bundle 的 `showDialog(mcp)`。截图文件名沿用 `spec-mcp-server-tab`，
 * docs/vsce.md 的插图不做改动。
 */

const SERVERS = [
  {
    name: "jira",
    scope: "user",
    config: { command: "npx", args: ["-y", "@mcp/server-jira"] },
    status: "connected",
    toolCount: 8,
    capabilities: ["tools"],
    lastConnected: Date.now() - 60_000,
  },
  {
    name: "postgres",
    scope: "user",
    config: {
      command: "uvx",
      args: [
        "mcp-server-postgres",
        "--connection-string",
        "postgresql://localhost:5432/nebula",
      ],
    },
    status: "error",
    toolCount: 0,
    error: "Authentication failed: invalid token",
    capabilities: ["tools"],
  },
  {
    // 本轮还没拨号（按需连接）：工具列表来自本机快照，界面标明来源
    name: "ddg-search",
    scope: "user",
    config: { command: "uvx", args: ["duckduckgo-mcp-server"] },
    status: "disconnected",
    toolCount: 0,
    toolsFromCache: [{ name: "search" }, { name: "fetch_content" }],
    toolsCachedAt: Date.now() - 3_600_000,
    capabilities: ["tools"],
  },
];

test.describe("MCP 服务设置页 Demo", () => {
  test("shows configured servers, statuses and the cached-tools hint", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { settingsState: { nav: "mcp" } });
    await expect(
      webviewPage.getByRole("heading", { name: "MCP 服务" }),
    ).toBeVisible();

    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: SERVERS,
    });

    await expect(webviewPage.getByText("jira", { exact: true })).toBeVisible();
    await expect(webviewPage.getByText("8 tools")).toBeVisible();
    await expect(
      webviewPage.getByText("Authentication failed: invalid token"),
    ).toBeVisible();
    // 连接（未连接/出错）与断开（已连接）两种动作各有一个
    await expect(
      webviewPage.getByRole("button", { name: "连接" }).first(),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("button", { name: "断开" }).first(),
    ).toBeVisible();
    // 未拨号的服务器展示上次的工具快照，并标明不是实时结果
    await expect(webviewPage.getByText("2 tools")).toBeVisible();
    await expect(webviewPage.getByText(/工具来自缓存/)).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-mcp-server-tab.webp",
    );
  });

  test("shows the empty state for a scope without servers", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { settingsState: { nav: "mcp" } });

    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: [],
    });

    await expect(webviewPage.getByText("用户级 MCP暂无内容")).toBeVisible();
    await expect(
      webviewPage.getByText(/用户级配置存于 ~\/\.wave\/mcp\.json/),
    ).toBeVisible();
  });

  test("connect button asks the host and the row follows the new status", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { settingsState: { nav: "mcp" } });

    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: [
        {
          name: "jira",
          scope: "user",
          config: { command: "npx", args: ["-y", "@mcp/server-jira"] },
          status: "disconnected",
          toolCount: 0,
          capabilities: [],
        },
      ],
    });

    await webviewPage.getByRole("button", { name: "连接" }).click();
    const request = await waitForSentCommand(webviewPage, "connectMcpServer");
    expect(request.serverName).toBe("jira");

    // host 拨号成功后推回新状态
    await simulateHostMessage(webviewPage, {
      command: "mcpServersResponse",
      servers: [
        {
          name: "jira",
          scope: "user",
          config: { command: "npx", args: ["-y", "@mcp/server-jira"] },
          status: "connected",
          toolCount: 5,
          capabilities: ["tools"],
          lastConnected: Date.now(),
        },
      ],
    });

    await expect(
      webviewPage.getByRole("button", { name: "断开" }),
    ).toBeVisible();
    await expect(webviewPage.getByText("5 tools")).toBeVisible();
  });
});
