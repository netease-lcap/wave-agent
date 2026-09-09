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
import React from "react";
import { ChatApp } from "../../src/components/ChatApp";
import { sessionUi } from "../../src/utils/sessionUiStore";
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

/** 打开设置页（/config → 根实例 settingsOpen）并进入「项目设置」视图。 */
async function openProjectSettingsView() {
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
  fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
  await screen.findByRole("heading", { name: "项目设置" });
}

function sddToggle(): HTMLInputElement {
  return screen.getByLabelText("启用 SDD 插件") as HTMLInputElement;
}

/**
 * projectSettings 回复归属契约（webview-fixtures ReplyAttribution: projectSettings
 * → workdir）：host 回带请求所用 workdir，ChatApp 过期即弃 + SessionUiStore
 * 按 workdir 键控缓存；reducer 只留镜像（a3043966「到达时盖章」土办法迁出）。
 */
describe("projectSettings 回复归属（过期即弃 + workdir 键控）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUi.prune(new Set());
  });

  it("归属目录不匹配的慢回复被丢弃，不回显为当前项目状态、不进缓存", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    // 当前活动目录 /work/a
    sendHostMessage(fixtures.setInitialState({ workdir: "/work/a" }));
    await openProjectSettingsView();

    // 进入视图触发 getProjectSettings 拉取
    expect(mockVscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getProjectSettings" }),
    );

    // 切目录后才落地的慢回复（数据属 /work/b）→ 丢弃：开关按未加载处理
    // （修复前：到达时按当前目录 /work/a 盖章 → 开关错误回显 /work/b 的开）
    act(() => {
      sendHostMessage({
        command: "projectSettings",
        workdir: "/work/b",
        enabledPlugins: { "sdd@builtin": true },
      });
    });
    expect(sddToggle().disabled).toBe(true);
    expect(sddToggle().checked).toBe(false);
    expect(sessionUi.getProjectSettings("/work/b")).toBeUndefined();

    // 归属当前目录的回复正常生效：镜像 + 键控缓存双写
    act(() => {
      sendHostMessage({
        command: "projectSettings",
        workdir: "/work/a",
        enabledPlugins: { "sdd@builtin": true },
      });
    });
    expect(sddToggle().disabled).toBe(false);
    expect(sddToggle().checked).toBe(true);
    expect(sessionUi.getProjectSettings("/work/a")).toEqual({
      enabledPlugins: { "sdd@builtin": true },
    });
  });

  it("归属目录匹配时镜像与缓存一致（SET_PROJECT_SETTINGS payload 用回包自带 workdir）", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ workdir: "/work/a" }));
    await openProjectSettingsView();

    act(() => {
      sendHostMessage({
        command: "projectSettings",
        workdir: "/work/a",
        enabledPlugins: {},
      });
    });
    // 未启用 = 缓存写入但开关保持关闭且可用
    expect(sddToggle().disabled).toBe(false);
    expect(sddToggle().checked).toBe(false);
    expect(sessionUi.getProjectSettings("/work/a")).toEqual({
      enabledPlugins: {},
    });
  });
});
