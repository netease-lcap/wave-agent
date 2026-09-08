import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import React from "react";
import { ChatApp } from "../../src/components/ChatApp";
import type { VsCodeApi } from "../../src/types";

// 与 desktopThemeSource.test.tsx 同构的 desktop host props。
function desktopHost() {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: [],
    workdir: "/work/a",
    sessionTree: [],
    panes: [{ paneId: "pane-1" }],
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

/** 打开设置页（/config → 根实例 settingsOpen → 全局设置视图）。 */
async function openSettings() {
  const input = await screen.findByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = "/config";
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: "/config", inputType: "insertText" });
  });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("管理 CodeWave IDE 的界面、模型和基础行为。");
}

const SERVER = "https://codechat.example.com";

describe("桌面端「接收 Beta 版更新」开关（ChatApp host 消息链路）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setInitialState 快照携带 updateChannel=beta 且已登录时，开关打开可切换", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(
      fixtures.setInitialState({
        updateChannel: "beta",
        configurationData: { serverUrl: SERVER },
      }),
    );

    await openSettings();

    const toggle = screen.getByLabelText(
      "接收 Beta 版更新",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
  });

  it("未登录（无 serverUrl）时开关置灰并说明「登录后可接收测试版更新」", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ updateChannel: "stable" }));

    await openSettings();

    const toggle = screen.getByLabelText(
      "接收 Beta 版更新",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText("登录后可接收测试版更新")).toBeTruthy();
    // 置灰不可切换：点击不产生任何 host 请求
    fireEvent.click(toggle);
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "setUpdateChannel" }),
    );
  });

  it("已登录勾选开关 → 乐观选中并上送 setUpdateChannel beta", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(
      fixtures.setInitialState({
        updateChannel: "stable",
        configurationData: { serverUrl: SERVER },
      }),
    );

    await openSettings();

    const toggle = screen.getByLabelText(
      "接收 Beta 版更新",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(mockVscode.postMessage).toHaveBeenCalledWith({
      command: "setUpdateChannel",
      channel: "beta",
    });
  });

  it("host 广播 desktopUpdateChannel 后开关即时同步（命令拼写契约锁定）", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ updateChannel: "stable" }));

    await openSettings();
    const toggle = screen.getByLabelText(
      "接收 Beta 版更新",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    act(() => {
      sendHostMessage({ command: "desktopUpdateChannel", channel: "beta" });
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText("接收 Beta 版更新") as HTMLInputElement).checked,
      ).toBe(true);
    });
    // 广播来自 host 本身，设置页不得再向 host 请求 setUpdateChannel
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "setUpdateChannel" }),
    );
  });
});
