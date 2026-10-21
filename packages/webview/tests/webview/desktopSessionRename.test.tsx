import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));

/**
 * 会话重命名（spec desktop-sessions.md「会话重命名」）：入口是侧边栏会话行
 * 「⋯」菜单里的重命名，打开居中模态（预填当前名称并全选），保存即改写该行。
 * 会话树是宿主推送的快照，侧边栏行与会话看板卡片同源读取它。
 */
const session = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
});

function renderReady() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("setInitialState", { messages: [] });
  sendCommand("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "hello a"), session("s2", "hello b")],
      },
    ],
  });
  return vscode;
}

const renameCalls = (vscode: { postMessage: ReturnType<typeof vi.fn> }) =>
  vscode.postMessage.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m.command === "renameSession");

/** 从行菜单进入重命名弹窗，返回预填后的输入框与保存按钮。 */
function beginRename(sessionId: string) {
  fireEvent.click(screen.getByTestId(`desktop-session-more-${sessionId}`));
  fireEvent.click(screen.getByTestId("desktop-session-menu-rename"));
  return {
    input: screen.getByTestId("session-rename-input") as HTMLInputElement,
    save: screen.getByTestId("session-rename-save"),
  };
}

function replyRenamed(
  requestId: string,
  ok: boolean,
  error?: string,
  sessionId = "s1",
) {
  act(() => {
    sendCommand("sessionRenamed", {
      requestId,
      sessionId,
      title: "新标题",
      ok,
      error,
    });
  });
}

