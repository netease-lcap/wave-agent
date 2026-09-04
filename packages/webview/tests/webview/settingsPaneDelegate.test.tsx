import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
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

// Split view 下每个 pane 有自己的输入框——用 within(pane 容器) 定位目标 pane。
function paneInput(paneId: string): HTMLElement {
  return within(screen.getByTestId(`desktop-pane-${paneId}`)).getByTestId(
    "message-input",
  );
}

async function typeInPane(paneId: string, text: string) {
  const input = paneInput(paneId);
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

// spec docs/specs/ecosystem/mcp.md「新增/编辑 MCP」：设置页点「+ 新增 MCP 服务」后
// 关闭设置页、把 /settings 提示词预填进 focused 对话输入框。Bug 3466212216530432
// 根因：FR-032 pane 布局下设置页挂在 root 实例（paneId undefined）而输入框在各
// pane-scoped ChatApp——root 的 messageInputRef 恒 null，open 方向委托
// （onOpenSettingsFromPane）已实现、close/prefill 反向缺失 → 提示词被 root 静默
// 丢弃。修复 = root 捕获点击瞬间 focusedPaneId 作 targetPaneId，请求经 DesktopShell
// 下行给匹配 pane 的 ChatApp，输入框就绪后 loadDraft + 回调清除。
describe("desktop pane 布局：设置页「新增/编辑」提示词预填进 focused 对话输入框", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pane-1（focused）开 MCP 设置点项目级「新增 MCP 服务」→ /settings 提示词写入 pane-1 输入框", async () => {
    render(
      <ChatApp
        vscode={createMockVscode() as unknown as VsCodeApi}
        host={desktopHost([{ paneId: "pane-1" }, { paneId: "pane-2" }])}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    // pane-1（focused）输入 /mcp → 委托 root 打开设置页「MCP 服务」选项卡
    await typeInPane("pane-1", "/mcp");
    // SettingsTabs 的 Tab 是 role="tab"（非 button）
    expect(
      await screen.findByRole("tab", { name: /项目级 MCP/ }),
    ).toBeInTheDocument();

    // 切到项目级 Tab，点「新增 MCP 服务」→ 关设置页并预填项目级 /settings 提示词
    await act(async () => {
      fireEvent.click(await screen.findByRole("tab", { name: /项目级 MCP/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /新增 MCP 服务/ }));
    });

    // 设置页关闭 → pane 行重挂载（ChatApp 状态复位，输入框未就绪）。宿主收到
    // webviewReady 后回放 snapshot——此处模拟：authStatusResponse 置 initialized，
    // 输入框挂载后下行请求才真正 loadDraft（此前保持 pending 不清除）。
    sendHostMessage(fixtures.authStatusResponse());

    await waitFor(() => {
      expect(paneInput("pane-1").textContent ?? "").toMatch(
        /^\/settings 帮我在/,
      );
    });
    // 非目标 pane（pane-2）不受影响
    expect(paneInput("pane-2").textContent ?? "").not.toContain("/settings");
  });

  it("无 pane 单布局回归：新增用户级 MCP 服务 → 提示词写入本实例输入框", async () => {
    render(
      <ChatApp
        vscode={createMockVscode() as unknown as VsCodeApi}
        host={desktopHost([])}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());

    await typeAndSend("/mcp");
    const addUserServerBtn = await screen.findByRole("button", {
      name: /新增用户级 MCP 服务/,
    });
    await act(async () => {
      fireEvent.click(addUserServerBtn);
    });

    // 关设置页后本实例（root，无 pane）chatContainer 重挂载 → 本地输入框写入
    await waitFor(() => {
      expect(screen.getByTestId("message-input").textContent ?? "").toMatch(
        /^\/settings 帮我配个用户级/,
      );
    });
  });
});
