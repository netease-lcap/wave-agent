import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand, setInputText } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));

// 与 desktopApp.test.tsx 同构的 DesktopApp 全流程渲染：workdir →
// 会话树 →（可选）打开「活动」看板。
function renderReady(groups: unknown) {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("setInitialState", { messages: [] });
  sendCommand("desktopSessionTree", { groups });
  return vscode;
}

const session = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
});

describe("会话状态看板（活动）", () => {
  it("点击「活动」按钮进入看板，点击卡片关闭看板并恢复该会话（spec 场景 3）", () => {
    const vscode = renderReady([
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "chat one"), session("s2", "chat two")],
      },
    ]);
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();

    // 活动按钮 → 看板替换会话区
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-board")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).not.toBeInTheDocument();

    // 点击卡片：恢复会话（desktopSelectSession）+ 退出看板视图
    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("session-card-s2"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "s2",
    });
    expect(screen.queryByTestId("session-board")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    // 「活动」按钮高亮态取消
    expect(screen.getByTestId("desktop-sidebar-activity")).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("看板打开时左侧会话仍可点击：点会话即退出看板并进入该会话", () => {
    const vscode = renderReady([
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "chat one"), session("s2", "chat two")],
      },
    ]);

    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-board")).toBeInTheDocument();

    // 侧栏是看板页里回到某个会话的入口——点了就要真的看到那条会话，
    // 不能停在看板上（否则用户得先关看板再选会话）。
    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("desktop-session-main-s2"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "s2",
    });
    expect(screen.queryByTestId("session-board")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("看板「返回当前会话」直接退出看板（spec 场景 6），不发送切换命令", () => {
    const vscode = renderReady([
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "chat one")],
      },
    ]);

    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-board")).toBeInTheDocument();

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "返回当前会话" }));

    expect(
      vscode.postMessage.mock.calls.some(
        (c) =>
          (c[0] as Record<string, unknown>).command === "desktopSelectSession",
      ),
    ).toBe(false);
    expect(screen.queryByTestId("session-board")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("再次点击「活动」按钮关闭看板（spec 场景 7），按钮高亮态取消", () => {
    renderReady([
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "chat one")],
      },
    ]);

    // 首次点击打开看板并高亮
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-board")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-sidebar-activity")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 再次点击同一按钮：看板关闭、回到会话视图、高亮取消
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.queryByTestId("session-board")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-sidebar-activity")).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("打开看板再返回对话窗口，未发出的输入草稿不丢（spec 场景 23）", async () => {
    const vscode = renderReady([
      {
        host: "local",
        workdir: "/work/a",
        sessions: [session("s1", "chat one")],
      },
    ]);
    sendCommand("authStatusResponse", { isAuthenticated: true });
    const input = screen.getByTestId("message-input");
    await setInputText(input, "把重试次数改成 3 次");

    // 点开看板：对话区整块被看板顶替 ⇒ 输入框卸载，而此刻 150ms 防抖还没到点。
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();

    // 卸载必须把待发草稿补给宿主（宿主 inputDrafts 才是重挂载时的回填源）
    const draft = vscode.postMessage.mock.calls
      .map(([m]) => m as { command?: string; content?: string })
      .filter((m) => m.command === "updateInputContent")
      .pop()?.content;
    expect(draft).toBe("把重试次数改成 3 次");

    // 返回当前会话：输入框重挂载，桌面宿主按 webviewReady 回放快照（inputContent
    // 取自 inputDrafts）。真实回放由宿主完成，jsdom 里手动补这一步。
    fireEvent.click(screen.getByRole("button", { name: "返回当前会话" }));
    act(() => {
      sendCommand("setInitialState", { messages: [], inputContent: draft });
    });
    expect(screen.getByTestId("message-input").innerText).toBe(
      "把重试次数改成 3 次",
    );
  });
});
