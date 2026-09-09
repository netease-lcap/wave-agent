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

// 与 settingsPaneDelegate.test.tsx 同构的 desktop host props（root 实例）。
function desktopHost() {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: ["/work/a"],
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

/** 进入个性化视图并把作用域切到「项目级」。 */
async function openProjectTab() {
  fireEvent.click(screen.getByRole("button", { name: "个性化" }));
  const tab = await screen.findByRole("tab", { name: "项目级" });
  fireEvent.click(tab);
  await screen.findByLabelText("项目级 AGENTS.md 内容");
}

/** mockVscode.postMessage 中 getAgentsContent(project) 的发出次数。 */
function projectRequests(mockVscode: ReturnType<typeof createMockVscode>) {
  return mockVscode.postMessage.mock.calls.filter(
    ([msg]) =>
      (msg as { command?: string }).command === "getAgentsContent" &&
      (msg as { scope?: string }).scope === "project",
  );
}

/**
 * Bug 回归：desktop 设置页「个性化」项目级 AGENTS.md 编辑器。
 *
 * 根因 1（读回旧值）：AGENTS.md 内容缓存在 root ChatApp state，只在值为 null
 * 时（设置页首次挂载）才向 host 请求——保存后关闭再打开设置页不重新读取磁盘，
 * 一直显示上一次加载的快照。修复：每次打开设置页重置缓存为 null，设置页挂载
 * 后按需重新读取（项目级在「项目级」tab 首次激活时读取）。
 *
 * 根因 2（不随项目切换）：同一缓存与「当前项目」解耦——切换项目/会话后重开
 * 设置页仍显示上一个项目那份文件。与根因 1 同一修复点（逐次打开按当前项目
 * 重读；workdir 归属由 desktopHost 按聚焦 pane 解析，见 desktopHost.test）。
 */
describe("desktop 设置页「个性化」项目级 AGENTS.md 随项目切换刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("保存后关闭再打开设置页会重新拉取项目级内容并显示磁盘新值", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    // Root 单实例就绪（非 desktopPanes 路由——host 消息保持 untagged 直达 root）。
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());

    // 第一次打开：进入 项目级 tab → host 拉取 → 回包落盘快照 A
    await openSettings();
    await openProjectTab();
    expect(projectRequests(mockVscode)).toHaveLength(1);
    act(() => {
      sendHostMessage({
        command: "agentsContentResponse",
        scope: "project",
        content: "# 版本 A",
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 版本 A");
    });

    // 关闭设置页（等同客户「关掉」）。设置页全页打开期间 DesktopShell 卸载了
    // pane 的 ChatApp；关闭后重挂载需宿主重推 auth 快照才会进入 welcome 态并
    // 挂载输入框（真实 desktopHost 对重挂载 pane 的 webviewReady 会回放快照，
    // 这里手动补推 authStatusResponse 以模拟宿主）。
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    sendHostMessage(fixtures.authStatusResponse());
    await screen.findByTestId("message-input");

    // 磁盘已更新（模拟保存成功后的文件新值）；再次打开设置页
    await openSettings();
    await openProjectTab();

    // 修复前：projectAgentsContent 缓存未重置（仍非 null）→ 不重新请求，
    // 文本区继续显示旧快照「# 版本 A」——此处 count 仍为 1，测试先红。
    expect(projectRequests(mockVscode)).toHaveLength(2);
    // host 回发磁盘新值（当前项目文件）
    act(() => {
      sendHostMessage({
        command: "agentsContentResponse",
        scope: "project",
        content: "# 版本 B",
      });
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 版本 B");
    });
  });
});
