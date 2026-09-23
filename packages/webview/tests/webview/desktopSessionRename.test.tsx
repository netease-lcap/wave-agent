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
 * 侧边栏行内重命名（spec desktop-sessions.md「会话重命名（侧边栏行内编辑）」
 * 场景 1–10）。会话树是宿主推送的快照，侧边栏行与会话看板卡片同源读取它。
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

/** 从行菜单进入该会话的行内编辑态。 */
function beginRename(sessionId: string) {
  fireEvent.click(screen.getByTestId(`desktop-session-more-${sessionId}`));
  fireEvent.click(screen.getByTestId("desktop-session-menu-rename"));
  return screen.getByTestId(
    `desktop-session-rename-input-${sessionId}`,
  ) as HTMLInputElement;
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

describe("会话重命名 · 侧边栏行内编辑", () => {
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
    // 危险配色只属于删除项（场景 1）。
    expect(items[1].className).not.toContain("--danger");
    expect(items[2].className).toContain("--danger");
  });

  it("激活重命名：标题被行内输入框就地顶掉，自动聚焦且内容全选，列表不进入加载/骨架态", () => {
    renderReady();

    const input = beginRename("s1");

    // 就地顶掉标题位（不是模态对话框）：该行的标题按钮消失、输入框出现。
    expect(
      screen.queryByTestId("desktop-session-main-s1"),
    ).not.toBeInTheDocument();
    expect(input.value).toBe("hello a");
    // 自动聚焦 + 全选（场景 2）。
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("hello a".length);
    // 列表不进 loading/禁用/骨架态：其他行照旧可点（场景 2）。
    expect(screen.getByTestId("desktop-session-main-s2")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-session-main-s2")).toBeEnabled();
  });

  it("Enter 保存：行标题立即乐观更新，且只发一次 renameSession（Enter 紧跟的 blur 被闩锁挡住）", () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "改过的名字" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // 浏览器在保存后随即失焦：同一次 act 内派发，走的就是闩锁那条路径（场景 5）。
      fireEvent.blur(input);
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
  });

  it("blur 保存（点击输入框之外）", () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "blur 保存" } });
      fireEvent.blur(input);
    });

    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "blur 保存",
    );
    expect(renameCalls(vscode)[0]).toMatchObject({ title: "blur 保存" });
  });

  it("Esc 回滚：退出编辑、标题不变、不发请求", () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "不要这个" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );
  });

  it("trim 后为空什么都不做：不发请求、退出编辑、标题不变", () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );
  });

  it("输入法组合中的 Enter 不算保存", () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "中文输入中" } });
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    // 仍是编辑态。
    expect(
      screen.getByTestId("desktop-session-rename-input-s1"),
    ).toBeInTheDocument();
  });

  it("输入框拦住按键冒泡：不触发行上的裸键/行菜单快捷键", () => {
    renderReady();
    const input = beginRename("s1");

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

  it("保存失败：回滚原标题并给出可见的行内失败提示", async () => {
    const vscode = renderReady();
    const input = beginRename("s1");

    act(() => {
      fireEvent.change(input, { target: { value: "写盘失败" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    replyRenamed(renameCalls(vscode)[0].requestId as string, false, "EACCES");

    // 失败提示必须可见（不得只有静默回滚）——提示由 await 之后的状态更新渲染。
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("EACCES"),
    );
    expect(screen.getByTestId("desktop-session-main-s1")).toHaveTextContent(
      "hello a",
    );
  });

  it("乐观更新同时落到会话看板卡片（场景 8）", () => {
    const vscode = renderReady();
    // 侧边栏「活动」入口 → 看板与对话区互斥，侧边栏仍在。
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-card-s1")).toBeInTheDocument();

    const input = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "看板也变" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(screen.getByTestId("session-card-s1")).toHaveTextContent("看板也变");
    expect(renameCalls(vscode)).toHaveLength(1);
  });

  it("两个会话同时改名：各自的回复按 requestId 配对，先失败的那个回滚自己的标题", async () => {
    const vscode = renderReady();

    // 会话 s1 改名（回复尚未到达）。
    let input = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "甲" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    const first = renameCalls(vscode)[0];

    // 在 s1 仍在途时给 s2 改名。
    input = beginRename("s2");
    act(() => {
      fireEvent.change(input, { target: { value: "乙" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    const second = renameCalls(vscode)[1];
    expect(renameCalls(vscode)).toHaveLength(2);

    // s2 成功：s2 保持新标题。
    replyRenamed(second.requestId as string, true, undefined, "s2");
    expect(screen.getByTestId("desktop-session-main-s2")).toHaveTextContent(
      "乙",
    );

    // s1 失败：必须回滚的是 s1（不能在途请求被后来的覆盖而吞掉这个回复）。
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
    const input = beginRename("s1");
    act(() => {
      fireEvent.change(input, { target: { value: "暂定名字" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
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

  it("分屏头部标题随宿主推送的新标题更新（场景 8 的头部一半）", () => {
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
