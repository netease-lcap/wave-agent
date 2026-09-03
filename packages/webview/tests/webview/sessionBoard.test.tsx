import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

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
});
