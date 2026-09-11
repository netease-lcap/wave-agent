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

// 与 settingsPaneDelegate.test.tsx 同构的 desktop host props。
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

describe("桌面端主题偏好同步（ChatApp host 消息链路）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("host 广播 desktopThemeSource 后设置页主题行即时同步（命令拼写契约锁定）", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    // authStatusResponse 挂载聊天容器后快照就绪；窗口级偏好只走未打标签广播，
    // 快照本身不携带 theme（回归锁：曾经「快照 + 广播」双通道正是重启后回落的根因）
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());
    await openSettings();
    expect((screen.getByLabelText("主题") as HTMLSelectElement).value).toBe(
      "system",
    );

    act(() => {
      sendHostMessage({ command: "desktopThemeSource", source: "dark" });
    });

    await waitFor(() => {
      expect((screen.getByLabelText("主题") as HTMLSelectElement).value).toBe(
        "dark",
      );
    });
    // 偏好选择不触发向 host 的请求（广播来自 host 本身）
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "setThemeSource" }),
    );
  });
});
