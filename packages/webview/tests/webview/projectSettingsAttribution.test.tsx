import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
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

/**
 * Bug 回归（客户反馈 Windows 桌面端，与 PR #2152 AGENTS.md 同族）：两个项目各
 * 有对话，用户聚焦第二个项目的会话后进设置，「项目设置」的 SDD 开关仍显示第一个
 * 项目的值。
 *
 * 根因：设置全页挂在 root 实例（无自己会话），其「当前项目」由 effectiveWorkdir
 * 推导 = `state.workdir ?? recentWorkdirs[0] ?? host.workdir`——recents 头优先于
 * host.workdir。该回退是为「新会话 pane 不得渗入兄弟 pane 路径」写的；但 recents
 * 头 ≠ 用户当前聚焦的会话项目（恢复会话不写 recents），于是 host 按聚焦 pane 解析
 * 并回发的项目设置（workdir=当前项目）被 ChatApp 归属守卫当成「过期项目」丢弃，
 * SettingsPage 又以同一错误 workdir 信任并继续显示上一项目的快照。root 的「当前
 * 项目」应以 host 推送的聚焦 pane workdir（desktopWorkdirState.workdir）为准。
 */
describe("desktop 设置页「项目设置」SDD 开关随聚焦会话的项目切换", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUi.prune(new Set());
  });

  it("recents 头为项目 A 而聚焦会话已切到项目 B 时，开关显示 B 而非 A 的旧快照", async () => {
    const mockVscode = createMockVscode();
    const host = {
      ...desktopHost(),
      recentWorkdirs: ["/work/a"],
    } as unknown as React.ComponentProps<typeof ChatApp>["host"];
    const renderHost = (overrides: { workdir?: string }) =>
      ({
        ...host,
        ...overrides,
      }) as unknown as React.ComponentProps<typeof ChatApp>["host"];
    const { rerender } = render(
      <ChatApp vscode={mockVscode as unknown as VsCodeApi} host={host} />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    // 首次进入设置时聚焦项目 A 会话（host.workdir=/work/a）：加载 A 的启用快照
    await openProjectSettingsView();
    expect(mockVscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getProjectSettings" }),
    );
    act(() => {
      sendHostMessage({
        command: "projectSettings",
        workdir: "/work/a",
        enabledPlugins: { "sdd@builtin": true },
      });
    });
    expect(sddToggle().disabled).toBe(false);
    expect(sddToggle().checked).toBe(true);

    // 关闭设置，聚焦切到项目 B 的会话：host 推送 workdir=/work/b（recents 头
    // 不变——恢复历史会话不写 recents，见 desktopHost activateAgentInPane 注释）。
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    rerender(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={renderHost({ workdir: "/work/b" })}
      />,
    );
    // 设置页关闭期间 pane ChatApp 重挂载，需宿主重推 auth 快照才有输入框
    // （与 settingsAgentsProjectSwitch.test.tsx 同因）。
    sendHostMessage(fixtures.authStatusResponse());
    await screen.findByTestId("message-input");

    // 重开设置进入项目设置：host 按聚焦 pane 解析到项目 B，回包 workdir=/work/b
    // （项目 B 未启用 SDD）。
    await openProjectSettingsView();
    act(() => {
      sendHostMessage({
        command: "projectSettings",
        workdir: "/work/b",
        enabledPlugins: {},
      });
    });
    // 修复前：root 以 recents 头（/work/a）充当「当前项目」→ B 回包被归属守卫
    // 丢弃，开关继续显示项目 A 旧快照（勾选 + 启用），断言先红。修复后：root 以
    // host.workdir（聚焦 pane 的 /work/b）为当前项目，B 回包生效 → 开关未勾选。
    await waitFor(() => {
      expect(sddToggle().disabled).toBe(false);
      expect(sddToggle().checked).toBe(false);
    });
  });
});