describe("会话重命名", () => {
  it("行菜单三项，顺序为并排打开 / 重命名 / 删除会话，重命名不用危险配色", () => {
    renderReady();

    fireEvent.click(screen.getByTestId("desktop-session-more-s1"));

    const items = screen
      .getByTestId("desktop-session-menu")
      .querySelectorAll(".desktop-session-menu-item");
    expect(Array.from(items).map((el) => el.textContent)).toEqual([
      "并排打开",
      "重命名",
      "删除会话",
    ]);
    // 危险配色只属于删除项。
    expect(items[1].className).not.toContain("--danger");
    expect(items[2].className).toContain("--danger");
  });

  it("激活重命名：打开居中模态，预填当前名称、自动聚焦并全选，列表不进入加载/禁用态", () => {
    renderReady();

    const { input } = beginRename("s1");

    expect(screen.getByTestId("session-rename-dialog")).toBeInTheDocument();
    expect(screen.getByText("重命名")).toBeInTheDocument();
    expect(input.value).toBe("hello a");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("hello a".length);
    // 列表照旧：其他行仍可见、仍可点（弹窗是覆盖层，不替换列表）。
    expect(screen.getByTestId("desktop-session-main-s2")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-session-main-s2")).toBeEnabled();
  });

  it("Enter 保存：行标题立即乐观更新，宿主确认后弹窗关闭，且只发一次 renameSession", async () => {
    const vscode = renderReady();
    const { input } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "改过的名字" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "改过的名字",
    );
    const calls = renameCalls(vscode);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "renameSession",
      sessionId: "s1",
      title: "改过的名字",
    });
    expect(typeof calls[0].requestId).toBe("string");

    // 宿主确认后才关弹窗（失败要留在弹窗里提示）。
    replyRenamed(calls[0].requestId as string, true);
    await waitFor(() =>
      expect(screen.queryByTestId("session-rename-dialog")).toBeNull(),
    );
  });

  it("点「保存」按钮同样生效", async () => {
    const vscode = renderReady();
    const { input, save } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "按钮保存" } });
    });
    fireEvent.click(save);

    const calls = renameCalls(vscode);
    expect(calls[0]).toMatchObject({ title: "按钮保存" });
    replyRenamed(calls[0].requestId as string, true);
    await waitFor(() =>
      expect(screen.queryByTestId("session-rename-dialog")).toBeNull(),
    );
  });

  it("Esc / 取消：关闭弹窗、标题不变、不发请求", () => {
    const vscode = renderReady();
    const { input } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "不要这个" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.queryByTestId("session-rename-dialog")).toBeNull();
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );

    // 重新打开走「取消」按钮这条路径。
    beginRename("s1");
    expect(screen.getByTestId("session-rename-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("session-rename-cancel"));
    expect(screen.queryByTestId("session-rename-dialog")).toBeNull();
    expect(renameCalls(vscode)).toHaveLength(0);
  });

  it("名称称为空（仅空格）：不予保存并提示「会话名称不能为空」，弹窗保持打开", () => {
    const vscode = renderReady();
    const { input } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("session-rename-error")).toHaveTextContent(
      "会话名称不能为空",
    );
    // 弹窗没关：用户可以直接接着改。
    expect(screen.getByTestId("session-rename-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );

    // 重新输入即清掉校验提示。
    act(() => {
      fireEvent.change(input, { target: { value: "有名字了" } });
    });
    expect(screen.queryByTestId("session-rename-error")).toBeNull();
  });

  it("输入法组合中的 Enter 不算保存", () => {
    const vscode = renderReady();
    const { input } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "中文输入中" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("session-rename-dialog")).toBeInTheDocument();
  });

  it("输入框拦住按键冒泡：不触发行上的裸键/行菜单快捷键", () => {
    renderReady();
    const { input } = beginRename("s1");

    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(esc);
    });

    expect(esc.defaultPrevented).toBe(true);
  });

  it("保存失败：回滚原标题，并在弹窗里给出宿主的失败原因", async () => {
    const vscode = renderReady();
    const { input } = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "写盘失败" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    replyRenamed(renameCalls(vscode)[0].requestId as string, false, "EACCES");

    // 失败提示必须可见（不得只有静默回滚）。
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("EACCES"),
    );
    // 失败不关弹窗：用户能在原地重试。
    expect(screen.getByTestId("session-rename-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );
  });

  it("乐观更新同时落到会话看板卡片", () => {
    const vscode = renderReady();
    // 侧边栏「活动」入口 → 看板与对话区互斥，侧边栏仍在。
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-card-s1")).toBeInTheDocument();

    const { input, save } = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "看板也变" } });
    });
    fireEvent.click(save);

    expect(screen.getByTestId("session-card-s1")).toHaveTextContent("看板也变");
    expect(renameCalls(vscode)).toHaveLength(1);
  });

  it("两个会话先后改名：各自的回复按 requestId 配对，先失败的那个回滚自己的标题", async () => {
    const vscode = renderReady();

    // 会话 s1 改名（回复尚未到达）。
    let { input, save } = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "甲" } });
    });
    fireEvent.click(save);
    const first = renameCalls(vscode)[0];

    // 在 s1 仍在途时给 s2 改名。
    ({ input, save } = beginRename("s2"));
    act(() => {
      fireEvent.change(input, { target: { value: "乙" } });
    });
    fireEvent.click(save);
    const second = renameCalls(vscode)[1];
    expect(renameCalls(vscode)).toHaveLength(2);

    // s2 成功：s2 保持新标题。
    replyRenamed(second.requestId as string, true, undefined, "s2");
    expect(screen.getByTestId("desktop-session-main-s2")).toHaveTextContent(
      "乙",
    );

    // s1 失败：必须回滚的是 s1（在途请求不得被后来的覆盖而吞掉这个回复）。
    replyRenamed(first.requestId as string, false, "EACCES", "s1");
    await waitFor(() =>
      expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
        "hello a",
      ),
    );
    expect(screen.getByTestId("desktop-session-main-s2")).toHaveTextContent(
      "乙",
    );
  });

  it("权威会话树刷新后清掉乐观覆盖（标题以宿主快照为准）", () => {
    const vscode = renderReady();
    const { input, save } = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "暂定名字" } });
    });
    fireEvent.click(save);
    replyRenamed(renameCalls(vscode)[0].requestId as string, true);

    // 宿主随后推送带新标题的权威快照 → 覆盖表清空、展示以快照为准。
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "/work/a",
          sessions: [session("s1", "宿主权威标题"), session("s2", "hello b")],
        },
      ],
    });

    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "宿主权威标题",
    );
  });

  it("分屏头部标题随宿主推送的新标题更新", () => {
    renderReady();
    // 宿主把 s1 绑到唯一分屏并推送当前会话。
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "s1", host: "local", row: 0 }],
      focusedPaneId: "pane-1",
    });
    sendCommand("updateCurrentSession", {
      session: {
        id: "s1",
        sessionType: "main",
        workdir: "/work/a",
        firstMessage: "hello a",
        lastActiveAt: new Date("2026-07-22T13:46:00Z"),
        latestTotalTokens: 0,
      },
    });
    expect(screen.getByTestId("chat-header")).toHaveTextContent("hello a");

    // 重命名成功后宿主把新标题推进该分屏（pushSessionTitle 契约）。
    sendCommand("updateCurrentSession", {
      session: {
        id: "s1",
        sessionType: "main",
        workdir: "/work/a",
        firstMessage: "hello a",
        customTitle: "改过的名字",
        lastActiveAt: new Date("2026-07-22T13:46:00Z"),
        latestTotalTokens: 0,
      },
    });

    expect(screen.getByTestId("chat-header")).toHaveTextContent("改过的名字");
  });
});
