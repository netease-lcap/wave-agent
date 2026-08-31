import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";
import type { McpServerStatus } from "wave-agent-sdk/dist/types/index.js";

const userServer: McpServerStatus = {
  name: "github",
  config: { command: "npx", args: ["@modelcontextprotocol/server-github"] },
  scope: "user",
  status: "disconnected",
};

const projectServer: McpServerStatus = {
  name: "project-db",
  config: { url: "http://localhost:3400/mcp" },
  scope: "project",
  status: "connected",
  toolCount: 3,
};

const pluginServer: McpServerStatus = {
  name: "plugin-tools",
  config: { command: "echo", args: ["plugin"] },
  scope: "plugin",
  status: "connected",
  toolCount: 1,
};

function renderSettingsPage(
  vscode?: { postMessage: (msg: unknown) => void },
  props?: { onPrefillPrompt?: (prompt: string) => void },
) {
  const mockVscode =
    vscode ||
    (createMockVscode() as unknown as { postMessage: (msg: unknown) => void });
  render(
    <SettingsPage
      configurationData={null}
      onSave={() => {}}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      onSaveAgentsContent={() => {}}
      initialNav="mcp"
      vscode={mockVscode}
      workdir="/work/a"
      onPrefillPrompt={props?.onPrefillPrompt}
    />,
  );
  return { vscode: mockVscode };
}

describe("SettingsPage MCP 服务选项卡视图（用户/项目/插件 Tab）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载时请求 getMcpServers + getMcpConfigPaths，并展示三个 Tab", async () => {
    const { vscode } = renderSettingsPage();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getMcpServers",
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getMcpConfigPaths",
    });

    sendHostMessage(
      fixtures.mcpServersResponse([userServer, projectServer, pluginServer]),
    );
    sendHostMessage(
      fixtures.mcpConfigPathsResponse("~/.wave/mcp.json", "/work/a/.mcp.json"),
    );

    expect(await screen.findByText("用户级 MCP")).toBeInTheDocument();
    expect(screen.getByText("项目级 MCP")).toBeInTheDocument();
    expect(screen.getByText("插件 MCP")).toBeInTheDocument();

    // 默认选中用户级 Tab：展示用户级服务器（command + args 拼接）
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(
      screen.getByText("npx @modelcontextprotocol/server-github"),
    ).toBeInTheDocument();
  });

  it("项目级 Tab 按项目分组卡片展示（+ 新增 MCP 服务）", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.mcpServersResponse([userServer, projectServer, pluginServer]),
    );
    sendHostMessage(
      fixtures.mcpConfigPathsResponse("~/.wave/mcp.json", "/work/a/.mcp.json"),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("项目级 MCP"));
    });
    expect(await screen.findByText("project-db")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3400/mcp")).toBeInTheDocument();
    // 项目卡片名 + 新增按钮
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增 MCP 服务/ }),
    ).toBeInTheDocument();
  });

  it("插件 MCP Tab 只读（无编辑/删除/新增）", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.mcpServersResponse([userServer, projectServer, pluginServer]),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("插件 MCP"));
    });
    expect(await screen.findByText("plugin-tools")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /删除/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /编辑/ }),
    ).not.toBeInTheDocument();
  });

  it("「连接」→ connectMcpServer RPC；已连接显示「断开」", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(
      fixtures.mcpServersResponse([userServer, projectServer, pluginServer]),
    );

    const connectBtn = await screen.findByRole("button", { name: "连接" });
    await act(async () => {
      fireEvent.click(connectBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "connectMcpServer",
      serverName: "github",
    });

    // 已连接的服务器显示「断开」
    await act(async () => {
      fireEvent.click(screen.getByText("项目级 MCP"));
    });
    const disconnectBtn = await screen.findByRole("button", { name: "断开" });
    await act(async () => {
      fireEvent.click(disconnectBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "disconnectMcpServer",
      serverName: "project-db",
    });
  });

  it("「新增用户级 MCP 服务」→ onPrefillPrompt 预填提示词", async () => {
    const onPrefillPrompt = vi.fn();
    renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.mcpServersResponse([userServer]));

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /新增用户级 MCP 服务/ }),
      );
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我配个用户级 MCP 服务器"),
    );
  });

  it("「编辑」→ 预填编辑提示词 + 打开对应配置文件", async () => {
    const onPrefillPrompt = vi.fn();
    const { vscode } = renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.mcpServersResponse([userServer]));
    sendHostMessage(
      fixtures.mcpConfigPathsResponse("~/.wave/mcp.json", "/work/a/.mcp.json"),
    );

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /编辑/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我编辑 MCP 服务器github"),
    );
    // 用户级 → 用户配置文件
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      path: "~/.wave/mcp.json",
    });
  });

  it("「删除」→ 二次确认 → removeMcpServer RPC（含 scope）", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.mcpServersResponse([userServer]));
    sendHostMessage(
      fixtures.mcpConfigPathsResponse("~/.wave/mcp.json", "/work/a/.mcp.json"),
    );

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /删除/ }));
    });

    expect(
      await screen.findByText("删除 MCP 服务「github」"),
    ).toBeInTheDocument();

    // 取消不删除
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "removeMcpServer" }),
    );

    // 再次打开并确认
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "removeMcpServer",
      scope: "user",
      serverName: "github",
    });
  });

  it("shows an empty state with a config-path hint", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.mcpServersResponse([]));
    expect(await screen.findByText("用户级 MCP暂无内容")).toBeInTheDocument();
    expect(
      screen.getByText("用户级配置存于 ~/.wave/mcp.json，全局可用"),
    ).toBeInTheDocument();
  });
});
