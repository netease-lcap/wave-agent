import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import React from "react";
import { ChatApp } from "../../src/components/ChatApp";
import type { VsCodeApi } from "../../src/types";

// Desktop host props，与 model-status-login-commands.test.tsx 的 desktop 用例保持一致。
function desktopHost(
  panes: Array<{ paneId: string }> = [{ paneId: "pane-1" }],
) {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: [],
    workdir: "/work/a",
    sessionTree: [],
    panes,
    focusedPaneId: "pane-1",
    onSelectWorkdir: () => {},
    onSelectRecentWorkdir: () => {},
    onRemoveRecentWorkdir: () => {},
    onSelectHost: () => {},
    onAddHost: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: text, inputType: "insertText" });
  });
  fireEvent.keyDown(input, { key: "Enter" });
}

// spec agent-config.md 场景 5：桌面端 pane 布局（单 pane 或多 pane，desktopPanes
// 推送后）下，任一对话输入 /config、/agents、/skills、/mcp 必须打开设置页并选中
// 对应选项卡。根因回归：pane-scoped ChatApp 的渲染分支只输出 chatContainer，设置
// 视图由根实例的 DesktopShell 渲染——命令必须委托根实例，否则 settingsOpen 变成
// 孤儿 state，输入命令「没反应」（新对话时 desktopPanes 尚未推送、webview 走单
// pane 布局所以正常，发过消息后失效）。
describe("desktop pane 布局斜杠命令打开设置页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/config 委托根实例（nav undefined），本实例不渲染设置页", async () => {
    const onOpenSettingsFromPane = vi.fn();
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
        paneId="pane-1"
        onOpenSettingsFromPane={onOpenSettingsFromPane}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    await act(async () => {
      await typeAndSend("/config");
    });

    await waitFor(() => {
      expect(onOpenSettingsFromPane).toHaveBeenCalledTimes(1);
    });
    expect(onOpenSettingsFromPane).toHaveBeenCalledWith(undefined);
    // 本实例不渲染设置视图（由根实例 DesktopShell 渲染），也不走 IDE 的 openSettings
    expect(
      screen.queryByText("管理 Wave 的界面、模型和基础行为。"),
    ).not.toBeInTheDocument();
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "openSettings" }),
    );
  });

  it.each([
    ["/agents", "subagents"],
    ["/skills", "skills"],
    ["/mcp", "mcp"],
  ])("%s 委托根实例并携带 nav=%s", async (command, nav) => {
    const onOpenSettingsFromPane = vi.fn();
    render(
      <ChatApp
        vscode={createMockVscode() as unknown as VsCodeApi}
        host={desktopHost()}
        paneId="pane-1"
        onOpenSettingsFromPane={onOpenSettingsFromPane}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    await act(async () => {
      await typeAndSend(command);
    });

    await waitFor(() => {
      expect(onOpenSettingsFromPane).toHaveBeenCalledWith(nav);
    });
  });

  it("完整链路：pane 内 /config 委托根实例后设置页全页渲染", async () => {
    // 顶层 ChatApp（无 paneId）渲染 DesktopShell；pane-scoped ChatApp 收到
    // onOpenSettingsFromPane=根实例 handleOpenSettings。输入 /config 后设置页
    // 由根实例渲染，取代 pane 视图。
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    await act(async () => {
      await typeAndSend("/config");
    });

    // 设置页「全局设置」选项卡激活（导航项 is-active 且内容区可见）
    expect(
      await screen.findByText("管理 Wave 的界面、模型和基础行为。"),
    ).toBeInTheDocument();
    const navItem = screen.getByRole("button", { name: /全局设置/ });
    expect(navItem).toHaveClass("is-active");
  });
});
